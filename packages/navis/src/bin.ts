#!/usr/bin/env node
// navis CLI 진입 스크립트(글로벌 설치 시 사용).
// dist/bin.js 가 `bin/navis` 로 심볼릭 링크되어 어디서든 `navis` 명령으로 실행됨.
//
// 환경변수(토큰·시스템 프롬프트) 로딩 우선순위:
//   1) 현재 디렉터리의 .env  (개발용)
//   2) ~/.config/navis/env    (글로벌 설치용 — XDG 표준)
//   3) 이미 export 된 process.env (가장 마지막에 우선)
//
// Node 21.7+ 의 process.loadEnvFile()을 사용 — 별도 dotenv 의존성 불필요.
// 셋 다 없으면 config.ts 가 필수 변수 검증 단계에서 친절히 종료시킨다.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const candidates = [
  join(process.cwd(), ".env"),
  join(homedir(), ".config", "navis", "env"),
];

for (const path of candidates) {
  if (existsSync(path)) {
    try {
      process.loadEnvFile(path);
      // 첫 번째로 찾은 파일만 로드(우선순위 보존). 누락된 키는 process.env 가 채움.
      break;
    } catch (err) {
      console.error(`[navis] env 파일 로드 실패: ${path}`, err);
    }
  }
}

// 동적 import 로 cli 본체를 띄운다. 위에서 process.env 가 이미 채워진 뒤에 config.ts 가
// 평가되도록 import 시점을 늦추는 게 핵심(top-level import 였다면 env 로딩 전 평가됨).
await import("./cli.js");
