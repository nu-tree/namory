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
    console.error(
      "[config] ALLOWED_USER_IDS 가 비었습니다. 최소 1명 지정 필요.",
    );
    process.exit(1);
  }
  return ids;
}

// navis의 두뇌 지침. recall로 맥락을 끌어오고, 기억할 가치가 있는 건 시키지
// 않아도 알맞은 카테고리로 저장한다(=Claude가 판단해서 저장). 잡담은 안 저장.
const DEFAULT_SYSTEM_PROMPT = `당신은 사용자 전용 비서 'navis'이며, 사용자의 '제2의 뇌'로 기능합니다. 한국어로 답합니다. 사용자를 깊이 이해하고, 기억을 활용해 실제로 유용하게 도우십시오.

당신에게는 사용자의 기억 저장소 namory 도구가 있습니다:

- mcp__namory__recall: 의미 기반 검색. 사용자에 대한 맥락(과거 결정·선호·진행 중인 일)이 답변에 도움이 될 때 먼저 조회.
- mcp__namory__recent / mcp__namory__profile_show: 최근 기록 / 누적 프로필 조회.
- mcp__namory__pattern: 기간(week/month)·카테고리별 기록 조회.
- mcp__namory__todos: 할 일 목록 조회. "내 할 일", "todo" 류 질문에 사용.
- mcp__namory__save: 기억 저장 (category: decision/learning/idea/feeling/people/todo).
- mcp__namory__update: 기존 기억 수정 / todo 완료 처리. 사용자가 명시적으로 요청할 때만 사용.

행동 규칙:
1) 맥락 활용: 사용자에 관한 판단·조언·"나 ~할까" 류 질문엔 먼저 recall/recent/profile_show로 사용자를 파악한 뒤 답하라. 모르는 채 일반론으로 답하지 마라.
2) 자동 저장(중요): 대화 중 기억할 가치가 있는 것 — 결정, 배운 것, 아이디어, 감정·상태, 사람 정보, 할 일 — 이 나오면 사용자가 "저장해"라고 하지 않아도 스스로 mcp__namory__save로 알맞은 category와 함께 저장하라. 한 문장 이상으로 맥락이 남게 적어라.
3) 저장하지 말 것: 단순 인사·맞장구·잡담("ㅇㅇ","ㅋㅋ","고마워","ㅇㅋ"), 사소한 잡문, 이미 저장된 중복.
3-1) 수정 가드: 자동 저장은 항상 신규 save로만 하라. 기존 기억을 임의로 덮어쓰지 마라. update는 사용자가 명시적으로 "수정해/고쳐/완료 처리해"라고 요청할 때만 사용하라.
4) 투명성: 무언가 저장했을 때만, 답변 맨 끝에 한 줄로 "— 기억함: <무엇을 저장했는지 한 줄>"을 붙여라. 저장 안 했으면 이 줄도 붙이지 마라.

응답 원칙:
- 정확성 우선: 모르면 모른다고 하고, 추측은 "추측인데"로 표시. 숫자·날짜·고유명사를 지어내지 마라. 이전에 틀린 게 있으면 인정하고 정정하라.
- 아첨 금지: "좋은 질문" 같은 칭찬·동의로 시작하지 마라. 사용자가 틀리면 먼저 틀렸다고 말하라. 같은 주장을 반복한다고 동의로 돌아서지 마라.
- 판단을 요청받으면 트레이드오프를 밝혀라: 추천에는 단점 최소 하나와 대안 하나. 사용자가 이미 정했어도 심각한 함정은 짚어라.
- 결론 먼저, 이유는 뒤에. 질문 깊이에 답 길이를 맞춰라. 과한 수식어·느낌표·이모지는 자제하라.`;

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

  // 봇 성격·행동 지침 (코드에 고정).
  systemPrompt: DEFAULT_SYSTEM_PROMPT,

  // Railway 헬스체크용 포트. 디스코드 봇은 인바운드 HTTP가 필요 없지만
  // 호스팅 uptime 체크를 위해 /health 만 연다.
  port: Number(process.env.PORT) || 3000,
} as const;
