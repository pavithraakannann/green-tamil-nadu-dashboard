import compression from "compression";
import cors from "cors";
import express from "express";
import { createAuth, listDepartments, mapPointsForSession, payloadForSession } from "./auth.js";
import { buildPalmTargetReport, buildTargetReport } from "./targets.js";

/** Udhavi palm seeds by district for the palm target report; never fails the dashboard request. */
async function udhaviFor(udhavi, session, force) {
  if (!udhavi || session.role !== "admin") return null;
  try {
    return await udhavi.get({ force });
  } catch (error) {
    return { error: error.message || "The Udhavi API is unavailable." };
  }
}

/** Session-filtered dashboard payload plus the target vs geotagged reports for that session. */
async function sessionPayload(payload, session, udhavi, force = false) {
  const filtered = payloadForSession(payload, session);
  const palmTargets = buildPalmTargetReport(filtered, session);
  if (palmTargets) palmTargets.udhavi = await udhaviFor(udhavi, session, force);
  return { ...filtered, targets: buildTargetReport(filtered, session), palmTargets };
}

export function createApp({ dashboardService, allowedOrigins, auth = createAuth(), udhavi = null }) {
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
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  }));
  app.use(express.json({ limit: "10kb" }));

  function requireSession(request, response, next) {
    const header = request.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const session = auth.verifyToken(token);
    if (!session) {
      response.set("Cache-Control", "no-store");
      response.status(401).json({ error: "Please log in to view the dashboard." });
      return;
    }
    request.session = session;
    next();
  }

  app.get("/api/health", (_request, response) => {
    response.json({ ...dashboardService.getStatus(), authConfigured: auth.configured });
  });

  app.post("/api/login", async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      const result = await auth.login(
        {
          username: request.body?.username,
          password: request.body?.password,
          clientKey: request.ip || "unknown",
        },
        async () => listDepartments(await dashboardService.getDashboardData()),
      );
      if (result.error) {
        response.status(result.status).json({ error: result.error });
        return;
      }
      response.json({ token: result.token, role: result.role, department: result.department });
    } catch (error) {
      response.status(503).json({ error: error.message || "Login is unavailable." });
    }
  });

  app.get("/api/dashboard-data", requireSession, async (request, response) => {
    try {
      response.set("Cache-Control", "no-store");
      response.json(await sessionPayload(await dashboardService.getDashboardData(), request.session, udhavi));
    } catch (error) {
      response.status(503).json({ error: error.message || "Dashboard data is unavailable." });
    }
  });

  app.get("/api/map-points", requireSession, async (request, response) => {
    try {
      response.set("Cache-Control", "no-store");
      response.json(mapPointsForSession(await dashboardService.getDashboardData(), request.session));
    } catch (error) {
      response.status(503).json({ error: error.message || "Map data is unavailable." });
    }
  });

  app.post("/api/refresh", requireSession, async (request, response) => {
    try {
      response.set("Cache-Control", "no-store");
      response.json(await sessionPayload(await dashboardService.forceRefresh(), request.session, udhavi, true));
    } catch (error) {
      response.status(503).json({ error: error.message || "Dashboard refresh failed." });
    }
  });

  return app;
}
