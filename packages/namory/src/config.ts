// namory 운영 튜닝 상수. 토큰·DB 연결·포트처럼 민감하거나 배포에 종속되는 값은
// 그대로 env(필요 지점에서 직접 process.env 사용)에서 읽고, 알고리즘 튜닝처럼
// 보안·환경과 무관한 값만 여기서 관리한다. 바꾸려면 코드 수정.

export const config = {
  recall: {
    // 시간 가중치: score = similarity × (1 + boost × exp(-age_days / tau))
    // 0이면 시간 무시(순수 코사인), 클수록 최신 편향.
    // 기본 0.3 = 신규 +30%, 30일 +11%, 90일 +1.5%, 1년 ~0%.
    freshnessBoost: 0.3,
    freshnessTauDays: 30,
    // 2단계 재랭킹용 후보 풀(HNSW 인덱스로 코사인 상위만 받아 JS에서 재정렬).
    // 풀 크기 = max(poolMin, limit × poolMultiplier).
    poolMultiplier: 8,
    poolMin: 30,
  },
} as const;
