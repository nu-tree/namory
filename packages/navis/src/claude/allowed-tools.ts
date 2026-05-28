// askClaude가 자동 승인하는 도구 화이트리스트.
// allowedTools에 한 번이라도 값을 지정하면 SDK가 화이트리스트 모드로 전환되므로
// MCP 도구뿐 아니라 Claude 내장 도구도 명시해야 헤드리스 환경에서 권한 막힘이 없다.

// ── namory MCP ───────────────────────────────────────────────
// 읽기(recall/recent/profile_show/pattern/todos) + 추가(save) + 수정(update).
// update는 todo 완료 처리·기억 수정용이며, 시스템 프롬프트에서 "사용자가 명시적으로
// 요청할 때만" 쓰도록 가드한다. 비가역 삭제(delete)와 profile_update는 미허용 —
// navis는 인젝션 위험 surface라 기억을 지우거나 프로필을 자동으로 덮어쓰지 못하게 한다.
export const NAMORY_TOOLS = [
  "mcp__namory__recall",
  "mcp__namory__recent",
  "mcp__namory__profile_show",
  "mcp__namory__pattern",
  "mcp__namory__todos",
  "mcp__namory__save",
  "mcp__namory__update",
];

// 신뢰된 다이제스트 경로(allowProfileUpdate)에서만 추가로 풀어주는 도구.
export const NAMORY_PROFILE_UPDATE_TOOL = "mcp__namory__profile_update";

// ── 파일/셸 (코드 수정용) ────────────────────────────────────
// navis가 코드를 읽고·수정·실행까지 할 수 있게 푼다. 본인만 쓰는 도구라는 전제.
// 외부에 노출되는 채널(디스코드)에서도 같은 권한이라 인젝션 위험은 ALLOWED_USER_IDS
// 게이트로 1차 차단(허용 유저 외에는 메시지 자체를 처리하지 않음).
const FILE_TOOLS = ["Read", "Write", "Edit", "NotebookEdit"];
const SHELL_TOOLS = ["Bash", "BashOutput", "KillShell"];
const SEARCH_TOOLS = ["Glob", "Grep"];

// ── 웹 ───────────────────────────────────────────────────────
const WEB_TOOLS = ["WebSearch", "WebFetch"];

// ── 작업 추적 ────────────────────────────────────────────────
// 긴 작업을 모델이 스스로 트래킹하도록 TodoWrite 허용. 사용자에게도 진척이 보임.
const TASK_TOOLS = ["TodoWrite"];

// 메인 턴(askClaude)이 항상 자동 승인할 내장 도구.
// 외부 MCP(노션/구글/크론)는 옵션이라 ask.ts에서 동적으로 합친다.
export const BUILTIN_TOOLS = [
  ...FILE_TOOLS,
  ...SHELL_TOOLS,
  ...SEARCH_TOOLS,
  ...WEB_TOOLS,
  ...TASK_TOOLS,
];
