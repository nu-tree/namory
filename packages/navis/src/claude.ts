import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { config } from "./config.js";
import { buildCronTools, CRON_TOOL_NAMES } from "./cron-tools.js";

// 디스코드 첨부 이미지를 Claude에 넘길 때 쓰는 형태. data는 base64(접두사 없음).
// media_type은 Anthropic이 받는 4종으로 한정한다.
export interface InputImage {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
}

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
// images 가 있으면 텍스트+이미지 content block을 가진 user 메시지로 넘긴다
// (문자열 prompt로는 이미지를 못 실어서 streaming-input 형태를 쓴다).
//
// 두뇌는 Claude Code 구독 OAuth 토큰(SDK가 process.env.CLAUDE_CODE_OAUTH_TOKEN을
// 자동 사용)으로 돌고, namory를 외부 MCP 서버로 붙여 recall/save 도구를 쥐여준다.
export async function askClaude(
  prompt: string,
  resumeSessionId?: string,
  images: InputImage[] = [],
  channelId?: string,
): Promise<AskResult> {
  let text = "";
  let sessionId = "";
  let contextTokens = 0;
  let saved = false;

  // 이미지가 있으면 content block 배열로 구성해 user 메시지 하나를 yield 한다.
  // 없으면 기존처럼 문자열 prompt 그대로(가장 단순한 경로).
  const promptInput =
    images.length > 0 ? buildImageMessage(prompt, images) : prompt;

  // 채널 id가 있으면(=실제 대화) 그 채널에 묶인 in-process 크론 도구를 붙인다.
  // 크론 발동 결과는 이 채널로 가도록 channelId를 클로저로 주입한다.
  const cronServer = channelId ? buildCronTools(channelId) : undefined;

  for await (const message of query({
    prompt: promptInput,
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
        ...(cronServer ? { cron: cronServer } : {}),
      },
      // 자동 승인 도구: namory + (대화 중이면) 크론 도구. WebSearch 등 내장 도구는
      // 별도 제한을 안 걸어 그대로 사용 가능.
      allowedTools: [...NAMORY_TOOLS, ...(cronServer ? CRON_TOOL_NAMES : [])],
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

// 텍스트(있으면) + 이미지들을 하나의 user 메시지로 묶어 yield 하는 async generator.
// query()의 streaming-input 모드는 prompt로 AsyncIterable<SDKUserMessage>를 받는다.
async function* buildImageMessage(
  text: string,
  images: InputImage[],
): AsyncGenerator<SDKUserMessage> {
  const content = [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...images.map((img) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: img.mediaType,
        data: img.data,
      },
    })),
  ];

  yield {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
  };
}
