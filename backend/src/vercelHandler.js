import { createApp } from "./app.js";
import { createDashboardService } from "./dashboardService.js";

export function createVercelHandler({
  env = process.env,
  cacheStore,
  fetchImpl,
  now,
}) {
  const required = ["GITHUB_OWNER", "GITHUB_REPO", "GITHUB_TOKEN"];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing required backend environment variables: ${missing.join(", ")}`);
  }

  const allowedOrigins = (env.CORS_ORIGINS || "https://pavithraakannann.github.io")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const dashboardService = createDashboardService({
    owner: env.GITHUB_OWNER.trim(),
    repo: env.GITHUB_REPO.trim(),
    token: env.GITHUB_TOKEN.trim(),
    cacheStore,
    cacheTtlMs: Number(env.CACHE_TTL_SECONDS || 300) * 1000,
    fetchImpl,
    now,
  });
  const cacheReady = dashboardService.loadCache();
  const app = createApp({ dashboardService, allowedOrigins });

  return async function handler(request, response) {
    await cacheReady;
    return app(request, response);
  };
}
