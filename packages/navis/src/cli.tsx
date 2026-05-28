import React, { useCallback, useRef, useState } from "react";
import { render, Box, Static, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { config } from "./config.js";
import { askClaude } from "./claude.js";
import { curateTurn } from "./curator.js";
import { detectProject } from "./project.js";

// navis CLI — Claude Code 스타일 Ink(React-for-CLI) REPL.
// 디스코드 봇과 동일한 두뇌(askClaude/curator) 공유, 시작 디렉터리에서 프로젝트
// 자동 감지 → 이 대화의 save는 자동 태깅.

type TurnInput =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; saved: boolean }
  | { kind: "note"; text: string }
  | { kind: "error"; text: string };
type Turn = TurnInput & { id: number };

const projectContext = detectProject();

function App() {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [session, setSession] = useState<{ sessionId: string; contextTokens: number } | null>(
    null,
  );
  const nextId = useRef(0);

  const addTurn = useCallback((partial: TurnInput) => {
    const turn = { ...partial, id: nextId.current++ } as Turn;
    setTurns((prev) => [...prev, turn]);
  }, []);

  // Ctrl+C 즉시 종료. ink는 raw stdin을 잡고 있어 SIGINT 자동 처리가 안 먹힘.
  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") exit();
  });

  const submit = useCallback(
    async (line: string) => {
      const trimmed = line.trim();
      setInput("");
      if (!trimmed) return;

      // 슬래시 명령 — 메인 턴 거치지 않고 처리.
      if (trimmed === "/quit" || trimmed === "/exit") {
        exit();
        return;
      }
      if (trimmed === "/reset") {
        setSession(null);
        addTurn({ kind: "note", text: "세션 초기화 — 다음 메시지부터 새 세션" });
        return;
      }
      if (trimmed === "/project") {
        addTurn({
          kind: "note",
          text: `현재 프로젝트: ${projectContext ?? "(감지 안 됨 — 개인 기억)"}`,
        });
        return;
      }

      addTurn({ kind: "user", text: trimmed });
      setPending(true);

      // 한도 초과 시 새 세션. 디스코드와 동일 로직.
      const overLimit =
        session !== null && session.contextTokens >= config.contextTokenLimit;
      const resumeId = session && !overLimit ? session.sessionId : undefined;
      if (overLimit && session) {
        const k = Math.round(session.contextTokens / 1000);
        const limitK = Math.round(config.contextTokenLimit / 1000);
        addTurn({
          kind: "note",
          text: `대화 한도(${limitK}k) 도달 — 새 세션 시작 (이전 ~${k}k 토큰)`,
        });
      }

      try {
        const { text, sessionId, contextTokens, saved } = await askClaude(
          trimmed,
          resumeId,
          [], // CLI는 이미지 첨부 없음
          undefined, // 채널 id 없음
          false, // profile_update는 항상 금지(대화 경로)
          projectContext,
        );
        setSession({ sessionId, contextTokens });
        addTurn({ kind: "assistant", text, saved });
        void curateTurn({ userText: trimmed, assistantText: text, projectContext });
      } catch (err) {
        addTurn({
          kind: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setPending(false);
      }
    },
    [session, exit, addTurn],
  );

  const lastSavedSeen = [...turns].reverse().find((t) => t.kind === "assistant");
  const justSaved = lastSavedSeen?.kind === "assistant" ? lastSavedSeen.saved : false;

  return (
    <Box flexDirection="column">
      <Static items={turns}>
        {(turn) => <TurnView key={turn.id} turn={turn} />}
      </Static>

      {pending && (
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> 생각 중...</Text>
        </Box>
      )}

      <Box borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
        <Text color="green">{"› "}</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder="메시지 입력 — /quit 종료, /reset 새 세션, /project 정보"
        />
      </Box>

      <Box paddingX={1} justifyContent="space-between">
        <Text dimColor>
          {projectContext ? `📁 ${projectContext}` : "📁 (개인 기억)"}
          {justSaved ? " · 💡 저장됨" : ""}
        </Text>
        <Text dimColor>/reset · /project · /quit</Text>
      </Box>
    </Box>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.kind === "user") {
    return (
      <Box marginTop={1}>
        <Text color="cyan" bold>
          ❯{" "}
        </Text>
        <Text>{turn.text}</Text>
      </Box>
    );
  }
  if (turn.kind === "assistant") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>{turn.text}</Text>
        {turn.saved && <Text dimColor>💡 저장됨</Text>}
      </Box>
    );
  }
  if (turn.kind === "note") {
    return (
      <Box marginTop={1}>
        <Text dimColor>· {turn.text}</Text>
      </Box>
    );
  }
  return (
    <Box marginTop={1}>
      <Text color="red">[오류] {turn.text}</Text>
    </Box>
  );
}

// 시작 배너 — 한번만 stdout에 흘려 보내고 Ink가 그 아래에서 그리기 시작.
console.log(
  `navis CLI — Claude Code 스타일${projectContext ? ` · 프로젝트: ${projectContext}` : ""}`,
);

render(<App />);
