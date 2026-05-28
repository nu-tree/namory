import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

// "코드 수정 서브에이전트" 트리거. 디스코드 메인 navis 가 자연어 지시를 받으면
// 이 도구를 호출 → GitHub repository_dispatch 로 self-improve 워크플로 발동.
// 실제 코드 분석/수정/PR 생성은 GitHub Actions 안의 Claude Code(Opus 4.7) 가 수행.
// 메인 봇은 fire-and-forget — 즉시 응답해 디스코드 채팅을 막지 않는다.

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const err = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true,
});

// dispatch_id → channelId 매핑. webhook 받았을 때 어느 채널로 보고할지 복구용.
// PR body 메타에도 박지만 매핑 캐시가 더 빠르고 안전. 컨테이너 재시작 시 손실되지만
// 보통 self-improve 한 회는 10분 안에 끝나므로 영속화 불필요.
const pendingDispatches = new Map<string, { channelId: string; createdAt: number }>();
const DISPATCH_TTL_MS = 30 * 60 * 1000; // 30분

export function lookupDispatchChannel(dispatchId: string): string | undefined {
  pruneExpiredDispatches();
  return pendingDispatches.get(dispatchId)?.channelId;
}

export function clearDispatch(dispatchId: string): void {
  pendingDispatches.delete(dispatchId);
}

function pruneExpiredDispatches(): void {
  const cutoff = Date.now() - DISPATCH_TTL_MS;
  for (const [id, v] of pendingDispatches) {
    if (v.createdAt < cutoff) pendingDispatches.delete(id);
  }
}

export const SELF_MODIFY_TOOL_NAMES = ["mcp__self_modify__request_self_modification"];

// 디스코드 채널에서만 의미 있는 도구라 channelId 클로저로 받는다.
// CLI 모드(channelId 없음)에선 buildSelfModifyTools 자체를 호출하지 않으므로 노출 안 됨.
export function buildSelfModifyTools(channelId: string): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "self_modify",
    version: "0.1.0",
    tools: [
      tool(
        "request_self_modification",
        "navis 자기 자신(packages/navis 또는 packages/namory 소스)을 수정해 달라는 요청을 GitHub Actions 의 '코드 수정 서브에이전트'에게 위임한다. 즉시 트리거만 던지고 결과는 별도 채널 메시지로 비동기 보고된다. 사용자가 '이거 고쳐줘/maxTurns 올려줘/X 함수 리팩토링해줘' 같은 코드 변경 요청을 할 때 사용.",
        {
          instruction: z
            .string()
            .min(10)
            .describe(
              "서브에이전트에게 전달할 자연어 지시. 어떤 파일·어떤 변경인지 가능한 한 구체적으로(예: 'packages/navis/src/claude/ask.ts 의 maxTurns 16을 20으로 올려줘').",
            ),
        },
        async (args) => {
          if (!config.githubRepo) {
            return err("GITHUB_REPO 환경변수가 설정되지 않음 — 자기 개선 비활성.");
          }
          if (!config.githubToken) {
            return err(
              "GITHUB_TOKEN 이 없거나 권한 부족 — repository_dispatch 호출에 Actions:Write 권한이 필요.",
            );
          }

          const dispatchId = randomUUID();
          pendingDispatches.set(dispatchId, { channelId, createdAt: Date.now() });

          const url = `https://api.github.com/repos/${config.githubRepo}/dispatches`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              accept: "application/vnd.github+json",
              "x-github-api-version": "2022-11-28",
              authorization: `Bearer ${config.githubToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              event_type: "self-improve",
              client_payload: {
                instruction: args.instruction,
                channel_id: channelId,
                dispatch_id: dispatchId,
              },
            }),
          });

          if (!res.ok) {
            pendingDispatches.delete(dispatchId);
            const body = await res.text();
            return err(
              `GitHub dispatch 실패: ${res.status} ${body}. ` +
                `토큰 권한(Actions:Write) 또는 GITHUB_REPO 값 확인.`,
            );
          }

          return ok(
            `코드 수정 서브에이전트에게 작업 의뢰 전송 완료 (dispatch_id=${dispatchId}). ` +
              `Actions 가 격리 환경에서 코드를 수정하고 PR 을 만들면 별도 메시지로 보고됨. ` +
              `그동안 다른 얘기 계속해도 돼.`,
          );
        },
      ),
    ],
  });
}
