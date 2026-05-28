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
  save: {
    // 중복 감지 임계값(코사인 유사도). 이상이면 "유사 기억 후보"로 응답에 동봉.
    // voyage-3-large 한국어 paraphrase 경계가 대략 0.85~0.92라 0.88을 기본으로.
    // 0에 가깝게 낮추면 false positive 폭증, 1에 가까울수록 거의 같은 문장만 잡힘.
    dupThreshold: 0.88,
    // 후보 응답 최대 개수.
    dupLimit: 3,
    // 후보 풀 — HNSW로 상위 N개 받아 JS에서 임계값 필터.
    // dupLimit×4 면 임계값을 통과하지 못한 후보까지 충분히 본 셈.
    dupPool: 12,
  },
} as const;
