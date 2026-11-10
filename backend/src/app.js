import compression from "compression";
import cors from "cors";
import express from "express";

export function createApp({ dashboardService, allowedOrigins }) {
  const app = express();
  const origins = new Set(allowedOrigins);
  app.disable("x-powered-by");
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
  }));

  app.get("/api/health", (_request, response) => {
    response.json(dashboardService.getStatus());
  });

  app.get("/api/dashboard-data", async (_request, response) => {
    try {
      response.set("Cache-Control", "no-store");
      response.json(await dashboardService.getDashboardData());
    } catch (error) {
      response.status(503).json({ error: error.message || "Dashboard data is unavailable." });
    }
  });

  app.post("/api/refresh", async (_request, response) => {
    try {
      response.set("Cache-Control", "no-store");
      response.json(await dashboardService.forceRefresh());
    } catch (error) {
      response.status(503).json({ error: error.message || "Dashboard refresh failed." });
    }
  });

  return app;
}
