import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";

// 자발적 팔로업 판단 서브에이전트.
//
// 메인 턴이 끝난 뒤 별도 LLM(Haiku) 호출이 "이 대화의 결과를 일정 시간 뒤에 navis 가
// 먼저 물어볼 가치가 있는가" 를 판단한다. 가치 있으면 질문 문장과 지연(분)을 돌려준다.
//
// 설계
// - 백그라운드(fire-and-forget) — 사용자 응답을 지연시키지 않음
// - 저렴한 모델(Haiku) — 분류·짧은 자연어 생성에 충분
// - 출력은 단일 JSON 객체로 강제. 파싱 실패하면 null(=팔로업 안 함).
// - false positive 가 곧 spam 이므로 보수적으로 판단하도록 프롬프트로 강하게 가드.

export interface FollowupDecision {
  delayMinutes: number;
  question: string;
  reason: string;
}

export interface DecideInput {
  userText: string;
  assistantText: string;
}

const DECIDE_SYSTEM_PROMPT = `너는 navis 의 "자발적 팔로업" 판단 서브에이전트다. 방금 끝난 한 턴의 대화(사용자 메시지 + 어시스턴트 응답)를 읽고, navis 가 일정 시간 뒤에 사용자에게 먼저 짧게 물어볼 만한 가치가 있는지를 판단한다.

판단 기준:
- 가치 있음: 음식 주문/식사 계획, 외출·방문, 회의·약속·인터뷰, 새로 시도하기로 한 행동, 결정 후 실행 결과가 나중에 드러나는 상황, 감정 변화가 예상되는 상황. 즉 "지금은 결과를 모르지만 몇 시간 뒤엔 결과를 알 만한 진행형 상황".
- 가치 없음: 단순 정보·지식 질문, 잡담, 이미 결과까지 전부 말한 경우, 사용자가 완전한 답을 이미 제공한 경우, 코드 수정/자기 개선 같은 메타 작업 보고, 사용자가 navis 의 동작/설정을 묻는 경우.

출력은 단 하나의 JSON 객체만. 다른 텍스트·코드 펜스·설명 금지.

가치 없으면:
{"should_follow_up": false}

가치 있으면:
{"should_follow_up": true, "delay_minutes": <30~720 사이 정수>, "question": "<자연스럽고 짧은 한국어 한 문장>", "reason": "<왜 후속이 필요한지 한 문장>"}

규칙:
- question 은 친구처럼 짧고 자연스럽게("곱도리탕 맛있었어요?", "회의 잘 끝났어요?", "면접 어땠어요?" 식). 이모티콘·과한 친절·길고 정중한 문장 금지. 결과를 묻는 한 문장.
- delay_minutes 는 상황에 맞춰: 곧 끝날 점심/외출 → 90~180, 저녁 약속/긴 일정 → 180~360, 다음 날까지 가는 일정 → 600~720. 너무 짧으면 미실현, 너무 길면 망각.
- 확신이 없으면 should_follow_up: false. false positive(불필요한 질문)는 spam 이 되니 보수적으로.`;

interface RawDecision {
  should_follow_up?: boolean;
  delay_minutes?: number;
  question?: string;
  reason?: string;
}

// 너무 짧거나 비정상 응답이면 LLM 호출 자체를 생략(비용·노이즈 절감).
function worthDeciding(userText: string, assistantText: string): boolean {
  const u = userText.trim();
  const a = assistantText.trim();
  if (u.length < 10) return false;
  if (a === "(빈 응답)" || a.startsWith("⚠️")) return false;
  return true;
}

export async function decideFollowup(
  input: DecideInput,
): Promise<FollowupDecision | null> {
  if (!worthDeciding(input.userText, input.assistantText)) return null;

  const prompt = [
    "다음은 방금 끝난 한 턴이다. 자발적 팔로업이 필요한지 판단해 단일 JSON 으로만 응답하라.",
    "",
    "[사용자]",
    input.userText.trim(),
    "",
    "[어시스턴트]",
    input.assistantText.trim(),
  ].join("\n");

  let text = "";
  try {
    for await (const message of query({
      prompt,
      options: {
        model: config.curatorModel,
        systemPrompt: DECIDE_SYSTEM_PROMPT,
        // 도구·MCP 없이 순수 분류. recall 같은 부가 호출도 비용/지연 낭비.
        allowedTools: [],
        settingSources: [],
        maxTurns: 1,
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        text = message.result;
      }
    }
  } catch (err) {
    console.error("[followup] 판단 호출 실패:", err);
    return null;
  }

  return parseDecision(text);
}

// 모델이 가끔 ```json ... ``` 으로 감싸도 안전하게 벗긴다. 그 외엔 실패 시 null.
function parseDecision(text: string): FollowupDecision | null {
  if (!text) return null;
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  let raw: RawDecision;
  try {
    raw = JSON.parse(stripped) as RawDecision;
  } catch {
    console.warn("[followup] JSON 파싱 실패:", text.slice(0, 200));
    return null;
  }
  if (!raw.should_follow_up) return null;
  const delay = Math.round(Number(raw.delay_minutes));
  const question = (raw.question ?? "").trim();
  if (!question) return null;
  // 범위 가드 — 모델이 가끔 빗나간 값을 내도 30분~12시간 사이로 강제.
  if (!Number.isFinite(delay) || delay < 30 || delay > 720) return null;
  return { delayMinutes: delay, question, reason: (raw.reason ?? "").trim() };
}
