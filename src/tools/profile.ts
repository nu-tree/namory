import { db } from "../db/client.js";
import { profile } from "../db/schema.js";

export function profileShow() {
  return db.select().from(profile);
}

// Claude가 누적 기억을 보고 작성한 섹션 텍스트를 저장 (서버는 저장만).
export async function profileUpdate(args: { section: string; content: string }) {
  const [row] = await db
    .insert(profile)
    .values({ section: args.section, content: args.content })
    .onConflictDoUpdate({
      target: profile.section,
      set: { content: args.content, updatedAt: new Date() },
    })
    .returning();
  return row;
}
