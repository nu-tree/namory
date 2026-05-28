// 환경변수 로딩 + 검증. 누락 시 즉시 죽어서 잘못된 설정으로 떠 있는 걸 막는다.
//
// env 파일 자동 로드 — 본 모듈이 평가되기 직전에 실행돼 process.env를 채운 뒤
// required()/optional() 검증이 동작한다. 우선순위:
//   1) 현재 디렉터리의 .env  (개발용)
//   2) ~/.config/navis/env    (글로벌 설치용 — XDG 표준)
//   3) 이미 export 된 process.env (가장 마지막에 우선 — Railway 등 호스팅 환경)
// Node 21.7+ 의 process.loadEnvFile()을 사용 — 별도 dotenv 의존성 불필요.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

(function loadEnvFiles(): void {
  const candidates = [
    join(process.cwd(), ".env"),
    join(homedir(), ".config", "navis", "env"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        process.loadEnvFile(path);
        return; // 첫 번째로 찾은 파일만 로드(우선순위 보존)
      } catch (err) {
        console.error(`[config] env 파일 로드 실패: ${path}`, err);
      }
    }
  }
})();

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

// 허용된 디스코드 유저 ID 목록 (쉼표 구분). 디스코드 봇 모드에서만 필수.
// CLI 모드는 디스코드와 무관하므로 비어 있어도 통과 — 실제 검증은 startDiscord() 진입 시.
function parseAllowedUsers(): string[] {
  const raw = process.env.ALLOWED_USER_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  // 디스코드 봇 모드에서만 필요. CLI 모드(navis 명령)는 사용 안 함.
  // 실제 사용 진입점(startDiscord)에서 검증해 누락 시 그때 종료한다.
  discordToken: optional("DISCORD_TOKEN"),
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
  // 운영 튜닝 상수 — 바꾸려면 코드 수정(보안·환경 무관 값은 env로 빼지 않는다).
  model: "claude-sonnet-4-6",
  // 사후 큐레이터 전용 모델. 분류·요약·짧은 호출 위주라 저렴한 haiku로 충분.
  curatorModel: "claude-haiku-4-5-20251001",

  // 대화 맥락 유지 한도(토큰). 한 대화의 컨텍스트가 이걸 넘으면 다음 메시지부터
  // 새 세션으로 리셋하고 사용자에게 알린다. 잊힌 맥락은 namory가 받쳐줌.
  // 기본 150k = sonnet 200k 창의 75%. 모델 한계·SDK 자동압축 전에 우리가 제어.
  contextTokenLimit: 150_000,

  // 자기 소스 조회용 GitHub 레포. navis가 디스코드 대화 중 read_repo_file/list_repo_files
  // 도구로 자기 코드를 보여줄 수 있게 한다. 컨테이너엔 src/가 없어서(dist만 복사)
  // GitHub Contents API 경유가 유일한 경로.
  //   GITHUB_REPO: "owner/repo" 형태 (예: nu-tree/namory). 미설정이면 도구가 친절한 에러.
  //   GITHUB_TOKEN: 선택. private 레포면 필수, public이어도 있으면 rate limit 60→5000/h.
  githubRepo: optional("GITHUB_REPO"),
  githubToken: optional("GITHUB_TOKEN"),
  // self-improve PR 생성 webhook 검증용 HMAC secret. GitHub repo Settings → Webhooks
  // 등록 시 같은 값을 secret 으로 박는다. 미설정이면 webhook 라우트가 모든 요청을 거부.
  githubWebhookSecret: optional("GITHUB_WEBHOOK_SECRET"),

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

  // 주간 기억 다이제스트: navis가 정기적으로 최근 기억을 요약해 자기이해 프로필에
  // 반영하고(자동 압축), 요약을 디스코드로 보고한다. namory의 수동 profile_update
  // 누락을 메우는 자동화. 이 경로에서만 profile_update를 허용(대화 경로는 계속 차단).
  // 스케줄·기간은 운영 튜닝이라 코드 상수, 채널 id는 배포 의존이라 env.
  digestSchedule: "0 9 * * 1", // 월요일 09시 KST
  digestTimezone: "Asia/Seoul",
  digestDays: 7, // 요약 대상 기간(일) — 지난 한 주
  // 요약을 보고할 디스코드 채널(선택). 없으면 프로필만 갱신하고 포스팅은 생략.
  digestChannelId: optional("DIGEST_CHANNEL_ID"),

  // 봇 성격·행동 지침. 코드에 두지 않고 SYSTEM_PROMPT 환경변수로만 주입한다
  // (레포 공개 대비 — 프롬프트는 .env / Railway 변수에만 존재). 없으면 즉시 종료.
  systemPrompt: required("SYSTEM_PROMPT"),

  // Railway 헬스체크용 포트. 디스코드 봇은 인바운드 HTTP가 필요 없지만
  // 호스팅 uptime 체크를 위해 /health 만 연다.
  port: Number(process.env.PORT) || 3000,
} as const;
