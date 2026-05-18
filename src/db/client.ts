import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL 환경변수가 필요합니다 (Supabase 연결 문자열)");
}

// Supabase 풀러(transaction mode)에서는 prepared statement 비활성 권장
const queryClient = postgres(url, { prepare: false });
export const db = drizzle(queryClient, { schema });
