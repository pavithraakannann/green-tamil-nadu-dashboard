import "dotenv/config";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { createDashboardService } from "./dashboardService.js";
import { createUdhaviService } from "./udhaviService.js";

const required = ["GITHUB_OWNER", "GITHUB_REPO", "GITHUB_TOKEN"];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  throw new Error(`Missing required backend environment variables: ${missing.join(", ")}`);
}

const allowedOrigins = (process.env.CORS_ORIGINS
  || "https://pavithraakannann.github.io,http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const dashboardService = createDashboardService({
  owner: process.env.GITHUB_OWNER.trim(),
  repo: process.env.GITHUB_REPO.trim(),
  token: process.env.GITHUB_TOKEN.trim(),
  cacheFile: process.env.CACHE_FILE || resolve(".cache", "dashboard-data.json"),
  cacheTtlMs: Number(process.env.CACHE_TTL_SECONDS || 300) * 1000,
});

await dashboardService.loadCache();
const app = createApp({ dashboardService, allowedOrigins, udhavi: createUdhaviService() });
const port = Number(process.env.PORT || 3001);
app.listen(port, "0.0.0.0", () => {
  console.log(`Dashboard API listening on port ${port}.`);
});
