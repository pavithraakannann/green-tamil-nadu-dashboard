const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

async function fetchDashboardPayload(forceRefresh) {
  const endpoint = forceRefresh ? "/api/refresh" : "/api/dashboard-data";
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: forceRefresh ? "POST" : "GET",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new Error(`Unable to connect to the dashboard API: ${error.message}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`The dashboard API returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(payload.error || `The dashboard API returned HTTP ${response.status}.`);
  }
  if (!Array.isArray(payload.datasets) || payload.datasets.length !== 2) {
    throw new Error("The dashboard API did not return both aggregated datasets.");
  }

  const datasets = payload.datasets.map((dataset) => {
    if (
      !["merge", "palm"].includes(dataset.source)
      || !Array.isArray(dataset.headers)
      || !Array.isArray(dataset.rows)
      || dataset.rows.some((row) => !Array.isArray(row) || row.length !== dataset.headers.length)
    ) {
      throw new Error("The dashboard API returned an invalid aggregated dataset.");
    }
    return dataset;
  });

  return {
    datasets,
    lastSyncedAt: payload.lastSyncedAt,
    sourceUpdatedAt: payload.sourceUpdatedAt,
    warning: typeof payload.warning === "string" ? payload.warning : "",
  };
}

export async function refreshDashboardData(onProgress, { forceRefresh = false } = {}) {
  const payload = await fetchDashboardPayload(forceRefresh);
  for (const dataset of payload.datasets) {
    onProgress?.({ source: dataset.source, rows: dataset.rows.length });
  }
  return payload;
}
