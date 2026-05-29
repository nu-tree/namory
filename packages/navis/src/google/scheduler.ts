import cron from "node-cron";
import type { Client } from "discord.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config.js";
import { sendToChannel } from "../discord/send.js";
import { getCalendar, isCalendarEnabled } from "./auth.js";

// 자동 일정 처리 스케줄러.
//
// 잡 1) 다가오는 일정 알림 (매 30분)
//   - 다음 90분 안 시작 일정을 polling
//   - 새 일정마다 LLM sub-agent 가 namory 컨텍스트(recall) 와 함께 평가
//   - "빠뜨린 거 / 준비할 거 / 조언" 짧게 채널에 발송
//   - in-memory Set 으로 중복 알림 방지 (컨테이너 재시작 시 손실 = 의도된 단순함)
//
// 잡 2) 지난 일정 follow-up (매일 23시)
//   - 오늘 끝난 일정을 따와 sub-agent 가 "follow-up todo" 가 있을지 판단
//   - 있으면 namory save 로 직접 저장 (장기 기억 + 할 일 큐)

const TIMEZONE = "Asia/Seoul";
const UPCOMING_WINDOW_MIN = 90; // 다음 N분 안 시작이면 임박 판정
const UPCOMING_CHECK_CRON = "*/30 * * * *"; // 매 30분
const FOLLOWUP_CRON = "0 23 * * *"; // 매일 23시

// 이미 알림 보낸 이벤트 id. recurring 인스턴스도 고유 id 라 그대로 OK.
const notifiedEvents = new Set<string>();

// 알림은 너무 빨리/늦게 보내지 않게 24h 가 지나면 잊는다 (재발 일정 대비 너무 길지 않게).
const NOTIFIED_TTL_MS = 24 * 60 * 60 * 1000;
const notifiedAt = new Map<string, number>();

function markNotified(id: string): void {
  notifiedEvents.add(id);
  notifiedAt.set(id, Date.now());
  // 오래된 항목 정리
  const cutoff = Date.now() - NOTIFIED_TTL_MS;
  for (const [k, t] of notifiedAt) {
    if (t < cutoff) {
      notifiedAt.delete(k);
      notifiedEvents.delete(k);
    }
  }
}

let discord: Client;

export function startCalendarScheduler(client: Client): void {
  discord = client;
  if (!isCalendarEnabled()) {
    console.log("[calendar] 비활성 (GOOGLE_* env 미설정) — 스케줄러 미시작");
    return;
  }
  if (!config.navisChannelId) {
    console.log("[calendar] NAVIS_CHANNEL_ID 미설정 — 자동 알림 미시작 (도구는 동작)");
    return;
  }
  cron.schedule(UPCOMING_CHECK_CRON, () => void runUpcomingCheck(), { timezone: TIMEZONE });
  cron.schedule(FOLLOWUP_CRON, () => void runDailyFollowup(), { timezone: TIMEZONE });
  console.log(
    `[calendar] 스케줄러 시작 — upcoming '${UPCOMING_CHECK_CRON}', followup '${FOLLOWUP_CRON}' (${TIMEZONE})`,
  );
}

// ── 잡 1: 다가오는 일정 알림 ─────────────────────────────────
async function runUpcomingCheck(): Promise<void> {
  if (!config.navisChannelId) return;
  try {
    const { cal } = getCalendar();
    const now = new Date();
    const horizon = new Date(now.getTime() + UPCOMING_WINDOW_MIN * 60_000);
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: horizon.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 20,
    });
    const events = res.data.items ?? [];
    for (const e of events) {
      if (!e.id || notifiedEvents.has(e.id)) continue;
      // 종일 일정은 start.date 만 있고 시간 정보 없음 → 임박 알림 대상에서 제외.
      if (!e.start?.dateTime) continue;
      try {
        await notifyUpcoming(e);
      } catch (err) {
        console.error("[calendar] 일정 알림 발송 실패:", e.id, err);
      }
      markNotified(e.id); // 성공/실패 모두 mark — 실패해도 다음 cron에서 중복 알림 방지
    }
  } catch (err) {
    console.error("[calendar] upcoming 실패:", err);
  }
}

async function notifyUpcoming(e: {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: { dateTime?: string | null } | null;
  end?: { dateTime?: string | null } | null;
  htmlLink?: string | null;
}): Promise<void> {
  if (!config.navisChannelId) return;
  const verdict = await evaluateUpcoming(e);
  const start = e.start?.dateTime
    ? new Date(e.start.dateTime).toLocaleString("ko-KR", { timeZone: TIMEZONE })
    : "(시간 미정)";
  const lines = [
    `**임박한 일정** — ${e.summary ?? "(제목 없음)"}`,
    `시작: ${start}${e.location ? ` · 장소: ${e.location}` : ""}`,
    "",
    verdict,
  ];
  if (e.htmlLink) lines.push("", e.htmlLink);
  await sendToChannel(discord, config.navisChannelId, lines.join("\n"), "calendar");
}

// 다가오는 일정 1건에 대해 sub-agent 가 namory 컨텍스트 보고 짧게 평가.
const UPCOMING_SYSTEM_PROMPT = `너는 navis 의 일정 도우미 서브에이전트다. 곧 시작할 일정 정보를 받아 짧고 실용적인 조언을 한국어로 3~5줄로 준다.

작업:
1) namory recall 로 일정 제목/장소/참가자 관련 과거 기억을 1~2회 찾아본다(필요할 때만).
2) 다음 3가지를 골라 짧게: 빠뜨릴 만한 준비물·맥락, 시간/장소 주의, 한 줄 격려/조언.
3) 모르면 모른다고. 추측 금지. 5줄 넘기지 말 것.
4) markdown 헤더 금지(디스코드에 그대로 발송). 머리말("**임박한 일정**") 붙이지 말 것 — 호출자가 붙임.`;

async function evaluateUpcoming(e: {
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: { dateTime?: string | null } | null;
  end?: { dateTime?: string | null } | null;
}): Promise<string> {
  const prompt = [
    "[다가오는 일정 정보]",
    `제목: ${e.summary ?? "(없음)"}`,
    `시작: ${e.start?.dateTime ?? "(미정)"}`,
    `종료: ${e.end?.dateTime ?? "(미정)"}`,
    e.location ? `장소: ${e.location}` : "",
    e.description ? `설명: ${e.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  let text = "";
  try {
    for await (const message of query({
      prompt,
      options: {
        model: config.model,
        systemPrompt: UPCOMING_SYSTEM_PROMPT,
        mcpServers: {
          namory: {
            type: "http",
            url: config.namoryMcpUrl,
            headers: { Authorization: `Bearer ${config.namoryToken}` },
            alwaysLoad: true,
          },
        },
        // 읽기만 — recall/recent. 절대 save·update·delete 금지.
        allowedTools: ["mcp__namory__recall", "mcp__namory__recent"],
        settingSources: [],
        maxTurns: 4,
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        text = message.result;
      }
    }
  } catch (err) {
    console.error("[calendar] upcoming 평가 실패:", err);
    return "(평가 생략)";
  }
  return text.trim() || "(평가 응답 없음)";
}

// ── 잡 2: 매일 follow-up ────────────────────────────────────
async function runDailyFollowup(): Promise<void> {
  if (!config.navisChannelId) return;
  try {
    const { cal } = getCalendar();
    const now = new Date();
    // 오늘 00:00 KST ~ 지금까지 끝난 일정만 follow-up 대상.
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const res = await cal.events.list({
      calendarId: "primary",
      timeMin: startOfDay.toISOString(),
      timeMax: now.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });
    const events = res.data.items ?? [];
    if (events.length === 0) {
      console.log("[calendar] follow-up: 오늘 끝난 일정 없음");
      return;
    }
    const summary = await runFollowupAgent(events);
    if (summary && config.navisChannelId) {
      await sendToChannel(
        discord,
        config.navisChannelId,
        `**오늘 일정 follow-up**\n\n${summary}`,
        "calendar",
      );
    }
  } catch (err) {
    console.error("[calendar] follow-up 실패:", err);
  }
}

const FOLLOWUP_SYSTEM_PROMPT = `너는 navis 의 일정 follow-up 서브에이전트다. 오늘 끝난 일정 목록을 받아 다음을 수행:

1) 각 일정마다 후속 작업이 필요할지 짧게 판단 (없으면 건너뛰기 — 무리하게 만들지 말 것).
2) 진짜 필요한 follow-up 만 mcp__namory__save 로 category="todo" 저장. content 는 자기완결적 한 줄 ("X 회의 후 결정사항 정리", "Y 일정 결과 슬랙에 공유" 식). 지시어("이거/그거") 금지.
3) 마지막에 사용자에게 보낼 짧은 한국어 요약 (3~5줄) 출력: 몇 건 저장했고 핵심이 뭔지. 저장한 게 없으면 "오늘 follow-up 없음" 으로 마무리.

규칙:
- source 는 항상 "navis-calendar-followup". project 는 비워둠.
- 도구 호출 결과의 duplicates 가 있으면 그 항목은 이미 namory 에 있다는 뜻 — 다시 안 만들고 다음으로 진행.
- markdown 헤더 금지(디스코드에 그대로 발송). 머리말 금지.`;

interface RawCalEvent {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  attendees?: { email?: string | null }[] | null;
}

async function runFollowupAgent(events: RawCalEvent[]): Promise<string> {
  const compact = events.map((e) => ({
    summary: e.summary ?? "(제목 없음)",
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    location: e.location ?? null,
    description: e.description ?? null,
    attendees: e.attendees?.map((a) => a.email ?? "").filter(Boolean) ?? [],
  }));
  const prompt = [
    `[오늘 끝난 일정 ${events.length}건]`,
    "",
    "```json",
    JSON.stringify(compact, null, 2),
    "```",
  ].join("\n");
  let text = "";
  try {
    for await (const message of query({
      prompt,
      options: {
        model: config.model,
        systemPrompt: FOLLOWUP_SYSTEM_PROMPT,
        mcpServers: {
          namory: {
            type: "http",
            url: config.namoryMcpUrl,
            headers: { Authorization: `Bearer ${config.namoryToken}` },
            alwaysLoad: true,
          },
        },
        allowedTools: [
          "mcp__namory__save",
          "mcp__namory__recall",
          "mcp__namory__recent",
        ],
        settingSources: [],
        maxTurns: 12,
      },
    })) {
      if (message.type === "result" && message.subtype === "success") {
        text = message.result;
      }
    }
  } catch (err) {
    console.error("[calendar] follow-up agent 실패:", err);
    return "";
  }
  return text.trim();
}
