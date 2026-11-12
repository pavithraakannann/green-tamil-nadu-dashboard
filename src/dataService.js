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
    // Vercel platform errors arrive as { error: { code, message } }, not a string.
    const apiError = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(apiError || `Login failed (HTTP ${response.status}). Please try again.`);
  }
  return { token: payload.token, role: payload.role, department: payload.department ?? null };
}

function decodePoints(source, points) {
  const valid = points
    && Array.isArray(points.fields)
    && Array.isArray(points.values)
    && Array.isArray(points.lat)
    && [points.lon, points.seedlings, points.records].every((list) => Array.isArray(list) && list.length === points.lat.length)
    && Array.isArray(points.codes)
    && points.codes.length === points.lat.length * points.fields.length;
  if (!valid) throw new Error("The dashboard API returned invalid map data.");
  const width = points.fields.length;
  const fieldIndex = (name) => points.fields.indexOf(name);
  const label = (index, offset) => (index < 0 ? "" : points.values[index][points.codes[offset + index]] ?? "");
  const [year, district, division, department, govDepartment, departmentType] = [
    "Year", "District", "Division", "Department", "Gov Department Type", "Department Type",
  ].map(fieldIndex);
  const decoded = new Array(points.lat.length);
  for (let index = 0; index < points.lat.length; index += 1) {
    const offset = index * width;
    decoded[index] = {
      source,
      lat: points.lat[index] / points.scale,
      lon: points.lon[index] / points.scale,
      seedlings: points.seedlings[index],
      records: points.records[index],
      year: label(year, offset),
      district: label(district, offset),
      division: label(division, offset),
      department: label(department, offset),
      govDepartment: label(govDepartment, offset),
      departmentType: label(departmentType, offset),
    };
  }
  return decoded;
}

/**
 * Loads GPS planting points for the map. Returns { points, available }, where available is
 * false when the server cache was built before map support (a data refresh fixes that).
 */
export async function fetchMapPoints(token) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/map-points`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new Error(`Unable to connect to the dashboard API: ${error.message}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`The map API returned an invalid response (HTTP ${response.status}).`);
  }
  if (response.status === 401) {
    throw new UnauthorizedError(payload.error || "Your session has expired. Please log in again.");
  }
  if (!response.ok || !Array.isArray(payload.datasets)) {
    const apiError = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(apiError || `The map API returned HTTP ${response.status}.`);
  }
  const available = payload.datasets.some((dataset) => dataset.points);
  const points = payload.datasets.flatMap((dataset) => (
    dataset.points ? decodePoints(dataset.source, dataset.points) : []
  ));
  return { points, available };
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
    targets: validTargets(payload.targets) ? payload.targets : null,
    palmTargets: validPalmTargets(payload.palmTargets) ? payload.palmTargets : null,
  };
}

function validTargets(targets) {
  return Boolean(targets)
    && typeof targets.year === "string"
    && Array.isArray(targets.groups)
    && Array.isArray(targets.districts)
    && targets.districts.every((entry) => entry && typeof entry.district === "string" && entry.targets && entry.achieved);
}

function validPalmTargets(targets) {
  return Boolean(targets)
    && typeof targets.year === "string"
    && Array.isArray(targets.districts)
    && targets.districts.every((entry) => entry && typeof entry.district === "string"
      && ["target", "forest", "departments"].every((field) => Number.isFinite(entry[field])));
}

export async function refreshDashboardData(onProgress, { forceRefresh = false, token = "" } = {}) {
  const payload = await fetchDashboardPayload(forceRefresh, token);
  for (const dataset of payload.datasets) {
    onProgress?.({ source: dataset.source, rows: dataset.rows.length });
  }
  return payload;
}
