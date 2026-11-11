import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
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
  // A failed cache read (e.g. a transient Blob network error) must not crash the
  // function: log it, serve the request (data is re-fetched from GitHub if needed),
  // and retry the cache read on the next request.
  let cacheReady = null;
  function ensureCacheLoaded() {
    cacheReady ??= dashboardService.loadCache().catch((error) => {
      console.error(`Dashboard cache load failed; will retry on next request. ${error.message}`);
      cacheReady = null;
    });
    return cacheReady;
  }
  ensureCacheLoaded();
  const app = createApp({ dashboardService, allowedOrigins, auth: createAuth({ env }) });

  return async function handler(request, response) {
    await ensureCacheLoaded();
    return app(request, response);
  };
}
