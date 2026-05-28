# namory monorepo

> 김남운의 제2의 뇌 시스템. 두 패키지로 구성된다.

| 패키지 | 한 줄 요약 | 자세히 |
| --- | --- | --- |
| [`namory`](./packages/namory) | 기억 저장소 — Fastify + MCP 서버. Supabase Postgres + pgvector, Voyage 임베딩 | [README](./packages/namory/README.md) |
| [`navis`](./packages/navis) | 에이전트 — 디스코드 봇 + 터미널 CLI. Claude Agent SDK + namory MCP | [README](./packages/navis/README.md) |

## 역할 분담

- **namory** = 장기 기억 백엔드. "멍청한" 저장·벡터검색·집계만. 서버 LLM 호출 0.
- **navis** = 두뇌(에이전트). 사용자와 대화하고 namory에 저장·조회. 자동화(크론·다이제스트)도 여기서.

```
[디스코드 / 터미널]
        ↓
     [navis] ─── Claude Agent SDK (OAuth)
        ↓ MCP
     [namory] ─── Supabase pgvector + Voyage
```

namory는 클라이언트가 navis 하나로 한정되지 않는다 — Claude Desktop/Web/Mobile에서도 같은 MCP 엔드포인트로 붙는다. 데스크톱 Claude는 직접, 디스코드/CLI에서는 navis를 거쳐 접근.

## 모노레포

- 패키지 매니저: `pnpm@11` (workspace)
- Node: `>=22` (process.loadEnvFile 사용)
- 빌드: `pnpm -r build` (전체) / 패키지별 `pnpm namory build` · `pnpm navis build`

## 빠른 시작

```bash
pnpm install

# namory(기억 서버) 로컬 띄우기
pnpm namory dev

# navis(디스코드 봇) 띄우기 — 새 터미널
pnpm navis dev

# 또는 CLI만 띄우기
pnpm navis cli
```

자세한 셋업은 각 패키지 README 참조.
