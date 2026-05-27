import { sql, cosineDistance, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories } from "../db/schema.js";
import { embed } from "../embedding.js";

export async function recall(args: { query: string; limit?: number }) {
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
    .orderBy(desc(similarity))
    .limit(args.limit ?? 5);
}
