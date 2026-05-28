import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";

// 사후 큐레이터(post-turn curator) — 메인 턴이 끝난 뒤 별도 LLM 호출이 "방금 턴에서
// 뭘 저장할지"만 판단·실행한다. 시스템 프롬프트로만 저장을 유도할 때 누락되던
// 문제를 결정론적으로 메우는 그물.
//
// 설계
// - 백그라운드(fire-and-forget): 사용자 답변 지연 없음
// - 저렴한 모델(Haiku): 턴당 ~$0.001 수준
// - 권한 최소화: save + recall만 허용. profile_update·delete는 절대 미허용
// - 중복 방지: 저장 전 recall로 유사 기억이 이미 있는지 점검(임계값 이상이면 스킵)
// - 출처 표기: source="navis-curator" 로 수동 저장과 구분 가능

// 큐레이터 시스템 프롬프트는 personality가 아닌 instruction이므로 코드 상수로 둔다
// (SYSTEM_PROMPT env와 분리 — 봇 성격은 메인 턴에만 적용).
const CURATOR_SYSTEM_PROMPT = `너는 namory(제2의 뇌)의 큐레이터다. 방금 끝난 한 턴의 대화(사용자 메시지 + 어시스턴트 응답)를 읽고, 장기 기억으로 남길 가치가 있는 항목을 namory에 저장한다.

저장 대상(있을 때만):
- decision: 사용자가 명시적으로 내린 결정/약속
- todo: 사용자가 확정한 할 일/하기로 한 일
- learning: 사용자 자신에 관한 사실/배움(자기이해 단서)
- idea: 사용자가 떠올린 아이디어/구상
- feeling: 의미 있는 감정/상태(가벼운 감탄 제외)
- people: 사람에 대한 정보(이름·관계·맥락)

저장 절차:
1) 후보가 있으면, 먼저 recall(query=핵심구절, limit=3)으로 유사 기억이 이미 있는지 확인한다. 분명히 같은 내용이 이미 있으면 그 항목은 건너뛴다.
2) 항목별로 save() 호출. 한 턴에서 여러 항목이 나오면 여러 번 호출한다.
3) content는 자기완결적인 한국어 한두 문장으로 작성("사용자가 ~를 결정했다", "사용자가 X를 좋아한다고 말함" 식). "이거/그거" 같은 지시어 금지. 날짜·고유명사가 있으면 보존.
4) source는 항상 "navis-curator". project는 대화에 프로젝트 맥락이 명백할 때만(예: navis, namory).

저장할 게 없으면 아무 도구도 호출하지 말고 즉시 종료한다.

출력은 도구 호출만으로 끝내고 텍스트 답변은 짧게(또는 비워두기). 사용자에게 보이지 않는다.`;

// 큐레이터가 평가할지 사전 필터링. 의미 없는 짧은 발화는 LLM 호출 자체를 생략해
// 비용·노이즈를 더 줄인다. 보수적으로 — 애매하면 통과시켜 큐레이터가 판단하게.
function worthCurating(userText: string, assistantText: string): boolean {
  const u = userText.trim();
  const a = assistantText.trim();
  // 양쪽 다 너무 짧으면 스킵(인사·맞장구 수준).
  if (u.length < 6 && a.length < 40) return false;
  // 어시스턴트 응답이 에러/빈 응답이면 스킵.
  if (a === "(빈 응답)" || a.startsWith("⚠️")) return false;
  return true;
}

interface CurateInput {
  userText: string;
  assistantText: string;
}

// 한 턴을 큐레이팅한다. 실패는 삼킴 — 사용자 흐름을 막지 않는 게 최우선.
export async function curateTurn(input: CurateInput): Promise<void> {
  if (!worthCurating(input.userText, input.assistantText)) return;

  // 큐레이터에 넣을 턴 본문. 사용자/어시스턴트 구분을 명시해 인용·혼동 방지.
  const turn = [
    "다음은 방금 끝난 한 턴이다. 저장 가치가 있는 항목만 namory에 저장하라.",
    "",
    "[사용자]",
    input.userText.trim() || "(텍스트 없음)",
    "",
    "[어시스턴트]",
    input.assistantText.trim(),
  ].join("\n");

  try {
    for await (const _msg of query({
      prompt: turn,
      options: {
        // 저렴한 빠른 모델로 충분 — 분류·요약·짧은 호출 위주.
        model: "claude-haiku-4-5-20251001",
        systemPrompt: CURATOR_SYSTEM_PROMPT,
        mcpServers: {
          namory: {
            type: "http",
            url: config.namoryMcpUrl,
            headers: { Authorization: `Bearer ${config.namoryToken}` },
            alwaysLoad: true,
          },
        },
        // 권한 최소화: save + recall만. profile_update/update/delete는 절대 X.
        allowedTools: ["mcp__namory__save", "mcp__namory__recall"],
        settingSources: [],
        // recall 1~몇 회 + save 여러 회를 한 번에 처리할 여유.
        maxTurns: 8,
      },
    })) {
      // 메시지 스트림은 소비만 — 큐레이터는 사용자에게 텍스트를 보내지 않는다.
      void _msg;
    }
  } catch (err) {
    console.error("[curator] 실패(무시):", err);
  }
}
