import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { config } from "../config.js";

// GitHub Contents API 기반 자기 소스 조회 도구.
// 디스코드 봇은 컨테이너에 src/가 없어서(dist 만 복사) 자기 코드를 물리적으로 못 본다.
// 이 도구로 GitHub raw 를 읽어 "이 부분 어떻게 짜여있어?" 같은 질의에 답할 수 있게 한다.
// 수정은 별도 흐름(Actions self-improve)에서 — 여기서는 읽기만.

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const err = (text: string) => ({
  content: [{ type: "text" as const, text }],
  isError: true,
});

// API 응답을 다 안 싣고 모델 토큰 절약 — 파일 한도. 보통 200KB 넘는 소스는 거의 없음.
const MAX_FILE_BYTES = 256 * 1024;

interface ContentsFile {
  type: "file";
  name: string;
  path: string;
  size: number;
  content: string; // base64
  encoding: "base64";
}
interface ContentsDirEntry {
  type: "file" | "dir" | "symlink" | "submodule";
  name: string;
  path: string;
  size: number;
}

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (config.githubToken) h.authorization = `Bearer ${config.githubToken}`;
  return h;
}

function repoOrError(): { repo: string } | { error: string } {
  if (!config.githubRepo) {
    return {
      error:
        "GITHUB_REPO 환경변수가 비어 있습니다. owner/repo 형태로 설정해 주세요(예: nu-tree/namory).",
    };
  }
  return { repo: config.githubRepo };
}

export const REPO_TOOL_NAMES = [
  "mcp__repo__read_repo_file",
  "mcp__repo__list_repo_files",
];

export function buildRepoTools(): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "repo",
    version: "0.1.0",
    tools: [
      tool(
        "read_repo_file",
        "GitHub 레포의 파일 한 개를 읽는다. 디스코드 봇은 컨테이너에 소스가 없으므로 자기 코드를 보려면 이 도구를 써야 한다. 결과는 파일 원문(텍스트). 너무 크면 잘림 안내.",
        {
          path: z
            .string()
            .min(1)
            .describe("레포 루트 기준 경로. 예: packages/navis/src/claude/ask.ts"),
          ref: z
            .string()
            .optional()
            .describe("브랜치/태그/sha (기본 main)"),
        },
        async (args) => {
          const r = repoOrError();
          if ("error" in r) return err(r.error);
          const refParam = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : "";
          const url = `https://api.github.com/repos/${r.repo}/contents/${encodeURI(args.path)}${refParam}`;
          const res = await fetch(url, { headers: buildHeaders() });
          if (res.status === 404) {
            return err(`파일을 찾을 수 없습니다: ${args.path} (ref=${args.ref ?? "main"})`);
          }
          if (!res.ok) {
            return err(`GitHub API 실패: ${res.status} ${await res.text()}`);
          }
          const data = (await res.json()) as ContentsFile | ContentsDirEntry[];
          if (Array.isArray(data) || data.type !== "file") {
            return err(`경로가 파일이 아닙니다(디렉터리?): ${args.path}`);
          }
          if (data.size > MAX_FILE_BYTES) {
            return err(
              `파일이 너무 큽니다(${data.size}B > ${MAX_FILE_BYTES}B). 부분 조회는 아직 미지원 — 다른 경로를 시도하거나 list_repo_files 로 좁히세요.`,
            );
          }
          const text = Buffer.from(data.content, "base64").toString("utf8");
          return ok(text);
        },
      ),
      tool(
        "list_repo_files",
        "GitHub 레포의 디렉터리 목록을 가져온다. 어떤 파일이 있는지 모를 때 먼저 호출해 구조를 파악한다.",
        {
          dir: z
            .string()
            .optional()
            .describe("레포 루트 기준 경로 (기본 루트). 예: packages/navis/src/claude"),
          ref: z
            .string()
            .optional()
            .describe("브랜치/태그/sha (기본 main)"),
        },
        async (args) => {
          const r = repoOrError();
          if ("error" in r) return err(r.error);
          const dir = args.dir ?? "";
          const refParam = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : "";
          const url = `https://api.github.com/repos/${r.repo}/contents/${encodeURI(dir)}${refParam}`;
          const res = await fetch(url, { headers: buildHeaders() });
          if (res.status === 404) {
            return err(`디렉터리를 찾을 수 없습니다: ${dir || "(루트)"} (ref=${args.ref ?? "main"})`);
          }
          if (!res.ok) {
            return err(`GitHub API 실패: ${res.status} ${await res.text()}`);
          }
          const data = (await res.json()) as ContentsFile | ContentsDirEntry[];
          if (!Array.isArray(data)) {
            return err(`경로가 디렉터리가 아닙니다(파일?): ${dir}`);
          }
          // 모델이 보기 쉽게 type · size · path 만 추려서 정렬.
          const entries = data
            .map((e) => ({ type: e.type, path: e.path, size: e.size }))
            .sort((a, b) =>
              a.type === b.type ? a.path.localeCompare(b.path) : a.type.localeCompare(b.type),
            );
          return ok(JSON.stringify(entries, null, 2));
        },
      ),
    ],
  });
}
