// 채널(DM 포함) → 진행 중인 askClaude 세션 매핑. in-memory(재시작 시 사라짐 — 영속
// 맥락은 namory가 담당). bot.ts 가 메인 사용자, followup/scheduler 가 "선제 질문을
// 보낸 뒤 세션 리셋" 용도로 쓴다. 별도 모듈로 빼서 두 곳의 순환 import 를 피한다.

export interface SessionState {
  sessionId: string;
  contextTokens: number;
}

const sessions = new Map<string, SessionState>();

export function getChannelSession(channelId: string): SessionState | undefined {
  return sessions.get(channelId);
}

export function setChannelSession(channelId: string, state: SessionState): void {
  sessions.set(channelId, state);
}

export function clearChannelSession(channelId: string): void {
  sessions.delete(channelId);
}
