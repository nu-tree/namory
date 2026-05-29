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
import { collectImages } from "./image.js";
import { chunk } from "./send.js";

// 채널(DM 포함)별 진행 중인 대화 세션. in-memory라 재시작하면 사라진다(의도된 것 —
// 영속 맥락은 namory가 담당). contextTokens가 한도를 넘으면 다음 메시지에서 새 세션.
const sessions = new Map<string, { sessionId: string; contextTokens: number }>();

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
    sessions.delete(channelId);
    await message.reply("대화 맥락을 초기화했어요. 새로 시작합니다.");
    return;
  }

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
    const prev = sessions.get(channelId);
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

    const { text, sessionId, contextTokens, saved } = await askClaude(
      prompt,
      resumeId,
      images,
      channelId,
    );
    sessions.set(channelId, { sessionId, contextTokens });

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
    void curateTurn({ userText: prompt, assistantText: text });
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
