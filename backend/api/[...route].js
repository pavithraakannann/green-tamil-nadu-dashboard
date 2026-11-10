import { createBlobCacheStore } from "../src/blobCacheStore.js";
import { createVercelHandler } from "../src/vercelHandler.js";

export default createVercelHandler({ cacheStore: createBlobCacheStore() });
