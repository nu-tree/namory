import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { crons } from "../db/schema.js";

// 크론(선제적 알림 스케줄) CRUD. namory는 영속화만 담당 —
// 실제 스케줄링/전송은 navis(node-cron)가 이 데이터를 읽어 수행한다.

export async function listCrons(args?: { enabledOnly?: boolean }) {
  const rows = await db.select().from(crons).orderBy(desc(crons.createdAt));
  return args?.enabledOnly ? rows.filter((c) => c.enabled) : rows;
}

export async function createCron(args: {
  title: string;
  schedule: string;
  prompt: string;
  channelId: string;
  timezone?: string;
}) {
  const [row] = await db
    .insert(crons)
    .values({
      title: args.title,
      schedule: args.schedule,
      prompt: args.prompt,
      channelId: args.channelId,
      timezone: args.timezone ?? "Asia/Seoul",
    })
    .returning();
  return row;
}

export async function deleteCron(args: { id: string }) {
  const [row] = await db
    .delete(crons)
    .where(eq(crons.id, args.id))
    .returning({ id: crons.id });
  if (!row) throw new Error(`해당 id의 크론이 없습니다: ${args.id}`);
  return row;
}
