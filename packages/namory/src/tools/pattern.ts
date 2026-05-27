import { gte, asc, and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories, type Category } from "../db/schema.js";
import { projectFilter } from "./filter.js";

// 패턴 "익스플로러": 서버는 기간/카테고리로 묶은 raw 데이터만 반환.
// 요약·해석은 Claude(클라이언트)가 — 서버에서 LLM 호출 안 함 (비용 $0 유지).
export async function pattern(args: {
  since: Date;
  category?: Category;
  project?: string;
}) {
  const where = and(
    gte(memories.createdAt, args.since),
    args.category ? eq(memories.category, args.category) : undefined,
    projectFilter(args.project),
  );

  return db
    .select({
      content: memories.content,
      category: memories.category,
      project: memories.project,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(where)
    .orderBy(asc(memories.createdAt));
}
