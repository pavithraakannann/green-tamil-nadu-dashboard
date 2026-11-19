import compression from "compression";
import cors from "cors";
import express from "express";
import { buildProgressReport } from "./progress.js";
import { buildPalmTargetReport, buildTargetReport } from "./targets.js";

/** Udhavi palm seeds by district for the palm target report; never fails the dashboard request. */
async function udhaviFor(udhavi, force) {
  if (!udhavi) return null;
  try {
    return await udhavi.get({ force });
  } catch (error) {
    return { error: error.message || "The Udhavi API is unavailable." };
  }
}

/** Dashboard payload with target vs geotagged reports (no authentication). */
async function sessionPayload(payload, udhavi, force = false) {
  const palmTargets = buildPalmTargetReport(payload, { role: "admin" });
  if (palmTargets) palmTargets.udhavi = await udhaviFor(udhavi, force);
  let progress = null;
  try {
    progress = buildProgressReport(payload, palmTargets?.udhavi);
  } catch (error) {
    console.error(`Progress report failed. ${error.message}`);
  }
  return { ...payload, targets: buildTargetReport(payload, { role: "admin" }), palmTargets, progress };
}

export function createApp({ dashboardService, allowedOrigins, udhavi = null }) {
  const app = express();
  const origins = new Set(allowedOrigins);
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(compression());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
  }));
  app.use(express.json({ limit: "10kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ...dashboardService.getStatus() });
  });

  app.get("/api/dashboard-data", async (request, response) => {
    try {
      response.set("Cache-Control", "no-store");
      response.json(await sessionPayload(await dashboardService.getDashboardData(), udhavi));
    } catch (error) {
      response.status(503).json({ error: error.message || "Dashboard data is unavailable." });
    }
  });

  app.get("/api/map-points", async (request, response) => {
    try {
      response.set("Cache-Control", "no-store");
      const payload = await dashboardService.getDashboardData();
      response.json({ lastSyncedAt: payload.lastSyncedAt ?? null, datasets: payload.datasets.map((dataset) => ({ source: dataset.source, points: dataset.points ?? null })) });
    } catch (error) {
      response.status(503).json({ error: error.message || "Map data is unavailable." });
    }
  });

  app.post("/api/refresh", async (request, response) => {
    try {
      response.set("Cache-Control", "no-store");
      response.json(await sessionPayload(await dashboardService.forceRefresh(), udhavi, true));
    } catch (error) {
      response.status(503).json({ error: error.message || "Dashboard refresh failed." });
    }
  });

  return app;
}
