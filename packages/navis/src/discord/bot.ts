import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import { config } from "../config.js";
import { askClaude } from "../claude/ask.js";
import { curateTurn } from "../claude/curator.js";
import {
  consumeAwaitingAnswer,
  scheduleFollowupIfWarranted,
} from "../followup/scheduler.js";
import { collectImages } from "./image.js";
import { chunk } from "./send.js";
import {
  getChannelSession,
  setChannelSession,
  clearChannelSession,
} from "./sessions.js";

// 채널 세션 맵은 ./sessions.ts 로 추출. followup/scheduler 도 같은 맵을 건드려야 해서
// (질문 발송 후 세션 리셋) 순환 import 를 피하려고 별도 모듈로 뺐다.

// 새 세션을 시작할 때 채널 최근 메시지 중 끌어올 개수. 크론 보고처럼 봇 메시지가
// 끼어 사용자 다음 질문이 "맥락 없음" 으로 보이던 케이스를 메우는 용도 — 너무 크면
// 첫 프롬프트가 부풀고, 너무 작으면 보고 메시지를 놓친다. 10이 균형.
const HISTORY_LIMIT = 10;

// 현재 처리 중인 메시지 직전의 채널 메시지들을 텍스트로 묶어 반환.
// 봇(navis) 자신의 메시지도 포함해 크론/자율 보고가 맥락에 잡히도록 한다.
// fetch 실패(권한 부족, partial DM 등)는 빈 문자열로 폴백.
async function fetchRecentHistory(
  message: Message,
  limit: number,
): Promise<string> {
  const channel = message.channel;
  // 일부 partial 채널 객체는 messages 매니저가 없을 수 있음.
  if (!("messages" in channel) || !channel.messages?.fetch) return "";
  try {
    const fetched = await channel.messages.fetch({
      limit,
      before: message.id,
    });
    // fetched 는 newest-first Collection. 시간순(오래된 → 최신)으로 재정렬.
    const sorted = Array.from(fetched.values()).sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp,
    );
    const lines: string[] = [];
    for (const m of sorted) {
      const content = m.content?.trim();
      // 본문 없는 첨부-only/시스템 메시지는 텍스트 맥락에 의미 없으니 스킵.
      if (!content) continue;
      const who = m.author.bot ? "navis" : m.author.username;
      lines.push(`[${who}]: ${content}`);
    }
    return lines.join("\n");
  } catch (err) {
    console.error("[discord] 채널 히스토리 조회 실패:", err);
    return "";
  }
}

async function handleMessage(message: Message): Promise<void> {
  // 봇 자신·다른 봇 무시.
  if (message.author.bot) return;
  // 허용된 유저만. (인젝션·무단 사용 차단의 핵심 게이트)
  if (!config.allowedUserIds.includes(message.author.id)) return;

  const prompt = message.content.trim();
  const images = await collectImages(message);
  // 텍스트도 이미지도 없으면 무시(이미지만 있는 메시지는 처리).
  if (!prompt && images.length === 0) return;

  const channelId = message.channelId;

  // 수동 초기화: 진행 중 대화를 끊고 다음 메시지부터 새 세션.
  if (prompt === "/reset") {
    clearChannelSession(channelId);
    await message.reply("대화 맥락을 초기화했어요. 새로 시작합니다.");
    return;
  }

  // 자발적 팔로업: 이 채널로 navis 가 먼저 물어본 질문이 있고 사용자가 답하러
  // 돌아왔으면 그 질문을 가져와 사후 큐레이터에 넘긴다(저장 가능성↑).
  const followupAnswer = consumeAwaitingAnswer(channelId);

  let typingInterval: ReturnType<typeof setInterval> | null = null;
  try {
    // 처리 중 타이핑 표시 (Claude 응답까지 몇 초 걸림).
    // Discord typing indicator는 10초 후 자동 소멸하므로 8초마다 갱신.
    if (message.channel.isSendable()) {
      await message.channel.sendTyping();
      typingInterval = setInterval(() => {
        if (message.channel.isSendable()) {
          message.channel.sendTyping().catch(() => {});
        }
      }, 8_000);
    }

    // 직전 세션이 한도 미만이면 이어받고, 넘었으면(또는 없으면) 새 세션.
    const prev = getChannelSession(channelId);
    const overLimit =
      prev !== undefined && prev.contextTokens >= config.contextTokenLimit;
    const resumeId = prev && !overLimit ? prev.sessionId : undefined;

    // 길이 초과로 자동 리셋되는 경우 사용자에게 알린다.
    if (overLimit) {
      const k = Math.round(prev.contextTokens / 1000);
      const limitK = Math.round(config.contextTokenLimit / 1000);
      console.log(`[discord] 컨텍스트 한도 초과(${prev.contextTokens}) → 새 세션`);
      await message.reply(
        `[알림] 대화가 한도(${limitK}k)에 도달해 맥락을 새로 시작합니다(이전 ~${k}k 토큰). 중요한 내용은 namory에 저장돼 있어요.`,
      );
    }

    // 새 세션 시작(=resumeId 없음)일 때만 채널 직전 메시지를 맥락 보강용으로 끌어옴.
    // 진행 중 세션은 이미 히스토리를 갖고 있어서 중복 주입은 토큰 낭비.
    const historyContext = resumeId
      ? undefined
      : await fetchRecentHistory(message, HISTORY_LIMIT);

    const { text, sessionId, contextTokens, saved } = await askClaude(
      prompt,
      resumeId,
      images,
      channelId,
      false,
      undefined,
      historyContext || undefined,
    );
    setChannelSession(channelId, { sessionId, contextTokens });

    // 무언가 저장했으면 사용자 메시지에 💡 리액션으로 표시(본문엔 알림 텍스트 없음).
    if (saved) {
      message.react("💡").catch((err) => {
        console.error("[discord] 리액션 실패:", err);
      });
    }

    for (const part of chunk(text)) {
      await message.reply(part);
    }

    // 사후 큐레이터(A) — 답변을 보낸 뒤 백그라운드로 한 번 더 평가해 저장 누락을 메운다.
    // fire-and-forget: 사용자 UX는 끝났고 큐레이터 실패는 무시(자체 try/catch).
    // 이번 메시지가 navis 의 자발적 팔로업 질문에 대한 응답이면 그 맥락을 함께 넘긴다.
    void curateTurn({
      userText: prompt,
      assistantText: text,
      followupAnswerContext: followupAnswer?.question,
    });

    // 자발적 팔로업 스케줄링(C) — 이 턴의 결과를 나중에 다시 물어볼 가치가 있는지
    // Haiku 가 판단해 예약. 기존 채널 예약/대기는 내부에서 cancel 되므로 항상 안전.
    void scheduleFollowupIfWarranted({
      client: message.client,
      channelId,
      userText: prompt,
      assistantText: text,
    });
  } catch (err) {
    console.error("[discord] 처리 실패:", err);
    await message.reply("⚠️ 처리 중 오류가 났어요. 로그를 확인해주세요.");
  } finally {
    if (typingInterval) clearInterval(typingInterval);
  }
}

export function startDiscord(): Client {
  // 디스코드 모드 전용 env 검증. config.ts 는 이 둘을 optional 로 두고(CLI 가 영향 안 받게),
  // 실제 봇을 띄우는 진입점인 여기서 누락 시 종료한다.
  const token = config.discordToken;
  if (!token) {
    console.error("[discord] DISCORD_TOKEN 누락 — 디스코드 봇 모드는 토큰 필수.");
    process.exit(1);
  }
  if (config.allowedUserIds.length === 0) {
    console.error(
      "[discord] ALLOWED_USER_IDS 비어 있음 — 최소 1명 지정 필요(인젝션·무단 사용 차단).",
    );
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      // MessageContent = 특권 인텐트. 디스코드 개발자 포털에서 켜야 함.
      GatewayIntentBits.MessageContent,
    ],
    // DM 채널은 부분 객체로 올 수 있어 Partials.Channel 필요.
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[discord] 로그인 완료: ${c.user.tag}`);
    console.log(`[discord] 허용 유저: ${config.allowedUserIds.join(", ")}`);
  });

  client.on(Events.MessageCreate, (msg) => void handleMessage(msg));

  client.login(token).catch((err) => {
    console.error("[discord] 로그인 실패:", err);
    process.exit(1);
  });
  return client;
}
