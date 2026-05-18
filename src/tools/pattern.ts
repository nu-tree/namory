import { gte, asc, and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories, type Category } from "../db/schema.js";

// 패턴 "익스플로러": 서버는 기간/카테고리로 묶은 raw 데이터만 반환.
// 요약·해석은 Claude(클라이언트)가 — 서버에서 LLM 호출 안 함 (비용 $0 유지).
export async function pattern(args: { since: Date; category?: Category }) {
  const where = args.category
    ? and(gte(memories.createdAt, args.since), eq(memories.category, args.category))
    : gte(memories.createdAt, args.since);

  return db
    .select({
      content: memories.content,
      category: memories.category,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(where)
    .orderBy(asc(memories.createdAt));
}
