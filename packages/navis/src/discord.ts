import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
} from "discord.js";
import { config } from "./config.js";
import { askClaude } from "./claude.js";

const DISCORD_MAX = 2000;

// 디스코드 메시지 길이 제한(2000자)에 맞춰 자른다. 단어/줄 경계를 최대한 보존.
function chunk(text: string): string[] {
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
  // [임시 디버그] 들어오는 모든 메시지 기록 — 진단 끝나면 제거.
  console.log(
    `[debug] from=${message.author.tag}(${message.author.id}) bot=${message.author.bot} dm=${message.channel.isDMBased()} contentLen=${message.content.length}`,
  );
  // 봇 자신·다른 봇 무시.
  if (message.author.bot) return;
  // 허용된 유저만. (인젝션·무단 사용 차단의 핵심 게이트)
  if (!config.allowedUserIds.includes(message.author.id)) return;

  const prompt = message.content.trim();
  if (!prompt) return;

  try {
    // 처리 중 타이핑 표시 (Claude 응답까지 몇 초 걸림).
    if (message.channel.isSendable()) await message.channel.sendTyping();
    const answer = await askClaude(prompt);
    for (const part of chunk(answer)) {
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
