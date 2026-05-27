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

export interface AskResult {
  text: string;
  // 이 대화의 세션 id. 다음 메시지에서 resume 으로 넘기면 맥락이 이어진다.
  sessionId: string;
  // 직전 턴의 입력 컨텍스트 토큰 수. 이게 임계를 넘으면 다음 대화는 새 세션으로 리셋.
  contextTokens: number;
  // 이번 턴에 namory에 새 기억을 저장했는지. 디스코드에서 💡 리액션 표시에 쓴다.
  saved: boolean;
}

// 프롬프트 한 개를 Claude에 넣고 답변 + 세션 정보를 받는다.
// resumeSessionId 가 있으면 그 대화를 이어받는다(멀티턴). 없으면 새 대화.
//
// 두뇌는 Claude Code 구독 OAuth 토큰(SDK가 process.env.CLAUDE_CODE_OAUTH_TOKEN을
// 자동 사용)으로 돌고, namory를 외부 MCP 서버로 붙여 recall/save 도구를 쥐여준다.
export async function askClaude(
  prompt: string,
  resumeSessionId?: string,
): Promise<AskResult> {
  let text = "";
  let sessionId = "";
  let contextTokens = 0;
  let saved = false;

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
          // 도구가 tool-search 뒤로 deferred 되지 않게 항상 로드.
          alwaysLoad: true,
        },
      },
      // 허용 도구를 namory로 한정 → 파일·배시 등 안 붙고 권한 프롬프트도 안 뜸.
      allowedTools: NAMORY_TOOLS,
      // 로컬 설정(CLAUDE.md, settings.json) 무시.
      settingSources: [],
      // 도구 호출 루프 여유.
      maxTurns: 8,
      // 이전 대화 이어받기 (있을 때만).
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  })) {
    // 턴 중 save 도구가 실제로 호출됐는지 감지 → 💡 리액션 트리거.
    if (message.type === "assistant") {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_use" && block.name === "mcp__namory__save") {
            saved = true;
          }
        }
      }
    }

    if (message.type === "result") {
      sessionId = message.session_id;
      // 현재 컨텍스트 크기 = 프롬프트 측 토큰 합 (캐시 포함).
      const u = message.usage as unknown as Record<string, number | undefined>;
      contextTokens =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0);
      if (message.subtype === "success") {
        text = message.result;
      } else {
        throw new Error(`Claude 응답 실패: ${message.subtype}`);
      }
    }
  }

  return { text: text.trim() || "(빈 응답)", sessionId, contextTokens, saved };
}
