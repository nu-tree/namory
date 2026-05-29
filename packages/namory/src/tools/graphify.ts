import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { memories, type Category } from "../db/schema.js";
import { projectFilter } from "./filter.js";

interface GraphNode {
  id: string;
  content: string;
  category: string | null;
  project: string | null;
  tags: string[];
  createdAt: Date;
}

interface GraphEdge {
  source: string;
  target: string;
  type: "related";
}

interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  // 태그 → 해당 기억 id 목록 (클라이언트가 시각화·필터에 활용)
  tag_groups: Record<string, string[]>;
}

export async function graphify(args: {
  project?: string;
  category?: Category;
  limit?: number;
}): Promise<GraphResult> {
  const limit = args.limit ?? 300;

  const rows = await db
    .select({
      id: memories.id,
      content: memories.content,
      category: memories.category,
      project: memories.project,
      metadata: memories.metadata,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(
      and(
        args.category ? eq(memories.category, args.category) : undefined,
        projectFilter(args.project),
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(limit);

  const idSet = new Set(rows.map((r) => r.id));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const tag_groups: Record<string, string[]> = {};
  const seenEdges = new Set<string>(); // 중복 엣지 방지

  for (const row of rows) {
    const meta = (row.metadata as Record<string, unknown>) ?? {};
    const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
    const related_ids = Array.isArray(meta.related_ids)
      ? (meta.related_ids as string[])
      : [];

    nodes.push({
      id: row.id,
      content: row.content,
      category: row.category,
      project: row.project,
      tags,
      createdAt: row.createdAt,
    });

    // related 엣지 (결과 셋 내부 연결만)
    for (const targetId of related_ids) {
      if (!idSet.has(targetId)) continue;
      const edgeKey = [row.id, targetId].sort().join("|");
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);
      edges.push({ source: row.id, target: targetId, type: "related" });
    }

    // 태그 그룹
    for (const tag of tags) {
      if (!tag_groups[tag]) tag_groups[tag] = [];
      tag_groups[tag].push(row.id);
    }
  }

  return { nodes, edges, tag_groups };
}
