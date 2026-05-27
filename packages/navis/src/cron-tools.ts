import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import cron from "node-cron";
import {
  createCronRemote,
  deleteCronRemote,
  fetchCrons,
  scheduleCron,
  unscheduleCron,
} from "./cron.js";

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

// 현재 대화 채널에 묶인 in-process 크론 도구. 발동 결과를 보낼 채널 id를
// 클로저로 주입하므로(모델이 채널 id를 다루지 않음) 항상 이 대화 채널로 보고된다.
export function buildCronTools(channelId: string): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "cron",
    version: "0.1.0",
    tools: [
      tool(
        "cron_create",
        "정기 알림(크론)을 등록한다. 사용자가 '매일/매주 ~해줘'처럼 반복 작업을 요청할 때 사용. 발동 시 prompt를 실행해 지금 이 대화 채널로 결과를 보낸다.",
        {
          title: z
            .string()
            .min(1)
            .describe("사람이 읽는 라벨 (예: 매일 아침 주식 정리)"),
          schedule: z
            .string()
            .min(1)
            .describe("표준 cron 식 (예: '0 9 * * *' = 매일 09시, '*/30 * * * *' = 30분마다)"),
          prompt: z
            .string()
            .min(1)
            .describe("발동 시 실행할 지시문 (예: 최신 주식 뉴스 웹 검색해 요약)"),
          timezone: z.string().optional().describe("타임존 (기본 Asia/Seoul)"),
        },
        async (args) => {
          if (!cron.validate(args.schedule)) {
            return ok(`잘못된 cron 식입니다: ${args.schedule}`);
          }
          const row = await createCronRemote({ ...args, channelId });
          scheduleCron(row);
          return ok(
            `등록 완료 — '${row.title}' (${row.schedule}, ${row.timezone}), id=${row.id}`,
          );
        },
      ),
      tool(
        "cron_list",
        "등록된 정기 알림(크론) 목록을 조회한다.",
        {},
        async () => ok(JSON.stringify(await fetchCrons(), null, 2)),
      ),
      tool(
        "cron_delete",
        "정기 알림(크론)을 id로 삭제한다. 먼저 cron_list로 id를 확인하라.",
        { id: z.string().min(1).describe("삭제할 크론 id") },
        async (args) => {
          await deleteCronRemote(args.id);
          unscheduleCron(args.id);
          return ok(`삭제 완료 — ${args.id}`);
        },
      ),
    ],
  });
}

// askClaude가 allowedTools에 넣어 자동 승인할 크론 도구 이름들.
export const CRON_TOOL_NAMES = [
  "mcp__cron__cron_create",
  "mcp__cron__cron_list",
  "mcp__cron__cron_delete",
];
