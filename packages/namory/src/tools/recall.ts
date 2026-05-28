import { sql, cosineDistance, desc, eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories, type Category } from "../db/schema.js";
import { embed } from "../embedding.js";
import { projectFilter } from "./filter.js";
import { config } from "../config.js";

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
  const { freshnessBoost, freshnessTauDays, poolMultiplier, poolMin } = config.recall;
  // 1단계: HNSW 인덱스로 코사인 유사도 상위 후보 풀을 빠르게 가져온다.
  const poolSize = Math.max(poolMin, limit * poolMultiplier);
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
      const freshness = Math.exp(-ageDays / freshnessTauDays);
      const score = row.similarity * (1 + freshnessBoost * freshness);
      return { row, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => row);
}
