import Fastify from "fastify";

const app = Fastify({ logger: true });

// 헬스체크 (호스팅 uptime 용)
app.get("/health", async () => ({ ok: true }));

// 공개 HTTP 엔드포인트 보호: 단일 시크릿 토큰.
// 별도 auth 모듈/Supabase Auth 불필요 — 단일 사용자라 이 hook 하나면 충분.
app.addHook("onRequest", async (req, reply) => {
  if (!req.url.startsWith("/mcp")) return;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!process.env.NAMORY_TOKEN || token !== process.env.NAMORY_TOKEN) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

// TODO(Phase 0 스파이크): MCP Streamable HTTP transport + 툴 5종을 여기 마운트.
// 설치된 @modelcontextprotocol/sdk 버전에 맞춰 배선 확정.
app.all("/mcp", async (_req, reply) => {
  return reply.code(501).send({ error: "not implemented yet" });
});

const port = Number(process.env.PORT) || 3000;
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`namory listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
