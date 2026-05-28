// 저장 너지 키워드 — 결정/약속/할 일/배움/선호 신호. 보수적으로 골라 false positive 최소화.
// 매칭되면 사용자 메시지 앞에 가벼운 메타 힌트를 붙여 메인 턴이 save 호출을 검토하도록 유도.
const SAVE_NUDGE_KEYWORDS = [
  "결정",
  "정했",
  "기억해",
  "잊지",
  "할 일",
  "할일",
  "todo",
  "TODO",
  "약속",
  "목표",
  "선호",
];

export function applySaveNudge(prompt: string): string {
  if (!prompt) return prompt;
  const hit = SAVE_NUDGE_KEYWORDS.some((k) => prompt.includes(k));
  if (!hit) return prompt;
  return `[자동 메모] 이번 사용자 메시지에 결정/약속/할 일/배움 신호가 보입니다. 답변하면서 mcp__namory__save 호출을 함께 고려하세요(맞으면 카테고리·project 태깅, 아니면 무시).\n\n${prompt}`;
}
