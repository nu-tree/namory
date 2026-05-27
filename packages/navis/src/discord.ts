import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import { config } from "./config.js";
import { askClaude, type InputImage } from "./claude.js";

const DISCORD_MAX = 2000;

// Anthropic이 받는 이미지 타입. 그 외 첨부(pdf 등)는 무시한다.
const ALLOWED_IMAGE_TYPES = new Set<InputImage["mediaType"]>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
// 이미지당 상한(바이트). API 제한(~5MB) 안쪽으로 잡아 호출 실패를 막는다.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// 메시지의 첨부 중 이미지를 내려받아 base64로 만든다. 타입·용량 안 맞으면 건너뛴다.
async function collectImages(message: Message): Promise<InputImage[]> {
  const images: InputImage[] = [];
  for (const att of message.attachments.values()) {
    const ct = att.contentType?.split(";")[0]?.trim() as
      | InputImage["mediaType"]
      | undefined;
    if (!ct || !ALLOWED_IMAGE_TYPES.has(ct)) continue;
    if (att.size > MAX_IMAGE_BYTES) {
      console.warn(`[discord] 이미지 용량 초과로 건너뜀: ${att.size}B`);
      continue;
    }
    try {
      const res = await fetch(att.url);
      if (!res.ok) continue;
      const data = Buffer.from(await res.arrayBuffer()).toString("base64");
      images.push({ mediaType: ct, data });
    } catch (err) {
      console.error("[discord] 이미지 다운로드 실패:", err);
    }
  }
  return images;
}

// 채널(DM 포함)별 진행 중인 대화 세션. in-memory라 재시작하면 사라진다(의도된 것 —
// 영속 맥락은 namory가 담당). contextTokens가 한도를 넘으면 다음 메시지에서 새 세션.
const sessions = new Map<string, { sessionId: string; contextTokens: number }>();

// 디스코드 메시지 길이 제한(2000자)에 맞춰 자른다. 단어/줄 경계를 최대한 보존.
export function chunk(text: string): string[] {
  if (text.length <= DISCORD_MAX) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > DISCORD_MAX) {
    let cut = rest.lastIndexOf("\n", DISCORD_MAX);
    if (cut < DISCORD_MAX * 0.5) cut = DISCORD_MAX; // 줄바꿈이 너무 앞이면 그냥 끊음
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
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
    sessions.delete(channelId);
    await message.reply("대화 맥락을 초기화했어요. 새로 시작합니다.");
    return;
  }

  try {
    // 처리 중 타이핑 표시 (Claude 응답까지 몇 초 걸림).
    if (message.channel.isSendable()) await message.channel.sendTyping();

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
  } catch (err) {
    console.error("[discord] 처리 실패:", err);
    await message.reply("⚠️ 처리 중 오류가 났어요. 로그를 확인해주세요.");
  }
}

export function startDiscord(): Client {
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

  client.login(config.discordToken).catch((err) => {
    console.error("[discord] 로그인 실패:", err);
    process.exit(1);
  });
  return client;
}
