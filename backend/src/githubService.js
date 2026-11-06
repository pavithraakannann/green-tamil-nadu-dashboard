const API_BASE_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";
const REQUEST_TIMEOUT_MS = 30_000;

function githubHeaders(token, accept) {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "green-tamil-nadu-dashboard",
  };
}

async function githubError(response, action) {
  if (response.status === 401) {
    return new Error("The GitHub token is invalid or expired.");
  }
  if (response.status === 403) {
    if (
      response.headers.get("x-ratelimit-remaining") === "0"
      || response.headers.get("retry-after")
    ) {
      const reset = response.headers.get("x-ratelimit-reset");
      const retryAfter = response.headers.get("retry-after");
      const resetTime = retryAfter
        ? `after ${retryAfter} seconds`
        : reset ? `at ${new Date(Number(reset) * 1000).toLocaleString()}` : "later";
      return new Error(`GitHub API rate limit reached. Try again ${resetTime}.`);
    }
    return new Error("The GitHub token does not have permission to read the configured repository.");
  }
  if (response.status === 404) {
    return new Error("No published release was found, or the configured repository is not accessible to this token.");
  }
  if (response.status === 429) {
    return new Error("GitHub API rate limit reached. Try again later.");
  }
  return new Error(`GitHub ${action} failed with HTTP ${response.status}.`);
}

async function request(fetchImpl, url, headers, action) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new Error(`GitHub ${action} timed out.`);
    }
    throw new Error(`Network error while contacting GitHub for ${action}: ${error.message}`);
  }

  if (!response.ok) throw await githubError(response, action);
  return response;
}

export async function fetchLatestRelease({
  owner,
  repo,
  token,
  fetchImpl = fetch,
}) {
  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const releaseResponse = await request(
    fetchImpl,
    `${API_BASE_URL}${repositoryPath}/releases/latest`,
    githubHeaders(token, "application/vnd.github+json"),
    "latest release lookup",
  );
  const release = await releaseResponse.json();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const assetAliases = {
    merge: ["merge.csv", "merged.csv.gz"],
    palm: ["palm.csv", "palm_trees.csv"],
  };
  const selectedAssets = Object.fromEntries(Object.entries(assetAliases).map(([source, names]) => {
    const asset = assets.find((candidate) => names.includes(candidate.name));
    if (!asset || !Number.isSafeInteger(asset.id)) {
      throw new Error(`The latest release is missing the required ${source} CSV asset (expected one of: ${names.join(", ")}).`);
    }
    return [source, { id: asset.id, name: asset.name }];
  }));

  return {
    releasePublishedAt: release.published_at ?? null,
    assets: selectedAssets,
  };
}

export async function fetchReleaseAssetStream({
  owner,
  repo,
  token,
  assetId,
  assetFileName,
  name,
  fetchImpl = fetch,
}) {
  const repositoryPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const response = await request(
    fetchImpl,
    `${API_BASE_URL}${repositoryPath}/releases/assets/${assetId}`,
    githubHeaders(token, "application/octet-stream"),
    `${name} asset download`,
  );
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 300 * 1024 * 1024) {
    throw new Error(`${name} exceeds the 300 MB download limit.`);
  }
  if (!response.body) throw new Error(`GitHub returned an empty ${name} asset.`);
  return {
    body: response.body,
    compressed: assetFileName.toLocaleLowerCase().endsWith(".gz"),
  };
}
