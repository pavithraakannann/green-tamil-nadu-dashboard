const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

export class UnauthorizedError extends Error {}

export async function login(username, password) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
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
  if (!response.ok || typeof payload.token !== "string") {
    throw new Error(payload.error || `Login failed (HTTP ${response.status}).`);
  }
  return { token: payload.token, role: payload.role, department: payload.department ?? null };
}

async function fetchDashboardPayload(forceRefresh, token) {
  const endpoint = forceRefresh ? "/api/refresh" : "/api/dashboard-data";
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: forceRefresh ? "POST" : "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
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
  if (response.status === 401) {
    throw new UnauthorizedError(payload.error || "Your session has expired. Please log in again.");
  }
  if (!response.ok) {
    const apiError = typeof payload.error === "string"
      ? payload.error
      : payload.error ? JSON.stringify(payload.error) : "";
    throw new Error(apiError || `The dashboard API returned HTTP ${response.status}.`);
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

export async function refreshDashboardData(onProgress, { forceRefresh = false, token = "" } = {}) {
  const payload = await fetchDashboardPayload(forceRefresh, token);
  for (const dataset of payload.datasets) {
    onProgress?.({ source: dataset.source, rows: dataset.rows.length });
  }
  return payload;
}
