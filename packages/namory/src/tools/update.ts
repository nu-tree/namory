import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories, type Category } from "../db/schema.js";
import { embed } from "../embedding.js";

// 기억 정정/완료 표시. content가 바뀌면 임베딩을 다시 계산한다.
// done은 할 일의 완료 상태로, metadata jsonb에 병합(merge)한다.
export async function update(args: {
  id: string;
  content?: string;
  category?: Category;
  done?: boolean;
  project?: string;
}) {
  const set: Record<string, unknown> = {};

  if (args.content !== undefined) {
    set.content = args.content;
    set.embedding = await embed(args.content, "document");
  }
  if (args.category !== undefined) set.category = args.category;
  // 빈 문자열이면 개인 기억(null)으로 되돌린다.
  if (args.project !== undefined) set.project = args.project || null;
  if (args.done !== undefined) {
    // 기존 metadata를 보존하며 done/doneAt만 덮어쓴다 (jsonb || 병합)
    const patch = {
      done: args.done,
      doneAt: args.done ? new Date().toISOString() : null,
    };
    set.metadata = sql`${memories.metadata} || ${JSON.stringify(patch)}::jsonb`;
  }

  if (Object.keys(set).length === 0) {
    throw new Error(
      "수정할 필드가 없습니다 (content / category / done / project 중 하나 필요)",
    );
  }

  const [row] = await db
    .update(memories)
    .set(set)
    .where(eq(memories.id, args.id))
    .returning({
      id: memories.id,
      content: memories.content,
      category: memories.category,
      metadata: memories.metadata,
    });

  if (!row) throw new Error(`해당 id의 기억이 없습니다: ${args.id}`);
  return row;
}
