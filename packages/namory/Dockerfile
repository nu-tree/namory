# syntax=docker/dockerfile:1.7
#
# 모노레포 빌드 — 빌드 컨텍스트는 반드시 "레포 루트"여야 한다.
# (pnpm-lock.yaml / pnpm-workspace.yaml 이 루트에 단 하나 존재하기 때문)
#
#   docker build -f packages/namory/Dockerfile -t namory .
#
# pnpm deploy 로 namory-mcp 패키지만 의존성과 함께 standalone 디렉터리로 추출한다.

# ============================================
# Stage 1: build — 의존성 설치 + 컴파일 + deploy
# ============================================
FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

# 워크스페이스 매니페스트 + 대상 패키지 매니페스트만 먼저 복사 (레이어 캐시)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/namory/package.json ./packages/namory/package.json

RUN pnpm install --frozen-lockfile --filter namory-mcp

# 소스 복사 후 빌드
COPY packages/namory ./packages/namory
RUN pnpm --filter namory-mcp build

# 런타임 의존성만 담은 standalone 산출물 (/app)
RUN pnpm --filter namory-mcp deploy --prod /app

# ============================================
# Stage 2: runner — 최종 실행 이미지
# ============================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /repo/packages/namory/migrations ./migrations

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "dist/index.js"]
