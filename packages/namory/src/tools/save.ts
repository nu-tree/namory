import { sql, cosineDistance, desc, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories, type Category } from "../db/schema.js";
import { embed } from "../embedding.js";
import { config } from "../config.js";
import { projectFilter } from "./filter.js";

interface DuplicateCandidate {
  id: string;
  content: string;
  category: string | null;
  project: string | null;
  similarity: number;
  createdAt: Date;
}

interface SaveResult {
  // 새 기억의 id. skipped=true 인 경우 null.
  id: string | null;
  createdAt: Date | null;
  // 코사인 유사도가 임계값(config.save.dupThreshold) 이상인 기존 기억들.
  // 없으면 빈 배열. 클라이언트는 이걸 보고 update(병합)·delete(정리)·무시 결정.
  duplicates: DuplicateCandidate[];
  // skipIfDuplicate=true 였고 후보가 있어 저장하지 않은 경우 true.
  skipped: boolean;
}

// 새 임베딩과 코사인 유사도가 임계값 이상인 후보를 찾는다.
// HNSW 인덱스로 상위 풀만 가져와 JS에서 임계값 필터 → 후보 수만큼 자른다.
async function findDuplicates(
  embedding: number[],
  project: string | undefined,
): Promise<DuplicateCandidate[]> {
  const { dupThreshold, dupLimit, dupPool } = config.save;
  const similarity = sql<number>`1 - (${cosineDistance(memories.embedding, embedding)})`;
  const rows = await db
    .select({
      id: memories.id,
      content: memories.content,
      category: memories.category,
      project: memories.project,
      createdAt: memories.createdAt,
      similarity,
    })
    .from(memories)
    .where(and(projectFilter(project)))
    .orderBy(desc(similarity))
    .limit(dupPool);
  return rows
    .filter((r) => r.similarity >= dupThreshold)
    .slice(0, dupLimit);
}

export async function save(args: {
  content: string;
  category?: Category;
  source?: string;
  project?: string;
  // true: 유사 기억 후보가 있으면 저장하지 않고 후보만 반환. 모델/클라이언트가
  // update(병합)이나 무시 결정. 기본 false(저장은 하되 응답에 후보 동봉).
  skipIfDuplicate?: boolean;
}): Promise<SaveResult> {
  const embedding = await embed(args.content, "document");
  const duplicates = await findDuplicates(embedding, args.project);

  if (args.skipIfDuplicate && duplicates.length > 0) {
    return { id: null, createdAt: null, duplicates, skipped: true };
  }

  // 할 일은 "상태"가 있다 → metadata에 done 플래그를 심어 둔다 (열림으로 시작).
  const metadata = args.category === "todo" ? { done: false, doneAt: null } : {};
  const [row] = await db
    .insert(memories)
    .values({
      content: args.content,
      category: args.category ?? null,
      project: args.project ?? null,
      source: args.source ?? null,
      metadata,
      embedding,
    })
    .returning({ id: memories.id, createdAt: memories.createdAt });
  return { id: row.id, createdAt: row.createdAt, duplicates, skipped: false };
}
