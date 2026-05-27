import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  vector,
  index,
} from "drizzle-orm/pg-core";

export const CATEGORIES = [
  "decision",
  "learning",
  "idea",
  "feeling",
  "people",
  "todo",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    content: text("content").notNull(),
    category: text("category"),
    // 프로젝트 스코프(nullable). null = 개인/전역 기억. 값이 있으면 그 프로젝트 기억.
    // 카테고리와 직교하는 두 번째 축 ("navis 프로젝트의 todo" 같은 검색용).
    project: text("project"),
    embedding: vector("embedding", { dimensions: 1024 }),
    source: text("source"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("memories_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
    index("memories_created_at_idx").on(t.createdAt.desc()),
    index("memories_category_idx").on(t.category),
    index("memories_project_idx").on(t.project),
  ],
);

// 자기 이해 누적 — 단일 사용자라 섹션별 1행 (values / patterns / goals ...)
export const profile = pgTable("profile", {
  section: text("section").primaryKey(),
  content: text("content").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
