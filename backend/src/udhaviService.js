import { districtKey } from "./districtNames.js";

export const DEFAULT_UDHAVI_URL = "https://panaireport.vercel.app/api/overview";

/** Keeps only what the dashboard needs: palm seeds per district from the Udhavi overview API. */
export function parseUdhaviOverview(payload) {
  if (!payload || !Array.isArray(payload.byDistrict)) {
    throw new Error("The Udhavi API returned an unexpected response.");
  }
  const districts = payload.byDistrict
    .filter((entry) => entry && typeof entry.district === "string" && Number.isFinite(Number(entry.seeds)))
    .map((entry) => ({ district: entry.district.trim(), key: districtKey(entry.district), seeds: Number(entry.seeds) }));
  return {
    generatedAt: typeof payload.generatedAt === "string" ? payload.generatedAt : null,
    year: payload.year ?? null,
    totalSeeds: districts.reduce((total, entry) => total + entry.seeds, 0),
    districts,
  };
}

/**
 * Fetches Udhavi district totals, cached for `ttlMs` so normal page loads don't call the API every
 * time. A dashboard refresh passes force=true to always get the latest numbers.
 */
export function createUdhaviService({
  url = process.env.UDHAVI_API_URL || DEFAULT_UDHAVI_URL,
  fetchImpl = fetch,
  ttlMs = 10 * 60 * 1000,
  timeoutMs = 20_000,
  now = () => Date.now(),
} = {}) {
  let cached = null;
  let pending = null;

  async function load() {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`The Udhavi API returned HTTP ${response.status}.`);
    const data = parseUdhaviOverview(await response.json());
    cached = { data, fetchedAt: now() };
    return data;
  }

  return {
    async get({ force = false } = {}) {
      if (!force && cached && now() - cached.fetchedAt < ttlMs) return cached.data;
      pending ??= load().finally(() => { pending = null; });
      try {
        return await pending;
      } catch (error) {
        // Keep showing the last good numbers if the Udhavi API is briefly down.
        if (cached) return cached.data;
        throw error;
      }
    },
  };
}
