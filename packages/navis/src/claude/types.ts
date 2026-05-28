// 디스코드 첨부 이미지를 Claude에 넘길 때 쓰는 형태. data는 base64(접두사 없음).
// media_type은 Anthropic이 받는 4종으로 한정한다.
export interface InputImage {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
}

export interface AskResult {
  text: string;
  // 이 대화의 세션 id. 다음 메시지에서 resume 으로 넘기면 맥락이 이어진다.
  sessionId: string;
  // 직전 턴의 입력 컨텍스트 토큰 수. 이게 임계를 넘으면 다음 대화는 새 세션으로 리셋.
  contextTokens: number;
  // 이번 턴에 namory에 새 기억을 저장했는지. 디스코드에서 💡 리액션 표시에 쓴다.
  saved: boolean;
}
