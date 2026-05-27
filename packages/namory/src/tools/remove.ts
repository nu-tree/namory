import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories } from "../db/schema.js";

// 틀린/필요 없어진 기억을 영구 삭제한다.
export async function remove(args: { id: string }) {
  const [row] = await db
    .delete(memories)
    .where(eq(memories.id, args.id))
    .returning({ id: memories.id });

  if (!row) throw new Error(`해당 id의 기억이 없습니다: ${args.id}`);
  return { deleted: row.id };
}
