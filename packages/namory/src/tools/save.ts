import { db } from "../db/client.js";
import { memories, type Category } from "../db/schema.js";
import { embed } from "../embedding.js";

export async function save(args: {
  content: string;
  category?: Category;
  source?: string;
}) {
  const embedding = await embed(args.content, "document");
  // 할 일은 "상태"가 있다 → metadata에 done 플래그를 심어 둔다 (열림으로 시작).
  const metadata = args.category === "todo" ? { done: false, doneAt: null } : {};
  const [row] = await db
    .insert(memories)
    .values({
      content: args.content,
      category: args.category ?? null,
      source: args.source ?? null,
      metadata,
      embedding,
    })
    .returning({ id: memories.id, createdAt: memories.createdAt });
  return row;
}
