import { createServer } from "node:http";
import { config } from "./config.js";
import { startDiscord } from "./discord.js";
import { startCronScheduler } from "./cron.js";
import { startDigestScheduler } from "./digest.js";

// 디스코드 게이트웨이 봇 시작 (always-on 워커).
const client = startDiscord();

// 선제적 알림 스케줄러 시작 (namory에서 잡 로드 → node-cron 등록).
void startCronScheduler(client);

// 주간 기억 다이제스트 스케줄러 시작 (최근 기억 요약 → 프로필 자동 갱신 + 보고).
startDigestScheduler(client);

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
