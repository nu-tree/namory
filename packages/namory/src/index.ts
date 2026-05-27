import Fastify from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./mcp.js";
import { listCrons, createCron, deleteCron } from "./tools/cron.js";

const app = Fastify({
  logger: {
    // 쿼리 토큰(?token=)이 Railway 등 호스팅 로그에 평문으로 남지 않도록 마스킹.
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url.replace(/([?&]token=)[^&]*/i, "$1[REDACTED]"),
          host: request.headers?.host,
          remoteAddress: request.ip,
        };
      },
    },
  },
});

// 헬스체크 (호스팅 uptime 용)
app.get("/health", async () => ({ ok: true }));

// 공개 HTTP 엔드포인트 보호: 단일 시크릿 토큰.
// 별도 auth 모듈/Supabase Auth 불필요 — 단일 사용자라 이 hook 하나면 충분.
// 인증 경로 2가지:
//  1) Authorization: Bearer <토큰>  — 권장 (mcp-remote 등 헤더 가능한 클라이언트)
//  2) ?token=<토큰> 쿼리 파라미터    — Claude 커스텀 커넥터 UI엔 헤더/토큰 입력란이
//     없어 URL에 실어야 함. 토큰은 위 로거에서 마스킹됨.
app.addHook("onRequest", async (req, reply) => {
  // /mcp(도구)와 /crons(스케줄 CRUD) 둘 다 토큰으로 보호. 그 외(/health)는 공개.
  if (!req.url.startsWith("/mcp") && !req.url.startsWith("/crons")) return;
  const headerToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const queryToken =
    new URL(req.url, "http://localhost").searchParams.get("token") ?? undefined;
  const token = headerToken || queryToken;
  if (!process.env.NAMORY_TOKEN || token !== process.env.NAMORY_TOKEN) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

// MCP Streamable HTTP — stateless 모드 (요청마다 새 서버+트랜스포트).
// 단일 사용자·멀티 디바이스·멀티 인스턴스라 세션 친화성이 불필요 → 가장 견고.
app.all("/mcp", async (req, reply) => {
  // 트랜스포트가 reply.raw 에 직접 쓰므로 Fastify 응답 관리를 넘긴다.
  reply.hijack();

  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  reply.raw.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    // Fastify 가 이미 본문을 파싱했으므로 req.body 를 그대로 넘겨 재파싱 방지.
    await transport.handleRequest(req.raw, reply.raw, req.body);
  } catch (err) {
    app.log.error(err);
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { "content-type": "application/json" });
      reply.raw.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "internal error" },
          id: null,
        }),
      );
    }
  }
});

// 크론 CRUD (navis 스케줄러/대화 도구가 사용). MCP가 아닌 단순 REST —
// navis가 에이전트 턴 밖(부팅·reconcile)에서도 조회해야 해서 일반 HTTP로 노출.
app.get("/crons", async () => ({ crons: await listCrons() }));

app.post("/crons", async (req, reply) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const schedule = typeof b.schedule === "string" ? b.schedule.trim() : "";
  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  const channelId = typeof b.channelId === "string" ? b.channelId.trim() : "";
  const timezone = typeof b.timezone === "string" ? b.timezone.trim() : undefined;
  if (!title || !schedule || !prompt || !channelId) {
    return reply
      .code(400)
      .send({ error: "title, schedule, prompt, channelId 가 모두 필요합니다" });
  }
  const row = await createCron({ title, schedule, prompt, channelId, timezone });
  return reply.code(201).send(row);
});

app.delete<{ Params: { id: string } }>("/crons/:id", async (req, reply) => {
  try {
    return await deleteCron({ id: req.params.id });
  } catch {
    return reply.code(404).send({ error: "해당 id의 크론이 없습니다" });
  }
});

const port = Number(process.env.PORT) || 3000;
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`namory listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
