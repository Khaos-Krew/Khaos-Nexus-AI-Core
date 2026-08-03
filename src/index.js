import { createApp } from "./app.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "8790", 10);
const authRequired = process.env.AUTH_REQUIRED === "true";
const serviceToken = process.env.NEXUS_AI_CORE_SERVICE_TOKEN ?? "";
const rateLimitPerMinute = Number.parseInt(process.env.RATE_LIMIT_PER_MINUTE ?? "60", 10);

const server = createApp({
  serviceToken,
  authRequired,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  rateLimit: { limit: Number.isFinite(rateLimitPerMinute) ? rateLimitPerMinute : 60 },
});

server.listen(port, host, () => {
  console.log(`Khaos Nexus AI Core listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
