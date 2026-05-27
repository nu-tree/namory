import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CATEGORIES } from "./db/schema.js";
import { save } from "./tools/save.js";
import { recall } from "./tools/recall.js";
import { recent } from "./tools/recent.js";
import { pattern } from "./tools/pattern.js";
import { profileShow, profileUpdate } from "./tools/profile.js";

const category = z.enum(CATEGORIES);

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
        "결정·배움·아이디어·감정·사람에 대한 기록(memory/note)을 임베딩과 함께 저장한다 (save / store / remember).",
      inputSchema: {
        content: z.string().min(1).describe("저장할 내용 (한 문장 이상 권장)"),
        category: category.optional().describe("분류 (선택)"),
        source: z
          .string()
          .optional()
          .describe("출처 (예: claude-desktop, claude-ios)"),
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
      },
    },
    async ({ period, category }) => {
      const days = period === "month" ? 30 : 7;
      const since = new Date(Date.now() - days * 86_400_000);
      return ok(await pattern({ since, category }));
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

  return server;
}
