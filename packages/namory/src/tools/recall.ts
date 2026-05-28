import { sql, cosineDistance, desc, eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories, type Category } from "../db/schema.js";
import { embed } from "../embedding.js";
import { projectFilter } from "./filter.js";

// 시간 가중치 파라미터. 점수 = similarity × (1 + boost × exp(-age_days / tau))
// - 신규 기억은 최대 +boost(기본 30%) 부스트, 오래될수록 1.0에 수렴(원본 유사도 그대로)
// - 30일 ≈ +11%, 90일 ≈ +1.5%, 1년 ≈ 0% 가산 → 최신 우선이되 오래된 기억을 죽이진 않음
// - env로 튠: 보수적(부스트 작게) ↔ 공격적(부스트 크게) 조정용
const FRESHNESS_BOOST = Number(process.env.RECALL_FRESHNESS_BOOST) || 0.3;
const FRESHNESS_TAU_DAYS = Number(process.env.RECALL_FRESHNESS_TAU_DAYS) || 30;

// 2단계 재랭킹용 후보 풀 배수·하한. HNSW는 순수 코사인 ORDER BY에서만 인덱스를 타므로,
// 시간감쇠를 SQL에 직접 넣지 않고 풀을 좀 더 크게 잡아 받아온 뒤 JS에서 재정렬한다.
const POOL_MULTIPLIER = 8;
const POOL_MIN = 30;

const MS_PER_DAY = 86_400_000;

export async function recall(args: {
  query: string;
  limit?: number;
  category?: Category;
  project?: string;
}) {
  const queryEmbedding = await embed(args.query, "query");
  const similarity = sql<number>`1 - (${cosineDistance(
    memories.embedding,
    queryEmbedding,
  )})`;

  const limit = args.limit ?? 5;
  // 1단계: HNSW 인덱스로 코사인 유사도 상위 후보 풀을 빠르게 가져온다.
  const poolSize = Math.max(POOL_MIN, limit * POOL_MULTIPLIER);
  const candidates = await db
    .select({
      id: memories.id,
      content: memories.content,
      category: memories.category,
      project: memories.project,
      createdAt: memories.createdAt,
      similarity,
    })
    .from(memories)
    .where(
      and(
        args.category ? eq(memories.category, args.category) : undefined,
        projectFilter(args.project),
      ),
    )
    .orderBy(desc(similarity))
    .limit(poolSize);

  // 2단계: 시간감쇠를 곱한 합성 점수로 재정렬해 top N 반환.
  // similarity 필드는 raw 코사인 그대로 노출(클라이언트 임계값/표시용 호환 유지).
  const now = Date.now();
  return candidates
    .map((row) => {
      const ageDays = (now - row.createdAt.getTime()) / MS_PER_DAY;
      const freshness = Math.exp(-ageDays / FRESHNESS_TAU_DAYS);
      const score = row.similarity * (1 + FRESHNESS_BOOST * freshness);
      return { row, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => row);
}
