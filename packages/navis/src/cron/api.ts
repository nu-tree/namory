import { config } from "../config.js";

// namory의 크론 REST 엔드포인트(/crons) 클라이언트.
// 영속화는 namory가, 스케줄링/전송은 cron/scheduler.ts가 담당한다.

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
