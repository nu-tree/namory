import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { config } from "./config.js";
import { askClaude } from "./claude.js";
import { curateTurn } from "./curator.js";
import { detectProject } from "./project.js";

// navis CLI — 디스코드 봇과 동일한 두뇌(claude.ts)를 공유하는 REPL.
// 실행한 디렉터리의 package.json 또는 .navis 파일에서 프로젝트명을 자동 감지해
// 그 대화의 모든 save 호출에 project 태그를 자동 부착한다.
//
// 슬래시 명령
//   /reset    — 진행 중인 세션 끊고 다음 메시지부터 새 세션
//   /project  — 감지된 프로젝트 컨텍스트 표시
//   /quit     — 종료

const projectContext = detectProject();

// 단일 세션 상태(in-memory) — 디스코드와 동일하게 한도 넘으면 다음 메시지에서 리셋.
let session: { sessionId: string; contextTokens: number } | null = null;

async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });

  // 시작 배너 — 어떤 프로젝트로 묶여 저장되는지 명확히 보여줌(가장 흔한 실수 방지).
  console.log("navis CLI — 종료: /quit, 새 세션: /reset, Ctrl-C");
  console.log(
    projectContext
      ? `프로젝트: "${projectContext}" (이 대화의 저장은 자동 태깅됨)`
      : "프로젝트: (감지 안 됨 — 개인 기억으로 저장)",
  );
  console.log("");

  // 종료 핸들러: Ctrl-C 두 번이면 강제 종료, 한 번은 정상 종료.
  rl.on("SIGINT", () => {
    console.log("\n[종료]");
    rl.close();
  });

  for (;;) {
    let line: string;
    try {
      line = (await rl.question("> ")).trim();
    } catch {
      // readline이 닫혔다(Ctrl-C/Ctrl-D) — 정상 종료.
      break;
    }
    if (!line) continue;

    if (line === "/quit" || line === "/exit") break;
    if (line === "/reset") {
      session = null;
      console.log("[알림] 세션 초기화. 다음 메시지부터 새 세션.");
      continue;
    }
    if (line === "/project") {
      console.log(
        projectContext
          ? `현재 프로젝트: "${projectContext}"`
          : "현재 프로젝트: 감지 안 됨",
      );
      continue;
    }

    // 한도 넘으면 새 세션. 디스코드와 동일 로직.
    const overLimit =
      session !== null && session.contextTokens >= config.contextTokenLimit;
    const resumeId = session && !overLimit ? session.sessionId : undefined;
    if (overLimit && session) {
      const k = Math.round(session.contextTokens / 1000);
      const limitK = Math.round(config.contextTokenLimit / 1000);
      console.log(
        `[알림] 대화가 한도(${limitK}k)에 도달해 맥락을 새로 시작합니다(이전 ~${k}k 토큰).`,
      );
    }

    try {
      const { text, sessionId, contextTokens, saved } = await askClaude(
        line,
        resumeId,
        [], // CLI는 이미지 첨부 없음
        undefined, // 채널 id 없음 → 크론 도구도 안 붙음(정상)
        false, // profile_update는 항상 금지(대화 경로)
        projectContext,
      );
      session = { sessionId, contextTokens };
      // 응답 출력. 저장됐으면 💡 표시(디스코드 리액션의 텍스트 대체).
      console.log("");
      console.log(text);
      if (saved) console.log("💡");
      console.log("");

      // 사후 큐레이터 — 디스코드와 동일하게 fire-and-forget.
      void curateTurn({
        userText: line,
        assistantText: text,
        projectContext,
      });
    } catch (err) {
      console.error("[오류]", err instanceof Error ? err.message : err);
    }
  }

  rl.close();
}

void main();
