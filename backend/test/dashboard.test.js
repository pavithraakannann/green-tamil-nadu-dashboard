import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createDashboardService } from "../src/dashboardService.js";
import { aggregateCsv, aggregateCsvStream } from "../src/csvService.js";
import { fetchLatestRelease, fetchReleaseAssetStream } from "../src/githubService.js";
import { createVercelHandler } from "../src/vercelHandler.js";
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
  const app = createApp({ dashboardService, allowedOrigins: ["https://dashboard.example"] });
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const allowedResponse = await fetch(`${baseUrl}/api/dashboard-data`, {
    headers: { Origin: "https://dashboard.example" },
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
  const app = createApp({ dashboardService, allowedOrigins: ["https://dashboard.example"] });
  const server = app.listen(0);
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, "listening");
  const response = await new Promise((resolve, reject) => {
    const request = get({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/dashboard-data",
      headers: { "Accept-Encoding": "gzip" },
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
