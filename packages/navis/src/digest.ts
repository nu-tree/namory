import cron from "node-cron";
import type { Client } from "discord.js";
import { config } from "./config.js";
import { askClaude } from "./claude.js";
import { chunk } from "./discord.js";

// 주간 기억 다이제스트 — navis가 정기적으로 최근 기억을 요약해 자기이해 프로필에
// 반영(자동 압축)하고 요약을 디스코드로 보고한다. namory의 수동 profile_update
// 누락을 메우는 자동화. 실행은 navis(두뇌)가 하고, namory는 저장만 한다(서버 LLM 0).
//
// 신뢰된 자동화 경로라 askClaude에 allowProfileUpdate=true를 넘겨 이 작업에서만
// profile_update를 허용한다(사용자 대화 경로에선 계속 차단 — 인젝션 방어).

// 다이제스트 지시문. SYSTEM_PROMPT(봇 성격)는 그대로 적용되고, 이 프롬프트가
// 이번 턴에 할 작업을 지정한다. 기억은 삭제하지 않고 프로필로 '증류'만 한다.
function buildDigestPrompt(days: number): string {
  return [
    `[정기 작업: 기억 다이제스트] 최근 ${days}일간의 기억을 정리해 자기이해 프로필을 갱신해줘.`,
    "",
    "순서:",
    `1) recent 도구로 지난 ${days}일치 기억을 불러온다.`,
    "2) profile_show 로 현재 프로필 섹션들을 확인한다.",
    "3) 새 기억에서 오래 유효한 통찰(가치관·반복 패턴·목표·선호·인간관계·진행 중인 일)을 추린다.",
    "4) 해당 프로필 섹션마다 profile_update 로 갱신한다. 기존 내용을 통째로 덮지 말고 새 통찰을 '병합'하고, 더 이상 맞지 않는 부분만 다듬는다. 새 섹션이 필요하면 만든다.",
    "5) 원본 기억은 삭제하지 않는다(프로필은 요약본일 뿐, 기억은 그대로 보존).",
    "",
    "마지막에 사용자에게 보낼 짧은 한국어 요약을 출력해줘 — 이번 기간 무엇을 배웠고 어떤 섹션을 갱신했는지 3~5줄. 새 기억이 거의 없으면 갱신을 생략하고 그렇다고만 알려줘.",
  ].join("\n");
}

let discord: Client;

// 다이제스트 1회 실행: navis가 요약→프로필 갱신을 수행하고, 채널이 설정돼 있으면
// 요약을 보고한다. 수동 트리거(테스트)에도 재사용할 수 있게 분리.
export async function runDigest(): Promise<void> {
  console.log("[digest] 발동");
  try {
    const { text } = await askClaude(
      buildDigestPrompt(config.digestDays),
      undefined, // 새 세션 (이전 대화 맥락과 분리)
      [],
      undefined, // 크론 도구 불필요
      true, // profile_update 허용 (신뢰된 자동화 경로)
    );
    if (config.digestChannelId) {
      await sendToChannel(config.digestChannelId, `🧠 **주간 기억 다이제스트**\n\n${text}`);
    } else {
      console.log("[digest] DIGEST_CHANNEL_ID 미설정 — 프로필만 갱신, 포스팅 생략");
    }
  } catch (err) {
    console.error("[digest] 실행 실패:", err);
  }
}

async function sendToChannel(channelId: string, text: string): Promise<void> {
  const ch = await discord.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isSendable()) {
    console.error(`[digest] 채널 전송 불가: ${channelId}`);
    return;
  }
  for (const part of chunk(text)) await ch.send(part);
}

// 부팅 시 호출. digestSchedule(cron 식)에 맞춰 주기 실행을 등록한다.
export function startDigestScheduler(client: Client): void {
  discord = client;
  if (!cron.validate(config.digestSchedule)) {
    console.error(`[digest] 잘못된 cron 식, 스케줄러 미시작: ${config.digestSchedule}`);
    return;
  }
  cron.schedule(config.digestSchedule, () => void runDigest(), {
    timezone: config.digestTimezone,
  });
  console.log(
    `[digest] 스케줄러 시작 (${config.digestSchedule} ${config.digestTimezone}, 최근 ${config.digestDays}일)`,
  );
}
