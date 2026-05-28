import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { buildCronTools, CRON_TOOL_NAMES } from "../cron/mcp.js";
import { buildRepoTools, REPO_TOOL_NAMES } from "../repo/mcp.js";
import { buildSelfModifyTools, SELF_MODIFY_TOOL_NAMES } from "../self-modify/mcp.js";
import {
  BUILTIN_TOOLS,
  NAMORY_PROFILE_UPDATE_TOOL,
  NAMORY_TOOLS,
} from "./allowed-tools.js";
import {
  httpMcp,
  notionStdio,
  type McpHttpServer,
  type McpStdioServer,
} from "./mcp.js";
import { applySaveNudge } from "./nudge.js";
import type { AskResult, InputImage } from "./types.js";

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
  // 신뢰된 자동화(주간 다이제스트)에서만 true. profile_update를 일시 허용해
  // 자기이해 프로필을 자동 갱신한다. 사용자 대화 경로에선 항상 false(인젝션 방어).
  allowProfileUpdate = false,
  // CLI에서 감지된 프로젝트명(있으면). 시스템 프롬프트에 부속문을 붙여
  // 이 대화에서 발생하는 save 호출이 자동으로 project 태그를 부착하게 한다.
  projectContext?: string,
): Promise<AskResult> {
  let text = "";
  let sessionId = "";
  let contextTokens = 0;
  let saved = false;

  // 키워드 너지(B): 사용자 메시지에 결정/약속/할 일/배움 신호가 보이면 메인 턴에도
  // save 호출을 상기시키는 가벼운 힌트를 앞에 붙인다. 사후 큐레이터(A)가 그물이지만
  // 메인 턴에서 잡으면 응답 흐름 안에서 자연스럽게 저장돼 UX가 매끄럽다.
  const nudgedPrompt = applySaveNudge(prompt);

  // 이미지가 있으면 content block 배열로 구성해 user 메시지 하나를 yield 한다.
  // 없으면 기존처럼 문자열 prompt 그대로(가장 단순한 경로).
  const promptInput =
    images.length > 0 ? buildImageMessage(nudgedPrompt, images) : nudgedPrompt;

  // 채널 id가 있으면(=실제 대화) 그 채널에 묶인 in-process 크론 도구를 붙인다.
  // 크론 발동 결과는 이 채널로 가도록 channelId를 클로저로 주입한다.
  const cronServer = channelId ? buildCronTools(channelId) : undefined;

  // 자기 소스 조회 도구(read-only). 디스코드 봇은 컨테이너에 src/가 없어서 이 도구로
  // GitHub raw를 읽어야 자기 코드를 볼 수 있다. CLI 모드에서도 풀어둠(레포 어디에 있든
  // 같은 명령으로 동작) — 다만 CLI는 로컬 Read가 더 빠르니 거의 안 쓸 것.
  const repoServer = buildRepoTools();

  // 자기 개선 트리거. 디스코드 모드(channelId 있음)에서만 노출 — CLI 모드는 그냥
  // Edit/Write 로 직접 수정하면 되니까 의미 없음. webhook 받을 때 어느 채널로 보고할지
  // 클로저로 묶어두기 위해 channelId 를 인자로 받는다.
  const selfModifyServer = channelId ? buildSelfModifyTools(channelId) : undefined;

  // 선택 외부 연동(노션/구글). env에 토큰이 있을 때만 설정이 채워진다.
  // 서버 단위로 allowedTools에 `mcp__<name>` 을 넣어 그 서버의 모든 도구를 자동 승인.
  const extraServers: Record<string, McpHttpServer | McpStdioServer> = {};
  const extraToolNames: string[] = [];
  if (config.notionToken) {
    // 노션은 OAuth 회피용 self-host stdio (내부 통합 토큰만 주입).
    extraServers.notion = notionStdio(config.notionToken);
    extraToolNames.push("mcp__notion");
  }
  if (config.google) {
    extraServers.google = httpMcp(config.google);
    extraToolNames.push("mcp__google");
  }

  // 프로젝트 컨텍스트가 있으면 시스템 프롬프트에 부속문을 합성. 코드로 강제 인젝션
  // 하지 않고 모델에 지시 — 큐레이터도 같은 규칙으로 따라온다.
  const systemPromptFinal = projectContext
    ? `${config.systemPrompt}\n\n[운영 컨텍스트] 현재 작업 프로젝트: "${projectContext}". 이 대화에서 mcp__namory__save 를 호출할 때 모든 항목에 project: "${projectContext}" 를 명시할 것.`
    : config.systemPrompt;

  for await (const message of query({
    prompt: promptInput,
    options: {
      model: config.model,
      systemPrompt: systemPromptFinal,
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
        repo: repoServer,
        ...(selfModifyServer ? { self_modify: selfModifyServer } : {}),
        ...extraServers,
      },
      // 자동 승인 도구: namory + 내장(파일/셸/웹/탐색) + repo 조회 + (대화 중이면) 크론·자기개선 + 부가 연동.
      // 목록은 ./allowed-tools.ts 한 곳에서 관리. profile_update는 신뢰된 다이제스트
      // 경로(allowProfileUpdate)에서만 추가.
      allowedTools: [
        ...NAMORY_TOOLS,
        ...(allowProfileUpdate ? [NAMORY_PROFILE_UPDATE_TOOL] : []),
        ...(cronServer ? CRON_TOOL_NAMES : []),
        ...REPO_TOOL_NAMES,
        ...(selfModifyServer ? SELF_MODIFY_TOOL_NAMES : []),
        ...BUILTIN_TOOLS,
        ...extraToolNames,
      ],
      // 로컬 설정(CLAUDE.md, settings.json) 무시.
      settingSources: [],
      // 도구 호출 루프 여유.
      maxTurns: 16,
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
