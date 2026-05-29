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
  tags?: string[];
  related_ids?: string[];
}) {
  const set: Record<string, unknown> = {};

  if (args.content !== undefined) {
    set.content = args.content;
    set.embedding = await embed(args.content, "document");
  }
  if (args.category !== undefined) set.category = args.category;
  // 빈 문자열이면 개인 기억(null)으로 되돌린다.
  if (args.project !== undefined) set.project = args.project || null;

  // metadata 패치는 한 번에 병합 — 여러 필드를 한 update 안에서 같이 바꿔도
  // 마지막 sql 표현이 앞을 덮어쓰지 않도록 단일 patch 객체로 모은다.
  const metaPatch: Record<string, unknown> = {};
  if (args.done !== undefined) {
    metaPatch.done = args.done;
    metaPatch.doneAt = args.done ? new Date().toISOString() : null;
  }
  if (args.tags !== undefined) metaPatch.tags = args.tags;
  if (args.related_ids !== undefined) metaPatch.related_ids = args.related_ids;

  if (Object.keys(metaPatch).length > 0) {
    set.metadata = sql`${memories.metadata} || ${JSON.stringify(metaPatch)}::jsonb`;
  }

  if (Object.keys(set).length === 0) {
    throw new Error(
      "수정할 필드가 없습니다 (content / category / done / project / tags / related_ids 중 하나 필요)",
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
