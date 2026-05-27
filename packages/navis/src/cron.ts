import cron, { type ScheduledTask } from "node-cron";
import type { Client } from "discord.js";
import { config } from "./config.js";
import { askClaude } from "./claude.js";
import { chunk } from "./discord.js";

// 선제적 알림 스케줄러. 영속화는 namory(REST /crons)가, 스케줄링/전송은 여기서.
// 부팅 시 namory에서 잡을 읽어 등록하고, 발동하면 askClaude로 실행해 채널로 보낸다.

export interface CronRow {
  id: string;
  title: string;
  schedule: string;
  timezone: string;
  prompt: string;
  channelId: string;
  enabled: boolean;
}

// namoryMcpUrl(".../mcp")에서 베이스 URL을 떼어 REST(/crons)에 쓴다.
const BASE = config.namoryMcpUrl.replace(/\/mcp\/?$/, "");
const auth = { Authorization: `Bearer ${config.namoryToken}` };

export async function fetchCrons(): Promise<CronRow[]> {
  const res = await fetch(`${BASE}/crons`, { headers: auth });
  if (!res.ok) throw new Error(`크론 조회 실패: ${res.status}`);
  const data = (await res.json()) as { crons?: CronRow[] };
  return data.crons ?? [];
}

export async function createCronRemote(input: {
  title: string;
  schedule: string;
  prompt: string;
  channelId: string;
  timezone?: string;
}): Promise<CronRow> {
  const res = await fetch(`${BASE}/crons`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`크론 생성 실패: ${res.status} ${await res.text()}`);
  return (await res.json()) as CronRow;
}

export async function deleteCronRemote(id: string): Promise<void> {
  const res = await fetch(`${BASE}/crons/${id}`, { method: "DELETE", headers: auth });
  if (!res.ok) throw new Error(`크론 삭제 실패: ${res.status}`);
}

// ── 스케줄러 상태 ──────────────────────────────────────────────
// id → {task, sig}. sig는 schedule|timezone|enabled 로, 바뀐 잡만 다시 건다.
const jobs = new Map<string, { task: ScheduledTask; sig: string }>();
let discord: Client;

const sigOf = (c: CronRow) => `${c.schedule}|${c.timezone}|${c.enabled}`;

// 잡 하나를 등록(또는 갱신). enabled=false거나 식이 틀리면 등록하지 않는다.
export function scheduleCron(c: CronRow): void {
  const existing = jobs.get(c.id);
  if (existing) {
    if (existing.sig === sigOf(c)) return; // 변화 없음 → 유지
    existing.task.stop();
    jobs.delete(c.id);
  }
  if (!c.enabled) return;
  if (!cron.validate(c.schedule)) {
    console.error(`[cron] 잘못된 식, 건너뜀: '${c.title}' (${c.schedule})`);
    return;
  }
  const task = cron.schedule(c.schedule, () => void runCron(c), {
    timezone: c.timezone,
  });
  jobs.set(c.id, { task, sig: sigOf(c) });
  console.log(`[cron] 등록: '${c.title}' (${c.schedule} ${c.timezone})`);
}

export function unscheduleCron(id: string): void {
  const j = jobs.get(id);
  if (j) {
    j.task.stop();
    jobs.delete(id);
  }
}

// 발동 시: 프롬프트를 새 세션으로 실행하고 결과를 등록 채널로 보낸다.
async function runCron(c: CronRow): Promise<void> {
  console.log(`[cron] 발동: '${c.title}'`);
  try {
    const { text } = await askClaude(c.prompt);
    await sendToChannel(c.channelId, text);
  } catch (err) {
    console.error(`[cron] '${c.title}' 실행 실패:`, err);
  }
}

async function sendToChannel(channelId: string, text: string): Promise<void> {
  const ch = await discord.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isSendable()) {
    console.error(`[cron] 채널 전송 불가: ${channelId}`);
    return;
  }
  for (const part of chunk(text)) await ch.send(part);
}

// namory의 잡 목록과 현재 등록 상태를 맞춘다(추가/변경/삭제 반영).
export async function reconcile(): Promise<void> {
  const rows = await fetchCrons();
  const ids = new Set(rows.map((r) => r.id));
  for (const id of [...jobs.keys()]) if (!ids.has(id)) unscheduleCron(id);
  for (const r of rows) scheduleCron(r);
}

// 부팅 시 호출. 초기 로드 + 1분마다 동기화(직접 DB 변경/다중 인스턴스 대비).
export async function startCronScheduler(client: Client): Promise<void> {
  discord = client;
  await reconcile().catch((err) => console.error("[cron] 초기 로드 실패:", err));
  cron.schedule("* * * * *", () => void reconcile().catch(() => {}));
  console.log(`[cron] 스케줄러 시작 (등록 ${jobs.size}건)`);
}
