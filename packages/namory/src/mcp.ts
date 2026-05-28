import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CATEGORIES } from "./db/schema.js";
import { save } from "./tools/save.js";
import { recall } from "./tools/recall.js";
import { recent } from "./tools/recent.js";
import { pattern } from "./tools/pattern.js";
import { profileShow, profileUpdate } from "./tools/profile.js";
import { update } from "./tools/update.js";
import { remove } from "./tools/remove.js";
import { todos } from "./tools/todos.js";

const category = z.enum(CATEGORIES);
// 프로젝트 스코프(선택). 저장 시 태그, 조회 시 "그 프로젝트 + 개인 기억"으로 좁힌다.
const project = z
  .string()
  .min(1)
  .optional()
  .describe("프로젝트 스코프 (선택). 예: navis. 조회 시 해당 프로젝트+개인 기억만.");

// 서버는 "멍청하게": raw 데이터를 JSON 텍스트로만 돌려준다.
// 패턴 해석·요약·프로파일 작성 등 지능은 클라이언트(Claude)가 수행 → 서버 LLM 호출 0.
const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: "namory", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "save",
    {
      title: "기억 저장 (save / store memory)",
      description:
        "결정·배움·아이디어·감정·사람·할 일에 대한 기록(memory/note/todo)을 임베딩과 함께 저장한다 (save / store / remember). category가 todo면 '안 끝난 할 일'로 시작한다. " +
        "기본 동작은 중복 방지 — 임계값 이상 유사 기억이 있으면 저장하지 않고 응답의 duplicates에 후보를 담아 skipped:true로 반환한다. " +
        "그 경우 update(병합) 또는 그대로 두기를 결정. 의도적으로 중복을 허용하려면 skipIfDuplicate:false 명시.",
      inputSchema: {
        content: z.string().min(1).describe("저장할 내용 (한 문장 이상 권장)"),
        category: category.optional().describe("분류 (선택). todo = 할 일"),
        project,
        source: z
          .string()
          .optional()
          .describe("출처 (예: claude-desktop, claude-ios)"),
        skipIfDuplicate: z
          .boolean()
          .optional()
          .describe(
            "기본 true — 유사 기억이 있으면 저장하지 않고 후보만 반환(skipped:true). 의도적 중복 허용 시 false.",
          ),
      },
    },
    async (args) => ok(await save(args)),
  );

  server.registerTool(
    "recall",
    {
      title: "의미 검색 (recall / semantic search)",
      description:
        "질의와 의미적으로 가까운 기억(memory)을 벡터 검색으로 찾는다 (recall / search / find).",
      inputSchema: {
        query: z.string().min(1).describe("찾고 싶은 내용/주제"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("최대 개수 (기본 5)"),
        category: category.optional().describe("분류 필터 (선택)"),
        project,
      },
    },
    async (args) => ok(await recall(args)),
  );

  server.registerTool(
    "recent",
    {
      title: "최근 기억 (recent memories)",
      description:
        "최근 N일간의 기억(memory)을 시간 역순으로 가져온다 (recent / latest / history).",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe("거슬러 볼 일수 (기본 7)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("최대 개수 (기본 50)"),
        category: category.optional().describe("분류 필터 (선택)"),
        project,
      },
    },
    async (args) => ok(await recent(args)),
  );

  server.registerTool(
    "pattern",
    {
      title: "패턴 익스플로러 (pattern explorer)",
      description:
        "기간/카테고리로 묶은 raw 기억(memory)을 시간순으로 반환한다 (pattern / trend / explore). 패턴 해석·요약은 클라이언트(Claude)가 수행한다.",
      inputSchema: {
        period: z
          .enum(["week", "month"])
          .optional()
          .describe("집계 기간 (기본 week)"),
        category: category.optional().describe("분류 필터 (선택)"),
        project,
      },
    },
    async ({ period, category, project }) => {
      const days = period === "month" ? 30 : 7;
      const since = new Date(Date.now() - days * 86_400_000);
      return ok(await pattern({ since, category, project }));
    },
  );

  server.registerTool(
    "profile_show",
    {
      title: "자기 이해 조회 (profile show)",
      description:
        "누적된 자기 이해 프로필(self-understanding profile)을 섹션별로 조회한다 (profile / show / get).",
      inputSchema: {},
    },
    async () => ok(await profileShow()),
  );

  server.registerTool(
    "profile_update",
    {
      title: "자기 이해 갱신 (profile update)",
      description:
        "Claude가 누적 기억을 보고 작성한 섹션 텍스트를 저장한다 (profile / update). 서버는 저장만 — 작성은 Claude.",
      inputSchema: {
        section: z
          .string()
          .min(1)
          .describe("섹션명 (values / patterns / goals ...)"),
        content: z.string().min(1).describe("섹션 본문"),
      },
    },
    async (args) => ok(await profileUpdate(args)),
  );

  server.registerTool(
    "update",
    {
      title: "기억 정정/완료 (update / edit / complete)",
      description:
        "기존 기억을 id로 수정한다 (update / edit / fix). content를 바꾸면 임베딩을 재계산하고, done으로 할 일을 완료/미완료 처리한다 (complete / done / reopen).",
      inputSchema: {
        id: z.string().min(1).describe("수정할 기억의 id"),
        content: z.string().min(1).optional().describe("새 본문 (바꾸면 재임베딩)"),
        category: category.optional().describe("새 분류"),
        done: z
          .boolean()
          .optional()
          .describe("할 일 완료 여부 (true=완료, false=다시 열기)"),
        project: z
          .string()
          .optional()
          .describe("프로젝트 재태깅 (빈 문자열이면 개인 기억으로 되돌림)"),
      },
    },
    async (args) => ok(await update(args)),
  );

  server.registerTool(
    "delete",
    {
      title: "기억 삭제 (delete / remove)",
      description:
        "틀렸거나 필요 없어진 기억을 id로 영구 삭제한다 (delete / remove / forget).",
      inputSchema: {
        id: z.string().min(1).describe("삭제할 기억의 id"),
      },
    },
    async (args) => ok(await remove(args)),
  );

  server.registerTool(
    "todos",
    {
      title: "할 일 목록 (todos / tasks)",
      description:
        "할 일(todo)을 시간 역순으로 가져온다 (todos / tasks / to-do). 기본은 안 끝난 것만 보여준다.",
      inputSchema: {
        includeDone: z
          .boolean()
          .optional()
          .describe("완료한 할 일도 포함할지 (기본 false = 미완료만)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("최대 개수 (기본 50)"),
        project,
      },
    },
    async (args) => ok(await todos(args)),
  );

  return server;
}
