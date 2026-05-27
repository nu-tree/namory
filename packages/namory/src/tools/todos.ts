import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories } from "../db/schema.js";
import { projectFilter } from "./filter.js";

// 할 일 목록. 기본은 "안 끝난 것만" (metadata.done 이 true 가 아닌 행).
export async function todos(args: {
  includeDone?: boolean;
  limit?: number;
  project?: string;
}) {
  const openOnly = sql`${memories.metadata}->>'done' IS DISTINCT FROM 'true'`;
  const where = and(
    eq(memories.category, "todo"),
    args.includeDone ? undefined : openOnly,
    projectFilter(args.project),
  );

  return db
    .select({
      id: memories.id,
      content: memories.content,
      project: memories.project,
      done: sql<boolean>`COALESCE((${memories.metadata}->>'done')::boolean, false)`,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(where)
    .orderBy(desc(memories.createdAt))
    .limit(args.limit ?? 50);
}
