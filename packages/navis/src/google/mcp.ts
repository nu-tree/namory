import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getCalendar, isCalendarEnabled } from "./auth.js";

// in-process Google Calendar MCP — Primary 캘린더(=로그인한 사용자 본인 캘린더)에
// 한정해 5개 도구를 노출. 더 많은 도구(여러 캘린더, 색상, 알림 등)는 필요 시 추가.

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const err = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true,
});

// 모델 응답을 가볍게 — 불필요한 거대 필드 제거.
interface CompactEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string | undefined; // dateTime 또는 date
  end: string | undefined;
  attendees?: string[];
  htmlLink?: string;
}

interface RawEvent {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  attendees?: { email?: string | null }[] | null;
  htmlLink?: string | null;
}

function compactEvent(e: RawEvent): CompactEvent {
  return {
    id: e.id ?? "",
    summary: e.summary ?? "(제목 없음)",
    description: e.description ?? undefined,
    location: e.location ?? undefined,
    start: e.start?.dateTime ?? e.start?.date ?? undefined,
    end: e.end?.dateTime ?? e.end?.date ?? undefined,
    attendees: e.attendees?.map((a) => a.email ?? "").filter(Boolean),
    htmlLink: e.htmlLink ?? undefined,
  };
}

export const GOOGLE_TOOL_NAMES = [
  "mcp__google__list_events",
  "mcp__google__search_events",
  "mcp__google__create_event",
  "mcp__google__update_event",
  "mcp__google__delete_event",
];

export function buildGoogleTools(): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "google",
    version: "0.1.0",
    tools: [
      tool(
        "list_events",
        "본인 Primary Google 캘린더의 일정을 시간 범위로 조회. 단일 인스턴스로 펼쳐서 시작 시각순. 기본은 지금부터 다음 7일.",
        {
          timeMin: z
            .string()
            .optional()
            .describe("시작 시각 ISO8601 (기본 now). 예: 2026-05-29T00:00:00+09:00"),
          timeMax: z
            .string()
            .optional()
            .describe("종료 시각 ISO8601 (기본 now+7일)"),
          maxResults: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("최대 개수 (기본 30)"),
        },
        async (args) => {
          if (!isCalendarEnabled()) return err("Google 캘린더 비활성 — env 미설정");
          const { cal } = getCalendar();
          const now = new Date();
          const timeMin = args.timeMin ?? now.toISOString();
          const timeMax =
            args.timeMax ?? new Date(now.getTime() + 7 * 86400_000).toISOString();
          const res = await cal.events.list({
            calendarId: "primary",
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: "startTime",
            maxResults: args.maxResults ?? 30,
          });
          const events = (res.data.items ?? []).map(compactEvent);
          return ok(JSON.stringify({ count: events.length, events }, null, 2));
        },
      ),
      tool(
        "search_events",
        "본인 Primary 캘린더에서 키워드로 일정을 검색. 제목·설명·참가자 등에서 매칭.",
        {
          query: z.string().min(1).describe("검색어"),
          maxResults: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("최대 개수 (기본 20)"),
        },
        async (args) => {
          if (!isCalendarEnabled()) return err("Google 캘린더 비활성 — env 미설정");
          const { cal } = getCalendar();
          const res = await cal.events.list({
            calendarId: "primary",
            q: args.query,
            singleEvents: true,
            orderBy: "startTime",
            maxResults: args.maxResults ?? 20,
          });
          const events = (res.data.items ?? []).map(compactEvent);
          return ok(JSON.stringify({ count: events.length, events }, null, 2));
        },
      ),
      tool(
        "create_event",
        "본인 Primary 캘린더에 새 일정 생성. 시작/끝은 ISO8601(타임존 포함, 예: 2026-06-01T15:00:00+09:00). 종일은 YYYY-MM-DD. 반복 일정은 recurrence 파라미터에 RRULE 배열로 전달 (예: 매년 반복 → [\"RRULE:FREQ=YEARLY\"]).",
        {
          summary: z.string().min(1).describe("일정 제목"),
          start: z.string().min(1).describe("시작 시각 ISO8601 또는 YYYY-MM-DD(종일)"),
          end: z.string().min(1).describe("종료 시각 ISO8601 또는 YYYY-MM-DD(종일)"),
          description: z.string().optional().describe("설명"),
          location: z.string().optional().describe("위치"),
          attendees: z
            .array(z.string().email())
            .optional()
            .describe("참가자 이메일 목록"),
          recurrence: z.array(z.string()).optional().describe("반복 규칙 (예: [\"RRULE:FREQ=YEARLY\"])"),
        },
        async (args) => {
          if (!isCalendarEnabled()) return err("Google 캘린더 비활성 — env 미설정");
          const { cal } = getCalendar();
          const isAllDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
          const startField = isAllDay(args.start)
            ? { date: args.start }
            : { dateTime: args.start };
          const endField = isAllDay(args.end)
            ? { date: args.end }
            : { dateTime: args.end };
          const res = await cal.events.insert({
            calendarId: "primary",
            requestBody: {
              summary: args.summary,
              description: args.description,
              location: args.location,
              start: startField,
              end: endField,
              attendees: args.attendees?.map((email) => ({ email })),
              recurrence: args.recurrence,
            },
          });
          return ok(JSON.stringify(compactEvent(res.data), null, 2));
        },
      ),
      tool(
        "update_event",
        "기존 일정 부분 수정 (PATCH). eventId 는 list/search 로 먼저 확인.",
        {
          eventId: z.string().min(1).describe("수정할 이벤트 id"),
          summary: z.string().optional(),
          start: z.string().optional().describe("ISO8601 또는 YYYY-MM-DD"),
          end: z.string().optional().describe("ISO8601 또는 YYYY-MM-DD"),
          description: z.string().optional(),
          location: z.string().optional(),
          attendees: z.array(z.string().email()).optional(),
          recurrence: z.array(z.string()).optional().describe("반복 규칙 (예: [\"RRULE:FREQ=YEARLY\"])"),
        },
        async (args) => {
          if (!isCalendarEnabled()) return err("Google 캘린더 비활성 — env 미설정");
          const { cal } = getCalendar();
          const isAllDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
          const body: Record<string, unknown> = {};
          if (args.summary !== undefined) body.summary = args.summary;
          if (args.description !== undefined) body.description = args.description;
          if (args.location !== undefined) body.location = args.location;
          if (args.start !== undefined) {
            body.start = isAllDay(args.start)
              ? { date: args.start }
              : { dateTime: args.start };
          }
          if (args.end !== undefined) {
            body.end = isAllDay(args.end)
              ? { date: args.end }
              : { dateTime: args.end };
          }
          if (args.attendees !== undefined) {
            body.attendees = args.attendees.map((email) => ({ email }));
          }
          if (args.recurrence !== undefined) body.recurrence = args.recurrence;
          const res = await cal.events.patch({
            calendarId: "primary",
            eventId: args.eventId,
            requestBody: body,
          });
          return ok(JSON.stringify(compactEvent(res.data), null, 2));
        },
      ),
      tool(
        "delete_event",
        "일정 영구 삭제. 되돌릴 수 없으니 사용자가 명시적으로 요청할 때만.",
        {
          eventId: z.string().min(1).describe("삭제할 이벤트 id"),
        },
        async (args) => {
          if (!isCalendarEnabled()) return err("Google 캘린더 비활성 — env 미설정");
          const { cal } = getCalendar();
          await cal.events.delete({
            calendarId: "primary",
            eventId: args.eventId,
          });
          return ok(`삭제 완료 — ${args.eventId}`);
        },
      ),
    ],
  });
}
