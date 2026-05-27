import { createServer } from "node:http";
import { config } from "./config.js";
import { startDiscord } from "./discord.js";

// 디스코드 게이트웨이 봇 시작 (always-on 워커).
startDiscord();

// Railway 등 호스팅 uptime 체크용 최소 HTTP 서버. 봇은 인바운드 HTTP가
// 필요 없지만, 헬스 엔드포인트가 있어야 헬스체크가 통과한다.
createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(config.port, "0.0.0.0", () => {
  console.log(`[agent] health on :${config.port}`);
});
