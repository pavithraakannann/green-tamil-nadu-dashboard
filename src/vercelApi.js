import { createBlobCacheStore } from "../backend/src/blobCacheStore.js";
import { createVercelHandler } from "../backend/src/vercelHandler.js";

export const vercelApiHandler = createVercelHandler({
  cacheStore: createBlobCacheStore(),
});
