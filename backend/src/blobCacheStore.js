import { get, put } from "@vercel/blob";

const CACHE_PATH = "dashboard/aggregates-v1.json";

export function createBlobCacheStore() {
  return {
    async read() {
      const blob = await get(CACHE_PATH, {
        access: "private",
        useCache: false,
      });
      if (!blob) return null;
      if (blob.statusCode !== 200 || !blob.stream) {
        throw new Error(`Unable to read the Vercel Blob cache (HTTP ${blob.statusCode}).`);
      }
      return JSON.parse(await new Response(blob.stream).text());
    },
    async write(value) {
      await put(CACHE_PATH, JSON.stringify(value), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
    },
  };
}
