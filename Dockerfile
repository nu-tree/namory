# syntax=docker/dockerfile:1.7

# ============================================
# Stage 1: deps — 전체 의존성 설치 (빌드용)
# ============================================
FROM node:22-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# pnpm-workspace.yaml은 의도적으로 복사하지 않음 (packages 필드 없어 오인 유발)
COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

# ============================================
# Stage 2: build — TypeScript 컴파일
# ============================================
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src

RUN pnpm build

# ============================================
# Stage 3: prod-deps — 런타임 의존성만 재설치
# ============================================
FROM node:22-alpine AS prod-deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --prod

# ============================================
# Stage 4: runner — 최종 실행 이미지
# ============================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S app && adduser -S app -G app

COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./
COPY --chown=app:app migrations ./migrations

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "dist/index.js"]
