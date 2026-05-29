import type { Client } from "discord.js";
import { decideFollowup } from "./decide.js";
import { sendToChannel } from "../discord/send.js";
import { clearChannelSession } from "../discord/sessions.js";

// 자발적 팔로업 스케줄러.
//
// 흐름
// 1) 매 턴 끝에 scheduleFollowupIfWarranted() — 기존 예약/대기 취소 후 새로 판단.
// 2) 가치 있다고 판단되면 setTimeout 으로 N분 뒤에 fire() 예약(pending).
// 3) fire() — 디스코드 채널로 짧은 질문 발송 + awaiting 상태로 전환 + 채널 세션 리셋
//    (사용자가 답할 때 새 세션 + 채널 히스토리 보강으로 navis 의 질문이 자동으로 맥락에 잡힘).
// 4) 사용자의 다음 메시지가 들어오면 bot 이 consumeAwaitingAnswer() 로 가져가
//    curator 에게 "이 답변은 자발적 팔로업에 대한 응답" 이라고 알려 저장 가능성을 높인다.
//
// 영속화 없음(컨테이너 재시작 시 예약/대기 손실 — 의도된 단순함. 동일 정책: cron, calendar).

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  question: string;
}

export interface AwaitingAnswer {
  question: string;
  // 질문을 실제로 발송한 시각(ms epoch). TTL 검사에 쓴다.
  askedAt: number;
}

// 사용자가 navis 의 질문을 받은 뒤 답 안 한 채로 너무 오래 지나면, 그 다음 메시지는
// 더 이상 "팔로업 답변" 으로 간주하지 않는다(6시간 후엔 사실상 새 대화).
const AWAITING_TTL_MS = 6 * 60 * 60 * 1000;

const pending = new Map<string, Pending>();
const awaiting = new Map<string, AwaitingAnswer>();

// 새 턴이 들어왔거나 명시적 취소가 필요할 때 호출. 둘 다 비운다.
export function cancelFollowup(channelId: string): void {
  const p = pending.get(channelId);
  if (p) {
    clearTimeout(p.timer);
    pending.delete(channelId);
  }
  awaiting.delete(channelId);
}

// 사용자 메시지 도착 시 bot 이 호출. 대기 중이고 TTL 안이면 반환·제거, 아니면 undefined.
export function consumeAwaitingAnswer(channelId: string): AwaitingAnswer | undefined {
  const a = awaiting.get(channelId);
  if (!a) return undefined;
  awaiting.delete(channelId);
  if (Date.now() - a.askedAt > AWAITING_TTL_MS) return undefined;
  return a;
}

interface ScheduleInput {
  client: Client;
  channelId: string;
  userText: string;
  assistantText: string;
}

export async function scheduleFollowupIfWarranted(
  input: ScheduleInput,
): Promise<void> {
  const { client, channelId, userText, assistantText } = input;
  // 새 턴이 들어왔으므로 이전 예약/대기는 stale — 깨끗이 비우고 다시 판단.
  cancelFollowup(channelId);

  let decision;
  try {
    decision = await decideFollowup({ userText, assistantText });
  } catch (err) {
    console.error("[followup] 판단 실패(무시):", err);
    return;
  }
  if (!decision) return;

  const delayMs = decision.delayMinutes * 60_000;
  console.log(
    `[followup] 예약: 채널 ${channelId}, ${decision.delayMinutes}분 후 "${decision.question}" (사유: ${decision.reason})`,
  );

  const timer = setTimeout(() => {
    void fire(client, channelId, decision.question);
  }, delayMs);
  // 노드 종료를 막지 않도록 unref. 디스코드 게이트웨이가 이벤트 루프를 유지해주니
  // 이 타이머가 ref 일 필요 없음.
  if (typeof timer.unref === "function") timer.unref();

  pending.set(channelId, { timer, question: decision.question });
}

async function fire(
  client: Client,
  channelId: string,
  question: string,
): Promise<void> {
  pending.delete(channelId);
  try {
    await sendToChannel(client, channelId, question, "followup");
    awaiting.set(channelId, { question, askedAt: Date.now() });
    // 다음 사용자 응답이 새 세션 + 채널 히스토리 보강 경로를 타게 만들어
    // navis 의 직전 질문이 자동으로 모델 맥락에 잡히도록 한다(fetchRecentHistory).
    clearChannelSession(channelId);
  } catch (err) {
    console.error("[followup] 질문 발송 실패:", err);
  }
}
