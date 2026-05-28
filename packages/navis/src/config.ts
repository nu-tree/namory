// 환경변수 로딩 + 검증. 누락 시 즉시 죽어서 잘못된 설정으로 떠 있는 걸 막는다.

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] 필수 환경변수 누락: ${name}`);
    process.exit(1);
  }
  return v;
}

// 선택적 환경변수. 없으면 undefined를 돌려주고 죽지 않는다.
// (구글 캘린더·노션처럼 토큰이 채워졌을 때만 붙이는 부가 연동에 쓴다.)
function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

// URL+토큰이 한 쌍으로 다 있을 때만 외부 MCP 연동 설정을 돌려준다.
// 한쪽만 채워져 있으면 설정 실수로 보고 경고 후 무시 → 반쪽짜리 연결로 뜨는 걸 막는다.
function optionalMcp(
  label: string,
  urlVar: string,
  tokenVar: string,
): { url: string; token: string } | undefined {
  const url = optional(urlVar);
  const token = optional(tokenVar);
  if (!url && !token) return undefined;
  if (!url || !token) {
    console.warn(
      `[config] ${label} 연동 무시: ${urlVar}/${tokenVar} 둘 다 필요한데 하나만 설정됨.`,
    );
    return undefined;
  }
  return { url, token };
}

// 허용된 디스코드 유저 ID만 봇이 응답한다 (프롬프트 인젝션·무단 사용 차단).
// 쉼표로 여러 개: "123,456"
function parseAllowedUsers(): string[] {
  const raw = process.env.ALLOWED_USER_IDS ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    console.error(
      "[config] ALLOWED_USER_IDS 가 비었습니다. 최소 1명 지정 필요.",
    );
    process.exit(1);
  }
  return ids;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  allowedUserIds: parseAllowedUsers(),

  // Claude Code 구독 OAuth 토큰. SDK가 process.env에서 자동으로 읽으므로
  // 여기선 존재 여부만 검증한다 (없으면 인증 실패로 모든 호출이 깨짐).
  // `claude setup-token` 으로 발급.
  claudeOauthToken: required("CLAUDE_CODE_OAUTH_TOKEN"),

  // namory MCP 서버 접속 (navis가 namory를 외부 서비스처럼 도구로 호출).
  // 로컬: http://localhost:3000/mcp, Railway 내부망: http://namory.railway.internal:PORT/mcp
  namoryMcpUrl: required("NAMORY_MCP_URL"),
  // namory 엔드포인트 보호 토큰 (namory의 NAMORY_TOKEN과 동일 값).
  namoryToken: required("NAMORY_TOKEN"),

  // 모델 (구독 한도에 따라 가용 모델 다름). 기본 sonnet = 비용/품질 균형.
  model: process.env.AGENT_MODEL ?? "claude-sonnet-4-6",

  // 대화 맥락 유지 한도(토큰). 한 대화의 컨텍스트가 이걸 넘으면 다음 메시지부터
  // 새 세션으로 리셋하고 사용자에게 알린다. 잊힌 맥락은 namory가 받쳐줌.
  // 기본 100k = sonnet 200k 창의 절반. 모델 한계·SDK 자동압축 전에 우리가 제어.
  contextTokenLimit: Number(process.env.CONTEXT_TOKEN_LIMIT) || 100000,

  // 부가 외부 MCP 연동 (선택). 토큰이 있을 때만 navis가 붙인다.
  // 노션: OAuth를 피하려고 호스팅 MCP가 아니라 self-host(@notionhq/notion-mcp-server)를
  // navis 안에서 stdio로 띄우고, 내부 통합 토큰(ntn_...)만 주입한다. URL 불필요.
  // notion.so/my-integrations 에서 발급 후 봇이 쓸 페이지/DB를 해당 통합에 공유할 것.
  notionToken: optional("NOTION_TOKEN"),
  // 구글 캘린더: 보류. 현재 HTTP+Bearer 스켈레톤은 사실상 미동작 —
  // 구글 사용자 데이터는 정적 토큰이 없고 access token이 1시간이면 만료되기 때문.
  // TODO(구글 캘린더): 노션처럼 self-host stdio MCP + OAuth refresh token 구조로 전환.
  //   1) Google Cloud Console에서 OAuth 데스크톱 클라이언트 발급(client_id/secret)
  //   2) 로컬에서 1회 동의 → refresh_token 획득 → env 주입
  //   3) GOOGLE_MCP_URL HTTP 경로 제거하고 캘린더 MCP 서버를 stdio로 spawn.
  google: optionalMcp("google", "GOOGLE_MCP_URL", "GOOGLE_TOKEN"),

  // 봇 성격·행동 지침. 코드에 두지 않고 SYSTEM_PROMPT 환경변수로만 주입한다
  // (레포 공개 대비 — 프롬프트는 .env / Railway 변수에만 존재). 없으면 즉시 종료.
  systemPrompt: required("SYSTEM_PROMPT"),

  // Railway 헬스체크용 포트. 디스코드 봇은 인바운드 HTTP가 필요 없지만
  // 호스팅 uptime 체크를 위해 /health 만 연다.
  port: Number(process.env.PORT) || 3000,
} as const;
