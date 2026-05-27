import { gte, desc, and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories, type Category } from "../db/schema.js";
import { projectFilter } from "./filter.js";

export async function recent(args: {
  days?: number;
  limit?: number;
  category?: Category;
  project?: string;
}) {
  const since = new Date(Date.now() - (args.days ?? 7) * 86_400_000);
  return db
    .select({
      id: memories.id,
      content: memories.content,
      category: memories.category,
      project: memories.project,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(
      and(
        gte(memories.createdAt, since),
        args.category ? eq(memories.category, args.category) : undefined,
        projectFilter(args.project),
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(args.limit ?? 50);
}
