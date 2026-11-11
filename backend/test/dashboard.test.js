import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createDashboardService } from "../src/dashboardService.js";
import { aggregateCsv, aggregateCsvStream } from "../src/csvService.js";
import { fetchLatestRelease, fetchReleaseAssetStream } from "../src/githubService.js";
import { createVercelHandler } from "../src/vercelHandler.js";
import { createAuth, listDepartments, mapPointsForSession, payloadForSession } from "../src/auth.js";

const TEST_AUTH_ENV = {
  AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "admin-pass-123",
  DEPARTMENT_PASSWORD: "dept-pass-123",
};
const testAuth = () => createAuth({ env: TEST_AUTH_ENV });

async function loginToken(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error);
  return payload.token;
}
import { Readable } from "node:stream";
import { gunzipSync, gzipSync } from "node:zlib";
import { createServer, get } from "node:http";

test("aggregates only whitelisted dashboard dimensions and removes private columns", () => {
  const csv = [
    "District,Division,Year,Species,Scheme,Date,Department,Seedlings,Farmer Name,Mobile,Report ID,Village",
    "Chennai,Chennai,2025-2026,Neem,CAMPA,2025-07-01,Forest Department,10,A Person,9999999999,abc,Village X",
    "Chennai,Chennai,2025-2026,Neem,CAMPA,2025-07-01,Forest Department,15,Another Person,8888888888,def,Village Y",
  ].join("\n");
  const result = aggregateCsv(csv, "merge");

  assert.deepEqual(result.headers, [
    "District", "Division", "Year", "Species", "Scheme", "Date", "Department",
    "Seedlings", "Record Count",
  ]);
  assert.deepEqual(result.rows, [[
    "Chennai", "Chennai", "2025-2026", "Neem", "CAMPA", "2025-07-01",
    "Forest Department", "25", "2",
  ]]);
  assert.equal(JSON.stringify(result).includes("A Person"), false);
  assert.equal(JSON.stringify(result).includes("9999999999"), false);
  assert.equal(JSON.stringify(result).includes("Village X"), false);
  assert.equal(JSON.stringify(result).includes("Report ID"), false);
});

test("GitHub release and asset-ID fetch use private-repository auth and correct headers", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers, cache: options.cache });
    if (String(url).endsWith("/releases/latest")) {
      return Response.json({
        published_at: "2026-11-01T00:00:00Z",
        assets: [
          { name: "merged.csv.gz", id: 21, updated_at: "2026-11-06T00:00:00Z" },
          { name: "palm_trees.csv", id: 22, updated_at: "2026-11-06T00:01:00Z" },
        ],
      });
    }
    const body = "District,Seedlings\nChennai,100\n";
    return String(url).endsWith("/21")
      ? new Response(gzipSync(body))
      : new Response(body);
  };

  const release = await fetchLatestRelease({
    owner: "owner",
    repo: "private-data",
    token: "test-token",
    fetchImpl,
  });
  assert.deepEqual(release.assets.merge, {
    id: 21,
    name: "merged.csv.gz",
    updatedAt: "2026-11-06T00:00:00Z",
  });
  assert.deepEqual(release.assets.palm, {
    id: 22,
    name: "palm_trees.csv",
    updatedAt: "2026-11-06T00:01:00Z",
  });
  const asset = await fetchReleaseAssetStream({
    owner: "owner",
    repo: "private-data",
    token: "test-token",
    assetId: release.assets.merge.id,
    assetFileName: release.assets.merge.name,
    name: "merge.csv",
    fetchImpl,
  });

  assert.equal(release.releasePublishedAt, "2026-11-01T00:00:00Z");
  assert.equal(release.sourceUpdatedAt, "2026-11-06T00:01:00Z");
  assert.equal(asset.compressed, true);
  assert.equal(
    gunzipSync(Buffer.from(await new Response(asset.body).arrayBuffer())).toString("utf8"),
    "District,Seedlings\nChennai,100\n",
  );
  assert.equal(calls[0].headers.Authorization, "Bearer test-token");
  assert.equal(calls[0].headers.Accept, "application/vnd.github+json");
  assert.equal(calls[0].cache, "no-store");
  assert.equal(calls[1].url.endsWith("/releases/assets/21"), true);
  assert.equal(calls[1].headers.Accept, "application/octet-stream");
  assert.equal(calls[1].headers.Authorization, "Bearer test-token");
});

test("refresh caches both aggregate datasets together and retains the old cache on failure", async () => {
  let failRefresh = false;
  const fetchImpl = async (url) => {
    requestCount += 1;
    if (failRefresh) return new Response("", { status: 500 });
    if (String(url).endsWith("/releases/latest")) {
      return Response.json({
        assets: [{ name: "merged.csv.gz", id: 1 }, { name: "palm_trees.csv", id: 2 }],
      });
    }
    const source = String(url).endsWith("/1") ? "Chennai" : "Madurai";
    const csv = `District,Seedlings\n${source},10\n`;
    return String(url).endsWith("/1")
      ? new Response(gzipSync(csv))
      : new Response(csv);
  };
  let requestCount = 0;
  let currentTime = new Date("2026-11-06T00:00:00.000Z");
  const service = createDashboardService({
    owner: "owner",
    repo: "private-data",
    token: "test-token",
    cacheTtlMs: 60_000,
    refreshCooldownMs: 60_000,
    fetchImpl,
    now: () => currentTime,
  });

  const first = await service.forceRefresh();
  assert.equal(first.datasets.length, 2);
  assert.equal(first.datasets[0].rows[0].at(-1), "1");
  currentTime = new Date(currentTime.valueOf() + 60_000);
  failRefresh = true;
  const retained = await service.forceRefresh();
  assert.equal(retained.lastSyncedAt, first.lastSyncedAt);
  assert.match(retained.warning, /last successful synchronization/);
  assert.equal(JSON.stringify(retained).includes("test-token"), false);
  const callsAfterFailedRefresh = requestCount;
  const limited = await service.forceRefresh();
  assert.match(limited.warning, /rate-limited/);
  assert.equal(requestCount, callsAfterFailedRefresh);

  currentTime = new Date(currentTime.valueOf() + 60_000);
  failRefresh = false;
  assert.equal((await service.forceRefresh()).warning, "");
});

test("persists the successful cache for reuse by a cold serverless instance", async () => {
  let savedCache = null;
  let requestCount = 0;
  const cacheStore = {
    read: async () => savedCache,
    write: async (value) => { savedCache = value; },
  };
  const fetchImpl = async (url) => {
    requestCount += 1;
    if (String(url).endsWith("/releases/latest")) {
      return Response.json({
        assets: [{ name: "merged.csv.gz", id: 1 }, { name: "palm_trees.csv", id: 2 }],
      });
    }
    const csv = `District,Seedlings\n${String(url).endsWith("/1") ? "Chennai" : "Madurai"},12\n`;
    return String(url).endsWith("/1")
      ? new Response(gzipSync(csv))
      : new Response(csv);
  };
  const options = {
    owner: "owner",
    repo: "private-data",
    token: "test-token",
    cacheStore,
    cacheTtlMs: 300_000,
    fetchImpl,
    now: () => new Date("2026-11-10T00:00:00.000Z"),
  };

  const firstInstance = createDashboardService(options);
  await firstInstance.loadCache();
  const refreshed = await firstInstance.forceRefresh();
  assert.equal(savedCache.lastSyncedAt, refreshed.lastSyncedAt);
  assert.equal(requestCount, 3);

  const coldInstance = createDashboardService({
    ...options,
    fetchImpl: async () => {
      throw new Error("A fresh serverless instance should use persistent cache.");
    },
  });
  await coldInstance.loadCache();
  const restored = await coldInstance.getDashboardData();
  assert.equal(restored.lastSyncedAt, refreshed.lastSyncedAt);
  assert.equal(restored.datasets.length, 2);
  assert.equal(requestCount, 3);
});

test("missing required release assets fail without returning source data", async () => {
  const fetchImpl = async () => Response.json({
    assets: [{ name: "merged.csv.gz", id: 1 }],
  });
  await assert.rejects(
    fetchLatestRelease({
      owner: "owner",
      repo: "private-data",
      token: "test-token",
      fetchImpl,
    }),
    /missing the required palm CSV asset/,
  );
});

test("streaming aggregation rejects malformed rows and strips private columns", async () => {
  const csv = Readable.from([
    "District,Seedlings,Farmer Name,Date\n",
    "Chennai,10,Private Name,2026-11-06T10:11:12\n",
    "Chennai,20,Other Name,2026-11-06\n",
  ]);
  const result = await aggregateCsvStream(csv, "merge");
  assert.deepEqual(result.headers, ["District", "Date", "Seedlings", "Record Count"]);
  assert.deepEqual(result.rows, [["Chennai", "2026-11-06", "30", "2"]]);
  assert.equal(JSON.stringify(result).includes("Private Name"), false);

  await assert.rejects(
    aggregateCsvStream(Readable.from(["District,Seedlings\nChennai,10,extra\n"]), "merge"),
    /invalid number of columns/,
  );
});

test("API exposes only aggregate payloads and permits only configured browser origins", async (t) => {
  const dashboardService = {
    getStatus: () => ({ status: "ok", configured: true, hasCachedData: true, lastSyncedAt: null }),
    getDashboardData: async () => ({
      datasets: [{ source: "merge", headers: ["District", "Seedlings", "Record Count"], rows: [["Chennai", "10", "2"]] }],
      lastSyncedAt: "2026-11-06T00:00:00.000Z",
      warning: "",
    }),
    forceRefresh: async () => ({ datasets: [], lastSyncedAt: null, warning: "" }),
  };
  const app = createApp({ dashboardService, allowedOrigins: ["https://dashboard.example"], auth: testAuth() });
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await loginToken(baseUrl, "admin", "admin-pass-123");

  const allowedResponse = await fetch(`${baseUrl}/api/dashboard-data`, {
    headers: { Origin: "https://dashboard.example", Authorization: `Bearer ${token}` },
  });
  const payload = await allowedResponse.json();
  assert.equal(allowedResponse.headers.get("access-control-allow-origin"), "https://dashboard.example");
  assert.deepEqual(payload.datasets[0].rows, [["Chennai", "10", "2"]]);

  const deniedResponse = await fetch(`${baseUrl}/api/dashboard-data`, {
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(deniedResponse.headers.get("access-control-allow-origin"), null);
});

test("compresses large API responses to fit serverless response limits", async (t) => {
  const rows = Array.from({ length: 10_000 }, (_, index) => [
    `Tamil Nadu District ${index % 38}`,
    "2026-2027",
    "Forest Department",
    String(index),
    "1",
  ]);
  const dashboardService = {
    getStatus: () => ({ status: "ok", configured: true, hasCachedData: true, lastSyncedAt: null }),
    getDashboardData: async () => ({
      datasets: [{
        source: "merge",
        headers: ["District", "Year", "Department", "Seedlings", "Record Count"],
        rows,
      }, {
        source: "palm",
        headers: ["District", "Year", "Department", "Seedlings", "Record Count"],
        rows: [],
      }],
      lastSyncedAt: "2026-11-10T00:00:00.000Z",
      warning: "",
    }),
    forceRefresh: async () => ({ datasets: [], warning: "" }),
  };
  const app = createApp({ dashboardService, allowedOrigins: ["https://dashboard.example"], auth: testAuth() });
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, "listening");
  const token = await loginToken(`http://127.0.0.1:${server.address().port}`, "admin", "admin-pass-123");
  const response = await new Promise((resolve, reject) => {
    const request = get({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/dashboard-data",
      headers: { "Accept-Encoding": "gzip", Authorization: `Bearer ${token}` },
    }, resolve);
    request.on("error", reject);
  });
  const compressedBytes = await new Promise((resolve, reject) => {
    let bytes = 0;
    response.on("data", (chunk) => { bytes += chunk.length; });
    response.on("error", reject);
    response.on("end", () => resolve(bytes));
  });

  assert.equal(response.headers["content-encoding"], "gzip");
  assert.ok(compressedBytes < 4.5 * 1024 * 1024);
});

test("Vercel handler serves health from a private persistent cache configuration", async (t) => {
  const handler = createVercelHandler({
    env: {
      GITHUB_OWNER: "owner",
      GITHUB_REPO: "private-data",
      GITHUB_TOKEN: "server-only-token",
      CORS_ORIGINS: "https://dashboard.example",
    },
    cacheStore: { read: async () => null, write: async () => {} },
  });
  const server = createServer(handler);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0);
  await once(server, "listening");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.configured, true);
  assert.equal(payload.hasCachedData, false);
  assert.equal(JSON.stringify(payload).includes("server-only-token"), false);
  assert.throws(
    () => createVercelHandler({ env: {}, cacheStore: { read: async () => null } }),
    /Missing required backend environment variables/,
  );
});

test("invalid GitHub credentials and insufficient permissions produce clear non-secret errors", async () => {
  for (const [status, headers, expected] of [
    [401, {}, /invalid or expired/],
    [403, {}, /does not have permission/],
    [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793923200" }, /rate limit reached/],
  ]) {
    await assert.rejects(
      fetchLatestRelease({
        owner: "owner",
        repo: "private-data",
        token: "never-return-this-token",
        fetchImpl: async () => new Response("", { status, headers }),
      }),
      (error) => {
        assert.match(error.message, expected);
        assert.equal(error.message.includes("never-return-this-token"), false);
        return true;
      },
    );
  }
});

function departmentFixture() {
  return {
    datasets: [{
      source: "merge",
      headers: ["District", "Gov Department Type", "Seedlings", "Record Count"],
      rows: [
        ["Chennai", "Police", "10", "1"],
        ["Madurai", "POLICE", "5", "1"],
        ["Salem", "Rural Development and Panchayat Raj", "20", "2"],
        ["Erode", "", "7", "1"],
      ],
    }, {
      source: "palm",
      headers: ["District", "Seedlings", "Record Count"],
      rows: [["Chennai", "3", "1"]],
    }],
    lastSyncedAt: "2026-11-10T00:00:00.000Z",
    warning: "",
  };
}

test("department logins see only their own government department rows", async (t) => {
  const dashboardService = {
    getStatus: () => ({ status: "ok", configured: true, hasCachedData: true, lastSyncedAt: null }),
    getDashboardData: async () => departmentFixture(),
    forceRefresh: async () => departmentFixture(),
  };
  const app = createApp({ dashboardService, allowedOrigins: [], auth: testAuth() });
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const anonymous = await fetch(`${baseUrl}/api/dashboard-data`);
  assert.equal(anonymous.status, 401);
  const forged = await fetch(`${baseUrl}/api/dashboard-data`, { headers: { Authorization: "Bearer abc.def" } });
  assert.equal(forged.status, 401);

  const token = await loginToken(baseUrl, "POLICE", "dept-pass-123");
  for (const request of [
    fetch(`${baseUrl}/api/dashboard-data`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${baseUrl}/api/refresh`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
  ]) {
    const payload = await (await request).json();
    assert.deepEqual(payload.datasets[0].rows.map((row) => row[0]), ["Chennai", "Madurai"]);
    assert.deepEqual(payload.datasets[1].rows, []);
  }

  const adminToken = await loginToken(baseUrl, "admin", "admin-pass-123");
  const adminPayload = await (await fetch(`${baseUrl}/api/dashboard-data`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })).json();
  assert.equal(adminPayload.datasets[0].rows.length, 4);
  assert.equal(adminPayload.datasets[1].rows.length, 1);

  for (const [username, password] of [
    ["POLICE", "admin-pass-123"],
    ["admin", "dept-pass-123"],
    ["UNKNOWN DEPARTMENT", "dept-pass-123"],
    ["", "dept-pass-123"],
  ]) {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 401, username);
  }
});

test("auth tokens expire, reject tampering, and per-department passwords override the shared one", async () => {
  let clock = 1_000;
  const auth = createAuth({
    env: { ...TEST_AUTH_ENV, DEPARTMENT_PASSWORDS: JSON.stringify({ police: "police-only" }) },
    now: () => clock,
  });
  const departments = async () => listDepartments(departmentFixture());
  assert.deepEqual(await departments(), ["POLICE", "RURAL DEVELOPMENT AND PANCHAYAT RAJ"]);

  assert.equal((await auth.login({ username: "POLICE", password: "dept-pass-123" }, departments)).status, 401);
  const police = await auth.login({ username: "police", password: "police-only" }, departments);
  assert.equal(police.department, "POLICE");
  const [body, signature] = police.token.split(".");
  const tamperedBody = Buffer.from(JSON.stringify({ role: "admin", exp: clock + 1e9 })).toString("base64url");
  assert.equal(auth.verifyToken(`${tamperedBody}.${signature}`), null);
  assert.equal(auth.verifyToken(`${body}.${signature}`).department, "POLICE");
  clock += 13 * 60 * 60 * 1000;
  assert.equal(auth.verifyToken(police.token), null);

  const filtered = payloadForSession(departmentFixture(), { role: "department", department: "RURAL DEVELOPMENT AND PANCHAYAT RAJ" });
  assert.deepEqual(filtered.datasets[0].rows.map((row) => row[0]), ["Salem"]);
});

test("login fails closed when not configured and rate-limits repeated failures", async () => {
  const unconfigured = createAuth({ env: {} });
  assert.equal((await unconfigured.login({ username: "admin", password: "x" }, async () => [])).status, 503);
  assert.equal(unconfigured.verifyToken("a.b"), null);

  const auth = testAuth();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await auth.login({ username: "admin", password: "wrong", clientKey: "ip" }, async () => [])).status, 401);
  }
  assert.equal((await auth.login({ username: "admin", password: "admin-pass-123", clientKey: "ip" }, async () => [])).status, 429);
});

test("Vercel handler survives a failed cache read and retries it on the next request", async (t) => {
  let reads = 0;
  const handler = createVercelHandler({
    env: { GITHUB_OWNER: "owner", GITHUB_REPO: "private-data", GITHUB_TOKEN: "token" },
    cacheStore: {
      read: async () => {
        reads += 1;
        if (reads === 1) throw new Error("fetch failed");
        return null;
      },
      write: async () => {},
    },
  });
  const server = createServer(handler);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0);
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/health`;
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url)).status, 200);
  assert.equal(reads, 2);
});

const MAP_CSV = [
  "District,Year,Department,Gov Department Type,Seedlings,Latitude,Longitude,Farmer Name,Mobile",
  "Chennai,2026-2027,Other Department,Police,10,13.08271,80.27071,A Person,9999999999",
  "Chennai,2026-2027,Other Department,Police,5,13.08269,80.27069,B Person,8888888888",
  "Madurai,2026-2027,Forest Department,,7,9.9252,78.1198,C Person,7777777777",
  "Salem,2026-2027,Other Department,Rural Development and Panchayat Raj,4,11.6643,78.1460,D Person,6666666666",
  "Erode,2026-2027,Other Department,Police,3,0,0,E Person,5555555555",
  "Erode,2026-2027,Other Department,Police,2,,,F Person,4444444444",
].join("\n");

test("map points round to ~11 m, merge the same spot, drop bad GPS and keep no private columns", () => {
  const result = aggregateCsv(MAP_CSV, "merge");
  const { points } = result;
  assert.equal(points.scale, 10000);
  assert.deepEqual(points.fields, ["Year", "District", "Department", "Gov Department Type"]);
  assert.equal(points.lat.length, 3);
  assert.equal(points.excluded, 1);
  const chennai = points.lat.indexOf(130827);
  assert.equal(points.lon[chennai], 802707);
  assert.equal(points.seedlings[chennai], 15);
  assert.equal(points.records[chennai], 2);
  assert.equal(points.codes.length, points.lat.length * points.fields.length);
  for (const secret of ["A Person", "9999999999", "Farmer Name", "Mobile"]) {
    assert.equal(JSON.stringify(result).includes(secret), false, secret);
  }
  assert.equal(aggregateCsv("District,Seedlings\nChennai,1", "merge").points, undefined);
});

test("map points are served separately and departments only get their own locations", async (t) => {
  const payload = {
    datasets: [aggregateCsv(MAP_CSV, "merge"), aggregateCsv("District,Seedlings,Latitude,Longitude\nChennai,3,13.1,80.2", "palm")],
    lastSyncedAt: "2026-11-10T00:00:00.000Z",
    warning: "",
  };
  assert.equal(payloadForSession(payload, { role: "admin" }).datasets.some((dataset) => dataset.points), false);
  assert.equal(payloadForSession(payload, { role: "department", department: "POLICE" }).datasets.some((dataset) => dataset.points), false);

  const police = mapPointsForSession(payload, { role: "department", department: "POLICE" });
  const policePoints = police.datasets[0].points;
  assert.equal(policePoints.lat.length, 1);
  assert.equal(policePoints.seedlings[0], 15);
  assert.equal(police.datasets[1].points.lat.length, 0);
  assert.equal(mapPointsForSession(payload, { role: "admin" }).datasets[0].points.lat.length, 3);
  assert.equal(mapPointsForSession({ datasets: [{ source: "merge" }] }, { role: "admin" }).datasets[0].points, null);

  const dashboardService = {
    getStatus: () => ({}),
    getDashboardData: async () => payload,
    forceRefresh: async () => payload,
  };
  const app = createApp({ dashboardService, allowedOrigins: [], auth: testAuth() });
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${baseUrl}/api/map-points`)).status, 401);
  const token = await loginToken(baseUrl, "police", "dept-pass-123");
  const response = await (await fetch(`${baseUrl}/api/map-points`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(response.datasets[0].points.lat.length, 1);
  assert.equal(response.datasets[1].points.lat.length, 0);
});
