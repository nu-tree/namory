import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";

// 프롬프트 한 개를 Claude에 넣고 최종 텍스트 답변을 받는다.
//
// v0.1 범위: 순수 채팅 릴레이. 도구(파일·배시·MCP) 전부 끔, 로컬 설정(CLAUDE.md
// 등) 안 읽음. namory 도구 연동은 다음 단계.
//
// 인증: SDK가 process.env.CLAUDE_CODE_OAUTH_TOKEN(구독 토큰)을 자동으로 사용한다.
export async function askClaude(prompt: string): Promise<string> {
  let result = "";

  for await (const message of query({
    prompt,
    options: {
      model: config.model,
      systemPrompt: config.systemPrompt,
      // 도구 전부 비활성화 → 순수 대화만.
      allowedTools: [],
      // 파일시스템 설정(프로젝트 CLAUDE.md, settings.json) 무시 → 서버에서 깨끗하게.
      settingSources: [],
      // 한 번의 모델 턴만. 도구가 없으니 멀티턴 루프가 돌 일도 없음.
      maxTurns: 1,
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
