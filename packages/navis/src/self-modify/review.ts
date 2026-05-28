import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Client } from "discord.js";
import { config } from "../config.js";
import { sendToChannel } from "../discord/send.js";

// "검토 서브에이전트" — 메인 navis 와 코드 수정 서브에이전트(Actions) 사이에 끼는 critic.
// Actions 가 PR 을 만들면 navis Fastify webhook 이 받아 이 함수를 fire-and-forget 으로
// 호출. PR diff 를 가져와 별도 LLM 호출로 안전성·범위·잠재 문제를 평가하고 그 결과를
// 원래 요청한 디스코드 채널로 발송한다. 메인 대화 흐름은 막지 않음.

// 진단 시스템 프롬프트 — 짧고 정확한 평가에 집중. 코드 변경 자체는 하지 않음(읽기만).
const REVIEW_SYSTEM_PROMPT = `너는 PR 검토 서브에이전트다. 자기 자신을 수정한 PR 의 diff 를 받아 다음 4가지를 짧고 솔직하게 평가한다:

1. [요약] 무엇이 어디서 어떻게 바뀌었는지 한두 문장.
2. [의도 일치] 원래 작업 지시와 변경이 맞는가? 빠진 거 / 과한 거.
3. [안전성] 깨질 만한 부분 있나? 사이드이펙트, 회귀 위험, 누락된 케이스.
4. [권고] '머지 OK' / '수정 필요(이유)' / '재작업'.

규칙:
- 솔직 우선. 위험 있으면 '머지 OK' 하지 말 것.
- 추측 금지. diff 에 근거. 모르면 모른다고.
- 한국어, 5~10줄 이내. markdown 헤더 금지(디스코드에 그대로 발송).
- 첫 줄 "🤖 검토" 같은 머리말 붙이지 말 것 — 호출자가 붙임.`;

interface ReviewInput {
  client: Client;
  channelId: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  instruction: string; // 원래 작업 지시 (메타에서 복구되거나 PR body에서 파싱)
}

// PR diff 를 가져와 critic 으로 평가 후 채널에 발송. 실패는 삼킴.
export async function reviewPullRequest(input: ReviewInput): Promise<void> {
  if (!config.githubRepo) {
    console.error("[review] GITHUB_REPO 미설정 — 검토 스킵");
    return;
  }
  try {
    const diff = await fetchPrDiff(input.prNumber);
    const verdict = await runReview(input.instruction, input.prTitle, diff);
    const msg = [
      `**검토 서브에이전트** — PR #${input.prNumber}: ${input.prTitle}`,
      "",
      verdict,
      "",
      input.prUrl,
    ].join("\n");
    await sendToChannel(input.client, input.channelId, msg, "review");
  } catch (err) {
    console.error("[review] 실패:", err);
    // 검토 실패 시에도 사용자에게 PR 자체는 알린다 — 그래야 모른 채 묻히지 않음.
    await sendToChannel(
      input.client,
      input.channelId,
      `**검토 실패** — PR #${input.prNumber}: ${input.prTitle}\n검토 에이전트가 평가에 실패했어. PR 은 GitHub 에서 직접 봐줘.\n${input.prUrl}`,
      "review",
    ).catch(() => {});
  }
}

// GitHub Pulls API 의 diff 미디어타입으로 raw diff 텍스트 받음. 너무 크면 잘라서 전달.
const MAX_DIFF_CHARS = 60_000; // sonnet 컨텍스트 안에서 안전한 크기
async function fetchPrDiff(prNumber: number): Promise<string> {
  const url = `https://api.github.com/repos/${config.githubRepo}/pulls/${prNumber}`;
  const res = await fetch(url, {
    headers: {
      accept: "application/vnd.github.v3.diff",
      "x-github-api-version": "2022-11-28",
      ...(config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`PR diff 가져오기 실패: ${res.status} ${await res.text()}`);
  const diff = await res.text();
  if (diff.length > MAX_DIFF_CHARS) {
    return diff.slice(0, MAX_DIFF_CHARS) + `\n\n[... diff 잘림 — 총 ${diff.length}자]`;
  }
  return diff;
}

async function runReview(
  instruction: string,
  prTitle: string,
  diff: string,
): Promise<string> {
  const prompt = [
    `[원래 작업 지시]\n${instruction}`,
    "",
    `[PR 제목]\n${prTitle}`,
    "",
    `[Diff]`,
    "```diff",
    diff,
    "```",
  ].join("\n");

  let text = "";
  for await (const message of query({
    prompt,
    options: {
      // 코드 리뷰는 정확도 중요. sonnet 충분 (opus 까진 과함).
      model: config.model,
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      // 도구 호출 불필요 — diff 는 프롬프트에 다 박아둠.
      allowedTools: [],
      settingSources: [],
      maxTurns: 2,
    },
  })) {
    if (message.type === "result" && message.subtype === "success") {
      text = message.result;
    }
  }
  return text.trim() || "(검토 응답 없음)";
}
