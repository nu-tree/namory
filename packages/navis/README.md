# navis — 나비스

> namory(기억 저장소)를 등에 업고 사용자와 양방향으로 대화하는 제2의 뇌 에이전트.
> 같은 두뇌(askClaude)를 **디스코드 봇** · **터미널 CLI** 두 채널에서 공유한다.

- 이름: 라틴어 *navis*(배). namory(기억)를 싣고 오가는 배.
- 두뇌: Claude Agent SDK + Claude Code 구독 OAuth 토큰
- 기억: namory MCP (외부 HTTP)
- 자동화: 사용자 트리거 크론 + 주간 다이제스트

## 두 가지 실행 모드

| 모드 | 진입점 | 용도 |
| --- | --- | --- |
| 디스코드 봇 | `src/index.ts` (`pnpm dev`, `pnpm start`) | always-on 워커. 메시지·이미지 처리 + 크론·다이제스트 스케줄러 |
| 터미널 CLI | `src/cli.tsx` (`pnpm cli`, `navis`) | Ink 기반 REPL. 프로젝트 자동 태깅 |

두 모드 모두 같은 `askClaude` + 사후 큐레이터(`curateTurn`)를 거치므로 저장·맥락 동작이 일관.

## 폴더 구조

```
src/
├── cli.tsx              # CLI 진입점 (Ink REPL)
├── index.ts             # 봇 진입점 (Discord + cron + digest + health)
├── config.ts            # env 로드 + 검증
├── digest.ts            # 주간 기억 다이제스트
├── project.ts           # 프로젝트 자동 감지 (.navis | package.json)
├── claude/
│   ├── ask.ts           # askClaude — 메인 LLM 호출
│   ├── curator.ts       # 사후 큐레이터 (Haiku, save/recall만)
│   ├── allowed-tools.ts # 도구 화이트리스트 (namory/내장/MCP)
│   ├── mcp.ts           # 외부 MCP 서버 빌더 (HTTP/stdio)
│   ├── nudge.ts         # 저장 너지 키워드
│   └── types.ts         # InputImage, AskResult
├── discord/
│   ├── bot.ts           # startDiscord + handleMessage
│   ├── image.ts         # 첨부 이미지 다운로드/리사이즈
│   └── send.ts          # chunk + sendToChannel (공통)
└── cron/
    ├── scheduler.ts     # node-cron 등록·동기화
    ├── api.ts           # namory /crons REST 클라이언트
    └── mcp.ts           # 모델이 호출하는 cron_{create,list,delete}
```

## 셋업

```bash
pnpm install
cp .env.example .env             # 토큰들 채우기
pnpm dev                          # 디스코드 봇 모드(watch)
pnpm cli                          # 터미널 REPL 모드
```

### env 우선순위 (자동 로드)

`config.ts`가 `process.loadEnvFile()`로 첫 번째 존재하는 파일을 읽는다:

1. `./.env` (개발용)
2. `~/.config/navis/env` (글로벌 설치용 — XDG)
3. 이미 export된 `process.env` (Railway 등 호스팅)

## Claude에 허용된 도구

`src/claude/allowed-tools.ts` 한 곳에서 관리.

| 카테고리 | 도구 | 권한 근거 |
| --- | --- | --- |
| namory MCP | `recall`, `recent`, `profile_show`, `pattern`, `todos`, `save`, `update` | 본 사용 흐름 |
| namory(제한) | `profile_update` | 다이제스트 경로(`allowProfileUpdate=true`)에서만 |
| 파일 | `Read`, `Write`, `Edit`, `NotebookEdit` | 코드 수정 |
| 셸 | `Bash`, `BashOutput`, `KillShell` | 빌드/실행/탐색 |
| 탐색 | `Glob`, `Grep` | 코드 탐색 |
| 웹 | `WebSearch`, `WebFetch` | 리서치 |
| 작업 추적 | `TodoWrite` | 긴 작업 분해 |
| 외부 MCP | `mcp__notion`, `mcp__google` | env 토큰 있을 때만 |
| 크론 도구 | `cron_create`, `cron_list`, `cron_delete` | 디스코드 세션에서만 |

> `delete`(기억 삭제)와 일반 경로의 `profile_update`는 절대 미허용 — 디스코드는 인젝션 surface라 비가역 동작을 차단한다.

## 디스코드 봇 동작

- Gateway WebSocket(아웃바운드) → 공개 도메인 불필요
- `ALLOWED_USER_IDS`만 처리 (인젝션 1차 게이트)
- 채널별 in-memory 세션 (`sessionId` + `contextTokens`)
- 토큰 한도(`contextTokenLimit`, 기본 100k) 도달 시 다음 메시지부터 새 세션 + 사용자에게 알림
- `/reset`으로 수동 초기화
- 큰 이미지(긴 변 1568px 초과)는 sharp로 비율 유지 축소
- 저장 발생 시 사용자 메시지에 💡 리액션

## CLI 동작

- Ink(React-for-CLI) REPL — `‹` 입력선, `Static`으로 과거 턴 보존
- `Ctrl+C`로 종료, `/quit` `/reset` `/project` 슬래시 명령
- 시작 디렉터리에서 프로젝트 자동 감지(`.navis` 파일 → `package.json name`) → 이 대화의 `save` 호출이 자동으로 `project` 태깅

## 자동화

### 사용자 트리거 크론 (`cron/*`)
디스코드 대화에서 "매일 ~ 해줘"라고 하면 모델이 `cron_create`로 등록. 실제 스케줄링은 navis(`node-cron`)가 하고, 영속화는 namory(`/crons` REST)가 한다. 발동 결과는 등록한 채널로 전송.

### 주간 다이제스트 (`digest.ts`)
기본 매주 월 09시 KST — 최근 7일 기억을 navis가 요약하고 자기이해 프로필을 `profile_update`로 갱신, 요약을 `DIGEST_CHANNEL_ID`로 보고. 이 경로에서만 `profile_update` 허용 (인젝션 방어).

## 배포 (Railway)

- `Dockerfile` + `railway.json` 제공
- 인바운드 HTTP 불필요(Gateway가 outbound) — 단, `/health` 엔드포인트만 uptime 체크용으로 열어둠
- env: `DISCORD_TOKEN`, `ALLOWED_USER_IDS`, `CLAUDE_CODE_OAUTH_TOKEN`, `NAMORY_MCP_URL`, `NAMORY_TOKEN`, `SYSTEM_PROMPT` 필수

## 자기 개선 (멀티 에이전트)

navis 가 자기 코드를 스스로 수정할 수 있는 4계층 흐름:

```
[너] → [① 메인 navis (오케스트레이터)]
              ↓ repository_dispatch
       [② Actions 안의 Claude Code (Opus 4.7, 코드 수정 서브에이전트)]
              ↓ webhook (PR 생성)
       [③ navis 안의 검토 서브에이전트 (Sonnet 4.6, critic)]
              ↓
       [① 메인 navis 가 채널로 보고] → [너]
```

비동기: ① 은 트리거만 던지고 즉시 응답, ② 는 격리 Actions 에서 작업, ③ 은 fire-and-forget. 너 디스코드 채팅은 막히지 않음.

### 셋업 (1회)

1. **GitHub PAT 권한 확장**
   - 기존 `GITHUB_TOKEN` PAT 에 **`Actions: Write`** 권한 추가 (`Contents: Read` 는 이미 있음).
   - navis 봇이 `repository_dispatch` 를 던질 권한이 필요.

2. **GitHub Actions secret 등록** (`repo Settings → Secrets and variables → Actions`)
   - `CLAUDE_CODE_OAUTH_TOKEN` — 너 Max 구독 OAuth 토큰. `claude setup-token` 으로 발급한 그 값을 그대로.

3. **Repo Settings → Actions → General → Workflow permissions**
   - `Read and write permissions` 선택.
   - `Allow GitHub Actions to create and approve pull requests` 체크.

4. **GitHub webhook 등록** (`repo Settings → Webhooks → Add webhook`)
   - Payload URL: `https://<navis-railway-url>/webhook/github`
   - Content type: `application/json`
   - Secret: 임의 문자열 (예: `openssl rand -hex 32`) — 같은 값을 navis env `GITHUB_WEBHOOK_SECRET` 에 박는다.
   - Events: `Let me select individual events` → `Pull requests` 만 체크.

5. **navis env 갱신** — 로컬 `.env` 와 Railway Variables 둘 다:
   ```
   GITHUB_WEBHOOK_SECRET=<위에서 정한 secret>
   ```

### 사용

디스코드에서 그냥 자연어로:

```
너: navis야, packages/navis/src/claude/ask.ts 의 maxTurns 16 을 20 으로 올려줘
navis: 🔧 코드 수정 서브에이전트에게 작업 의뢰 전송 완료 (dispatch_id=...).
       Actions 가 격리 환경에서 코드를 수정하고 PR 을 만들면 별도 메시지로
       보고됨. 그동안 다른 얘기 계속해도 돼.

[몇 분 뒤, 자동으로 같은 채널에]

navis: 🤖 검토 서브에이전트 — PR #42: navis self-improve: maxTurns 20

       [요약] ask.ts:114 maxTurns 16 → 20 한 줄 변경.
       [의도 일치] OK — 지시 그대로.
       [안전성] 안전. 한도 늘림은 회귀 위험 없음.
       [권고] 머지 OK.

       https://github.com/nu-tree/navis/pull/42
```

너는 PR 보고 머지만. Railway 자동 배포로 다음 응답부터 새 navis.

### 안전 게이트

- **변경 가능 경로 화이트리스트**: `packages/{navis,namory}/src/**` 만. `.github/**`, `Dockerfile`, `*.lock`, `.env*` 절대 금지 (워크플로 시스템 프롬프트 강제).
- **빌드 통과 강제**: `pnpm -r build` 실패 시 PR 생성 자체 차단.
- **자동 머지 없음**: 항상 PR. 너 검토 강제.
- **webhook HMAC 검증**: secret 모르는 외부 요청은 401 거부.
- **dispatch_id 매핑**: in-memory 30분 TTL. 어느 채널에서 시작한 작업인지 추적.

## 글로벌 설치 (Homebrew)

```bash
brew tap nu-tree/navis
brew install navis
mkdir -p ~/.config/navis && $EDITOR ~/.config/navis/env  # env 채움
navis                                                     # 어디서나 실행
```
