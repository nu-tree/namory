import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";

// namory MCP 서버에서 navis에 허용할 도구.
// 읽기(recall/recent/profile_show/pattern/todos) + 추가(save) + 수정(update).
// update는 todo 완료 처리·기억 수정용이며, 시스템 프롬프트에서 "사용자가 명시적으로
// 요청할 때만" 쓰도록 가드한다. 비가역 삭제(delete)와 profile_update는 미허용 —
// navis는 인젝션 위험 surface라 기억을 지우거나 프로필을 자동으로 덮어쓰지 못하게 한다.
const NAMORY_TOOLS = [
  "mcp__namory__recall",
  "mcp__namory__recent",
  "mcp__namory__profile_show",
  "mcp__namory__pattern",
  "mcp__namory__todos",
  "mcp__namory__save",
  "mcp__namory__update",
];

// 프롬프트 한 개를 Claude에 넣고 최종 텍스트 답변을 받는다.
//
// 두뇌는 Claude Code 구독 OAuth 토큰(SDK가 process.env.CLAUDE_CODE_OAUTH_TOKEN을
// 자동 사용)으로 돌고, namory를 외부 MCP 서버로 붙여 recall/save 도구를 쥐여준다.
// → 답변 전 맥락을 끌어오고, 기억할 가치가 있는 건 스스로 저장한다(시스템 프롬프트 규칙).
export async function askClaude(prompt: string): Promise<string> {
  let result = "";

  for await (const message of query({
    prompt,
    options: {
      model: config.model,
      systemPrompt: config.systemPrompt,
      // namory를 HTTP MCP 서버로 연결. 토큰은 Authorization 헤더로 전달.
      mcpServers: {
        namory: {
          type: "http",
          url: config.namoryMcpUrl,
          headers: { Authorization: `Bearer ${config.namoryToken}` },
          // 도구 4개뿐이라 항상 로드 → 모델이 turn-1부터 recall을 확실히 쓸 수 있게.
          alwaysLoad: true,
        },
      },
      // 허용 도구를 namory 4개로 한정 → 파일·배시 등 일절 안 붙고, 권한 프롬프트도
      // 안 뜸(allowedTools에 있으면 자동 허용). 헤드리스 서버에 안전.
      allowedTools: NAMORY_TOOLS,
      // 파일시스템 설정(프로젝트 CLAUDE.md, settings.json) 무시 → 서버에서 깨끗하게.
      settingSources: [],
      // 도구 호출 → 결과 수신 → 최종 답변까지 멀티턴 루프 여유.
      maxTurns: 8,
    },
  })) {
    // 최종 결과는 type: "result" 메시지의 result 필드에 담겨 온다.
    if (message.type === "result") {
      if (message.subtype === "success") {
        result = message.result;
      } else {
        throw new Error(`Claude 응답 실패: ${message.subtype}`);
      }
    }
  }

  return result.trim() || "(빈 응답)";
}
