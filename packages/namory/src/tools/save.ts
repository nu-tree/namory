import { db } from "../db/client.js";
import { memories, type Category } from "../db/schema.js";
import { embed } from "../embedding.js";

export async function save(args: {
  content: string;
  category?: Category;
  source?: string;
}) {
  const embedding = await embed(args.content, "document");
  const [row] = await db
    .insert(memories)
    .values({
      content: args.content,
      category: args.category ?? null,
      source: args.source ?? null,
      embedding,
    })
    .returning({ id: memories.id, createdAt: memories.createdAt });
  return row;
}
