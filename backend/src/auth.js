import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 10;
const GOV_DEPARTMENT_FIELD = "Gov Department Type";

export function normalizeDepartment(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase("en");
}

function safeEqual(first, second) {
  const a = Buffer.from(String(first ?? ""), "utf8");
  const b = Buffer.from(String(second ?? ""), "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

/** Government department login IDs (department names in capitals) present in the data. */
export function listDepartments(payload) {
  const departments = new Set();
  for (const dataset of payload?.datasets ?? []) {
    if (dataset.source === "palm") continue;
    const index = dataset.headers.indexOf(GOV_DEPARTMENT_FIELD);
    if (index < 0) continue;
    for (const row of dataset.rows) {
      const department = normalizeDepartment(row[index]);
      if (department) departments.add(department);
    }
  }
  return [...departments].sort((a, b) => a.localeCompare(b));
}

/**
 * Returns a copy of the dashboard payload that only contains the session's permitted rows.
 * Map points are left out here; they are served separately by mapPointsForSession.
 */
export function payloadForSession(payload, session) {
  const datasets = payload.datasets.map(({ points: _points, ...dataset }) => dataset);
  if (session.role === "admin") return { ...payload, datasets };
  return {
    ...payload,
    datasets: datasets.map((dataset) => {
      const index = dataset.headers.indexOf(GOV_DEPARTMENT_FIELD);
      if (dataset.source === "palm" || index < 0) return { ...dataset, rows: [] };
      return {
        ...dataset,
        rows: dataset.rows.filter((row) => normalizeDepartment(row[index]) === session.department),
      };
    }),
  };
}

function filterPoints(points, keep) {
  const width = points.fields.length;
  const result = { ...points, lat: [], lon: [], seedlings: [], records: [], codes: [] };
  for (let index = 0; index < points.lat.length; index += 1) {
    const codes = points.codes.slice(index * width, index * width + width);
    if (!keep(codes)) continue;
    result.lat.push(points.lat[index]);
    result.lon.push(points.lon[index]);
    result.seedlings.push(points.seedlings[index]);
    result.records.push(points.records[index]);
    result.codes.push(...codes);
  }
  return result;
}

/**
 * Map points the session may see: everything for admin, and for a department only its own
 * merge points (never palm). `points` is null when the cache predates map support.
 */
export function mapPointsForSession(payload, session) {
  const datasets = payload.datasets.map((dataset) => {
    const points = dataset.points ?? null;
    if (session.role === "admin" || !points) return { source: dataset.source, points };
    const fieldIndex = points.fields.indexOf(GOV_DEPARTMENT_FIELD);
    if (dataset.source === "palm" || fieldIndex < 0) return { source: dataset.source, points: filterPoints(points, () => false) };
    const allowed = new Set(points.values[fieldIndex]
      .map((value, code) => (normalizeDepartment(value) === session.department ? code : -1))
      .filter((code) => code >= 0));
    return { source: dataset.source, points: filterPoints(points, (codes) => allowed.has(codes[fieldIndex])) };
  });
  return { lastSyncedAt: payload.lastSyncedAt ?? null, datasets };
}

function parseDepartmentPasswords(value) {
  if (!value?.trim()) return new Map();
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("DEPARTMENT_PASSWORDS must be a JSON object of { \"DEPARTMENT NAME\": \"password\" }.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DEPARTMENT_PASSWORDS must be a JSON object of { \"DEPARTMENT NAME\": \"password\" }.");
  }
  return new Map(Object.entries(parsed).map(([name, password]) => [normalizeDepartment(name), String(password)]));
}

export function createAuth({ env = process.env, now = () => Date.now() } = {}) {
  const secret = env.AUTH_SECRET?.trim() ?? "";
  const adminUsername = (env.ADMIN_USERNAME?.trim() || "admin").toLocaleLowerCase("en");
  const adminPassword = env.ADMIN_PASSWORD ?? "";
  const departmentPassword = env.DEPARTMENT_PASSWORD ?? "";
  const departmentPasswords = parseDepartmentPasswords(env.DEPARTMENT_PASSWORDS);
  const configured = secret.length >= 32 && adminPassword.length >= 8;
  const failedLogins = new Map();

  function sign(body) {
    return createHmac("sha256", secret).update(body).digest("base64url");
  }

  function issueToken(session) {
    const body = base64url(JSON.stringify({ ...session, exp: now() + TOKEN_TTL_MS }));
    return `${body}.${sign(body)}`;
  }

  function verifyToken(token) {
    if (!configured || typeof token !== "string") return null;
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra !== undefined || !safeEqual(signature, sign(body))) return null;
    try {
      const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (typeof session.exp !== "number" || session.exp <= now()) return null;
      if (session.role === "admin") return { role: "admin", department: null, exp: session.exp };
      if (session.role === "department" && typeof session.department === "string" && session.department) {
        return { role: "department", department: session.department, exp: session.exp };
      }
    } catch {
      return null;
    }
    return null;
  }

  function isRateLimited(key) {
    const entry = failedLogins.get(key);
    if (!entry || now() - entry.firstAt > LOGIN_WINDOW_MS) {
      failedLogins.delete(key);
      return false;
    }
    return entry.count >= MAX_FAILED_LOGINS;
  }

  function recordFailure(key) {
    const entry = failedLogins.get(key);
    if (!entry || now() - entry.firstAt > LOGIN_WINDOW_MS) failedLogins.set(key, { count: 1, firstAt: now() });
    else entry.count += 1;
  }

  /**
   * Checks credentials. `getDepartments` lazily loads valid department IDs from the data,
   * so department logins only exist for departments present in the dashboard data.
   */
  async function login({ username, password, clientKey = "unknown" }, getDepartments) {
    if (!configured) return { error: "Login is not configured on the server.", status: 503 };
    if (isRateLimited(clientKey)) {
      return { error: "Too many failed login attempts. Try again in 15 minutes.", status: 429 };
    }
    const loginId = normalizeDepartment(username);
    const fail = () => {
      recordFailure(clientKey);
      return { error: "Invalid login ID or password.", status: 401 };
    };
    if (!loginId || typeof password !== "string" || !password) return fail();

    if (loginId.toLocaleLowerCase("en") === adminUsername) {
      if (!safeEqual(password, adminPassword)) return fail();
      failedLogins.delete(clientKey);
      const session = { role: "admin", department: null };
      return { token: issueToken(session), ...session };
    }

    const expectedPassword = departmentPasswords.get(loginId) ?? departmentPassword;
    if (!expectedPassword || !safeEqual(password, expectedPassword)) return fail();
    const departments = await getDepartments();
    if (!departments.includes(loginId)) return fail();
    failedLogins.delete(clientKey);
    const session = { role: "department", department: loginId };
    return { token: issueToken(session), ...session };
  }

  return { configured, login, verifyToken };
}
