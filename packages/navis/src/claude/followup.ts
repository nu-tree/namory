import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";

// LLM 팔로업 판단기 — 메인 턴이 끝난 뒤 별도 LLM 호출이 "이 대화에서 나중에
// 후속 질문을 하고 싶은가?"를 자체 판단한다. 있으면 호출자가 지연 후 채널로 전송.
// - 백그라운드(fire-and-forget): 사용자 답변 지연 없음
// - 저렴한 모델(Haiku): 턴당 ~$0.001 수준
// - 도구 없음 — JSON 텍스트 한 줄만 받아 파싱

const FOLLOWUP_SYSTEM_PROMPT = `너는 나비스(비서 AI)의 팔로업 판단기다. 방금 끝난 한 턴의 대화를 읽고, 사용자의 경험/결과에 대해 나중에 자연스럽게 물어보고 싶은 후속 질문이 있는지 판단한다.

판단 기준:
- 사용자가 곧 있을 경험/이벤트를 언급했다 (음식 주문, 면접, 데이트, 여행, 중요한 미팅 등)
- 사용자가 결정하거나 시작한 일의 결과가 궁금할 만하다
- 자연스러운 인간이라면 나중에 "어떻게 됐어요?" 하고 물어볼 것 같은 상황이다

제외:
- 단순 정보 조회, 분석 요청, 코드 작업
- 이미 완료된 과거 이야기
- 추상적 계획/아이디어 (실행 여부 불명확)

출력 형식 (JSON만, 다른 텍스트 없음):
- 후속 질문 있음: {"followup": true, "question": "맛있었어요?", "delayHours": 3}
- 없음: {"followup": false}

delayHours는 경험 완료까지 예상 시간 + 약간의 여유로 설정 (보통 1~6시간, 중요한 이벤트는 더 길게).
question은 짧고 자연스러운 한국어로.`;

export interface FollowupResult {
  followup: boolean;
  question?: string;
  delayHours?: number;
}

// 짧은 인사·맞장구 수준은 LLM 호출 자체를 생략해 비용·노이즈를 줄인다.
function worthChecking(userText: string, assistantText: string): boolean {
  const combined = (userText + assistantText).trim();
  if (combined.length < 50) return false;
  return true;
}

interface FollowupInput {
  userText: string;
  assistantText: string;
}

// 팔로업 판단만 반환. 전송 로직은 호출자(bot.ts)가 처리.
export async function checkFollowup(input: FollowupInput): Promise<FollowupResult> {
  if (!worthChecking(input.userText, input.assistantText)) {
    return { followup: false };
  }

  const turn = [
    "다음 대화를 읽고 JSON만 반환하라.",
    "",
    "[사용자]",
    input.userText.trim() || "(텍스트 없음)",
    "",
    "[어시스턴트]",
    input.assistantText.trim(),
  ].join("\n");

  try {
    let resultText = "";
    for await (const message of query({
      prompt: turn,
      options: {
        model: config.curatorModel,
        systemPrompt: FOLLOWUP_SYSTEM_PROMPT,
        // 도구 없음 — JSON 텍스트만 반환.
        mcpServers: {},
        allowedTools: [],
        settingSources: [],
        maxTurns: 1,
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        resultText = message.result;
      }
    }

    // JSON 한 덩어리만 추출. 모델이 앞뒤로 군더더기를 붙여도 첫 {} 블록을 파싱.
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { followup: false };
    return JSON.parse(jsonMatch[0]) as FollowupResult;
  } catch (err) {
    console.error("[followup] 판단 실패(무시):", err);
    return { followup: false };
  }
}
