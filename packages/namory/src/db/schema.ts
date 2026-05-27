import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  vector,
  boolean,
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

// 선제적 알림 스케줄 — navis가 정해진 시간에 깨어나 prompt를 실행해 channelId로 보고한다.
// 영속화는 namory(DB)가, 실제 스케줄링/전송은 navis(node-cron) 프로세스가 담당.
export const crons = pgTable("crons", {
  id: uuid("id").primaryKey().defaultRandom(),
  // 사람이 읽는 라벨 (예: "매일 아침 주식 정리")
  title: text("title").notNull(),
  // node-cron 식 (예: "0 9 * * *")
  schedule: text("schedule").notNull(),
  // 스케줄 해석 타임존 (예: Asia/Seoul). 기본 한국시간.
  timezone: text("timezone").notNull().default("Asia/Seoul"),
  // 발동 시 navis가 실행할 지시문
  prompt: text("prompt").notNull(),
  // 결과를 보낼 디스코드 채널 id (등록한 대화의 채널)
  channelId: text("channel_id").notNull(),
  // 비활성화하면 스케줄에서 제외 (삭제 대신 끄기)
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
});

// 자기 이해 누적 — 단일 사용자라 섹션별 1행 (values / patterns / goals ...)
export const profile = pgTable("profile", {
  section: text("section").primaryKey(),
  content: text("content").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
