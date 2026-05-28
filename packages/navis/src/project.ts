import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";

// 작업 디렉터리부터 위로 올라가며 프로젝트명을 감지한다(=navis CLI 자동 태깅용).
// 우선순위:
//   1) .navis 파일(한 줄짜리 프로젝트명) — 명시적 오버라이드. 가장 강함.
//   2) package.json 의 name — 일반적인 노드 프로젝트 자동 감지.
//   3) (못 찾으면) undefined → 기억은 개인/전역(null)으로 저장.
// pnpm 스크립트로 실행 시엔 INIT_CWD가 진짜 호출 위치를 가리키므로 그쪽을 우선.
export function detectProject(): string | undefined {
  const start = process.env.INIT_CWD || process.cwd();
  return walkUp(start);
}

function walkUp(startDir: string): string | undefined {
  let dir = resolve(startDir);
  // 루트("/")까지 올라가며 탐색. 무한루프 방지로 부모와 같아지면 종료.
  while (true) {
    // 1) .navis 명시적 오버라이드
    const navisFile = resolve(dir, ".navis");
    if (existsSync(navisFile)) {
      const raw = safeRead(navisFile);
      const name = raw?.trim().split("\n")[0]?.trim();
      if (name) return name;
    }
    // 2) package.json name
    const pkg = resolve(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { name?: unknown };
        if (typeof parsed.name === "string" && parsed.name.trim()) {
          // @scope/name 형태면 마지막 세그먼트만 사용(태그 가독성).
          return parsed.name.includes("/") ? basename(parsed.name) : parsed.name;
        }
      } catch {
        // 파싱 실패는 그냥 건너뜀 — 더 위로 올라간다.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function safeRead(p: string): string | undefined {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return undefined;
  }
}
