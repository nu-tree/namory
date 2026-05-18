import { gte, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories } from "../db/schema.js";

export async function recent(args: { days?: number; limit?: number }) {
  const since = new Date(Date.now() - (args.days ?? 7) * 86_400_000);
  return db
    .select({
      id: memories.id,
      content: memories.content,
      category: memories.category,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(gte(memories.createdAt, since))
    .orderBy(desc(memories.createdAt))
    .limit(args.limit ?? 50);
}
