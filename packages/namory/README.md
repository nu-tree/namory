# namory — 나모리

> 개인용 제2의 뇌 MCP 서버. Claude(데스크톱·웹·모바일) 어디서나 연결해 대화 자동 저장/검색, 패턴 분석, 자기 이해 누적. 원격 호스팅으로 멀티 디바이스 동시 사용.

- 남운(Nam) + Memory · 읽기 "나모리" · 의미 "나의 기억"
- 패키지: `namory-mcp` · CLI: `namory`
- 태그라인: *"My memory, my way"*

## 아키텍처

```
[Claude Desktop 맥북] ─┐
[Claude Desktop PC]   ─┼─→ HTTPS (MCP Streamable HTTP)
[Claude iOS / Android]─┘                ↓
                              [Railway: Fastify + MCP 서버]
                              ├─ save    (대화 저장)
                              ├─ recall  (의미 검색)
                              ├─ pattern (익스플로러)
                              ├─ profile (자기 이해)
                              └─ recent  (최근 기억)
                                          ↓ Drizzle ORM
                              [Supabase Postgres + pgvector]
                                          ↓ HTTPS
                                   [Voyage AI: 임베딩]
```

**설계 원칙:** 서버는 "멍청하게" — 저장·벡터검색·집계만. 패턴 해석/프로파일 작성 등 *지능*은 Claude(클라이언트)가 수행 → 서버 LLM 호출 0, 추가 비용 0.

## 핵심 도구 (MCP)

| 도구 | 용도 |
| --- | --- |
| `save` | 기억 저장 (category: decision / learning / idea / feeling / people / todo) |
| `recall` | 의미 검색 (시간 가중치 + 벡터 유사도 합성) |
| `recent` | 최근 N일 기억 |
| `pattern` | 기간·카테고리 묶음 |
| `todos` | 미완료 할 일 목록 |
| `profile_show` / `profile_update` | 자기이해 프로필 조회/갱신 |
| `update` / `delete` | 기억 수정/삭제 |

## 기술 스택

| 레이어 | 선택 | 비고 |
| --- | --- | --- |
| 언어 | TypeScript + Node.js | |
| 프레임워크 | **Fastify** | MCP 서버 라우팅 (Express에서 변경) |
| MCP | `@modelcontextprotocol/sdk` | transport: Streamable HTTP |
| ORM | **Drizzle ORM** | Supabase 친화, pgvector `vector`/`cosineDistance` 기본 지원 |
| DB | Supabase Postgres + pgvector | 도쿄 `ap-northeast-1`, HNSW 인덱스 |
| 임베딩 | Voyage AI `voyage-3-large` | 1024차원, 한국어 학습 포함 |
| 호스팅 | Railway | 대안: Fly.io / Render |
| 인증 | 단일 시크릿 토큰 1개 | 단일 사용자, MCP 엔드포인트 보호용 |

## 프로젝트 구조

```
src/
├─ index.ts          # Fastify 부트스트랩 (/health, 토큰 게이트, /mcp 마운트)
├─ db/
│  ├─ schema.ts       # memories / profile + vector(1024), HNSW 인덱스
│  └─ client.ts       # postgres-js + drizzle 인스턴스
├─ embedding.ts       # Voyage 래퍼 (document/query input_type 구분)
└─ tools/             # save · recall · recent · pattern · profile
drizzle.config.ts     # drizzle-kit 마이그레이션 설정
```

## 셋업

```bash
pnpm install
cp .env.example .env          # NAMORY_TOKEN / DATABASE_URL / VOYAGE_API_KEY 채우기

# Supabase에서 pgvector 확장 1회 활성화: create extension if not exists vector;
pnpm db:generate              # 스키마 → 마이그레이션 생성
pnpm db:migrate               # Supabase에 적용

pnpm dev                      # 로컬 실행
```

## 비용

| 항목 | 비용 |
| --- | --- |
| Supabase | $0 (무료 티어 500MB, pgvector 포함) |
| 호스팅 | 배포 전 현행 가격 확인 (Railway 무료 정책 변동 이력 있음) |
| Voyage AI | 사실상 $0 (월 60만 토큰 ≈ $0.11) |
| **추가 비용** | **≈ $0/월** |

## 결정 기록

- **2026-05-18**: 초기 스택을 Python+Chroma+Ollama 로컬 → TypeScript+Supabase+Voyage 원격으로 전환. 사유: 멀티 디바이스 동시 사용이 핵심 요구사항.
- **2026-05-18**: 임베딩은 Voyage-3-large (재구축 비용 커서 처음부터 상위 모델).
- **2026-05-18**: 프레임워크 Express → **Fastify**, DB 접근 raw → **Drizzle ORM** 채택.
- 호스팅: Render 콜드스타트(30~60초) 때문에 제외. Railway 우선이나 무료 정책 변동 이력 있어 배포 시점 재확인 (대안 Fly.io).

## 참고

- [MCP 문서](https://modelcontextprotocol.io/docs) · [MCP TS SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Supabase pgvector](https://supabase.com/docs/guides/ai/vector-columns) · [Drizzle + Supabase](https://orm.drizzle.team/docs/get-started/supabase-new)
- [Voyage AI](https://docs.voyageai.com/) · [Claude Custom Connectors](https://support.claude.com/en/articles/11175166)
