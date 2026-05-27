// 환경변수 로딩 + 검증. 누락 시 즉시 죽어서 잘못된 설정으로 떠 있는 걸 막는다.

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] 필수 환경변수 누락: ${name}`);
    process.exit(1);
  }
  return v;
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
    console.error("[config] ALLOWED_USER_IDS 가 비었습니다. 최소 1명 지정 필요.");
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

  // 모델 (구독 한도에 따라 가용 모델 다름). 기본 sonnet = 비용/품질 균형.
  model: process.env.AGENT_MODEL ?? "claude-sonnet-4-6",

  // 봇 성격. 기본은 한국어 개인 비서. 필요하면 env로 덮어쓰기.
  systemPrompt:
    process.env.AGENT_SYSTEM_PROMPT ??
    "당신은 디스코드로 연결된 개인 비서입니다. 한국어로 간결하고 핵심만 답합니다. 사용자는 개발자이며 불필요하게 길게 늘어놓는 답변을 싫어합니다.",

  // Railway 헬스체크용 포트. 디스코드 봇은 인바운드 HTTP가 필요 없지만
  // 호스팅 uptime 체크를 위해 /health 만 연다.
  port: Number(process.env.PORT) || 3000,
} as const;
