import { sql, cosineDistance, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories, type Category } from "../db/schema.js";
import { embed } from "../embedding.js";

export async function recall(args: {
  query: string;
  limit?: number;
  category?: Category;
}) {
  const queryEmbedding = await embed(args.query, "query");
  const similarity = sql<number>`1 - (${cosineDistance(
    memories.embedding,
    queryEmbedding,
  )})`;

  return db
    .select({
      id: memories.id,
      content: memories.content,
      category: memories.category,
      createdAt: memories.createdAt,
      similarity,
    })
    .from(memories)
    .where(args.category ? eq(memories.category, args.category) : undefined)
    .orderBy(desc(similarity))
    .limit(args.limit ?? 5);
}
