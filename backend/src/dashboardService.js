import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { aggregateCsvStream } from "./csvService.js";
import { fetchLatestRelease, fetchReleaseAssetStream } from "./githubService.js";

export function createDashboardService({
  owner,
  repo,
  token,
  cacheFile,
  cacheTtlMs,
  refreshCooldownMs = 60_000,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  let cache = null;
  let refreshPromise = null;
  let lastRefreshAttemptAt = null;

  async function loadCache() {
    if (!cacheFile) return;
    try {
      const saved = JSON.parse(await readFile(cacheFile, "utf8"));
      if (saved?.datasets?.length === 2 && saved.lastSyncedAt) cache = saved;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error(`Unable to load cached dashboard data: ${error.message}`);
      }
    }
  }

  async function persistCache(nextCache) {
    if (!cacheFile) return;
    await mkdir(dirname(cacheFile), { recursive: true });
    const temporaryFile = `${cacheFile}.tmp`;
    await writeFile(temporaryFile, JSON.stringify(nextCache), { mode: 0o600 });
    await rename(temporaryFile, cacheFile);
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    lastRefreshAttemptAt = now().valueOf();
    refreshPromise = (async () => {
      const { assets, releasePublishedAt, sourceUpdatedAt } = await fetchLatestRelease({
        owner,
        repo,
        token,
        fetchImpl,
      });
      const datasets = [];
      for (const source of ["merge", "palm"]) {
        const asset = assets[source];
        const downloaded = await fetchReleaseAssetStream({
          owner,
          repo,
          token,
          assetId: asset.id,
          assetFileName: asset.name,
          name: `${source}.csv`,
          fetchImpl,
        });
        const stream = Readable.fromWeb(downloaded.body);
        const csvStream = downloaded.compressed ? stream.pipe(createGunzip()) : stream;
        datasets.push(await aggregateCsvStream(csvStream, source));
      }
      const nextCache = {
        datasets,
        lastSyncedAt: now().toISOString(),
        releasePublishedAt,
        sourceUpdatedAt,
      };
      await persistCache(nextCache);
      cache = nextCache;
      return nextCache;
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function getDashboardData() {
    const currentTime = now().valueOf();
    if (cache && currentTime - Date.parse(cache.lastSyncedAt) < cacheTtlMs) {
      return { ...cache, warning: "" };
    }
    if (cache && lastRefreshAttemptAt !== null && currentTime - lastRefreshAttemptAt < refreshCooldownMs) {
      return {
        ...cache,
        warning: "GitHub synchronization is temporarily cooling down; showing the last successful data.",
      };
    }
    try {
      return { ...await refresh(), warning: "" };
    } catch (error) {
      if (!cache) throw error;
      return {
        ...cache,
        warning: `Could not refresh data from GitHub; showing the last successful synchronization. ${error.message}`,
      };
    }
  }

  async function forceRefresh() {
    const currentTime = now().valueOf();
    if (cache && lastRefreshAttemptAt !== null && currentTime - lastRefreshAttemptAt < refreshCooldownMs) {
      return {
        ...cache,
        warning: "Refresh is temporarily rate-limited; showing the last successful data.",
      };
    }
    try {
      return { ...await refresh(), warning: "" };
    } catch (error) {
      if (!cache) throw error;
      return {
        ...cache,
        warning: `Refresh failed; showing the last successful synchronization. ${error.message}`,
      };
    }
  }

  return {
    loadCache,
    getDashboardData,
    forceRefresh,
    getStatus: () => ({
      status: "ok",
      configured: Boolean(owner && repo && token),
      hasCachedData: Boolean(cache),
      lastSyncedAt: cache?.lastSyncedAt ?? null,
    }),
  };
}
