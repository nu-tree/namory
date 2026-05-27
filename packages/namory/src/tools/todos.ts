import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories } from "../db/schema.js";

// 할 일 목록. 기본은 "안 끝난 것만" (metadata.done 이 true 가 아닌 행).
export async function todos(args: { includeDone?: boolean; limit?: number }) {
  const openOnly = sql`${memories.metadata}->>'done' IS DISTINCT FROM 'true'`;
  const where = args.includeDone
    ? eq(memories.category, "todo")
    : and(eq(memories.category, "todo"), openOnly);

  return db
    .select({
      id: memories.id,
      content: memories.content,
      done: sql<boolean>`COALESCE((${memories.metadata}->>'done')::boolean, false)`,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(where)
    .orderBy(desc(memories.createdAt))
    .limit(args.limit ?? 50);
}
