import { or, eq, isNull, type SQL } from "drizzle-orm";
import { memories } from "../db/schema.js";

// project 스코프 필터. 값이 있으면 "그 프로젝트 OR 개인(null)" 기억만 남기고
// 다른 프로젝트 기억은 제외한다(컨텍스트 토큰 절약). 없으면 필터 없음(undefined).
// drizzle의 and()/or()는 undefined 인자를 무시하므로 그대로 조합해 쓸 수 있다.
export function projectFilter(project?: string): SQL | undefined {
  return project
    ? or(eq(memories.project, project), isNull(memories.project))
    : undefined;
}
