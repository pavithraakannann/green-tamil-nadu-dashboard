import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  BarChart3,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Download,
  FileBarChart,
  FilterX,
  Leaf,
  LoaderCircle,
  Lock,
  LogOut,
  MapPin,
  MapPinned,
  Menu,
  RefreshCw,
  Search,
  Sprout,
  Table2,
  Target,
  TreePine,
  Upload,
  X,
} from "lucide-react";
import Papa from "papaparse";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchMapPoints, login, refreshDashboardData, UnauthorizedError } from "./dataService.js";
import { MapLegend, MAP_CATEGORIES, mapCategory, PlantingMap } from "./PlantingMap.jsx";
import { circleForDivision } from "./divisionCircles.js";

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "planting-map", label: "Planting map", icon: MapPinned },
  { id: "merge", label: "Merge data", icon: Table2 },
  { id: "palm", label: "Palm data", icon: TreePine },
  { id: "gov-departments", label: "Govt departments", icon: Building2 },
  { id: "reports", label: "Reports", icon: FileBarChart },
];
const FILTER_FIELDS = ["District", "Circle", "Division", "Year", "Species", "Scheme"];
const FILTER_LABELS = {
  District: "districts",
  Circle: "circles",
  Division: "divisions",
  Year: "years",
  Species: "species",
  Scheme: "schemes",
};
const DEFAULT_FILTERS = {
  District: "all",
  Circle: "all",
  Division: "all",
  Year: "all",
  Species: "all",
  Scheme: "all",
};
const COLORS = ["#248451", "#69a879", "#d99545", "#5784a5", "#9d75b6", "#d16d52"];
const ROWS_PER_PAGE = 25;
const NUMERIC_COLUMNS = new Set(["Seedlings", "Number of Seedlings", "Record Count"]);
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DISTRICT_TARGETS_STORAGE_KEY = "green-tamil-nadu-district-targets-v2";
const LEGACY_DISTRICT_TARGETS_STORAGE_KEY = "green-tamil-nadu-district-targets-v1";
const SESSION_STORAGE_KEY = "green-tamil-nadu-session-v1";

const numberFormat = new Intl.NumberFormat("en-IN");
const compactFormat = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function indexOf(dataset, name) {
  return dataset?.headers.indexOf(name) ?? -1;
}

function valueAt(dataset, row, name) {
  const index = indexOf(dataset, name);
  if (index >= 0) return String(row[index] ?? "").trim();
  return name === "Circle" ? circleForDivision(valueAt(dataset, row, "Division")) : "";
}

function speciesAt(dataset, row) {
  return valueAt(dataset, row, "Species") || valueAt(dataset, row, "Species (English)");
}

function countAt(dataset, row) {
  const seedlings = valueAt(dataset, row, "Seedlings");
  const numberOfSeedlings = valueAt(dataset, row, "Number of Seedlings");
  const value = Number((seedlings || numberOfSeedlings).replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function recordCountAt(dataset, row) {
  const value = Number(valueAt(dataset, row, "Record Count"));
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function areaAt(dataset, row) {
  const area = valueAt(dataset, row, "Land parcel area") || valueAt(dataset, row, "Total Area");
  const value = Number(area.replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function filterValue(dataset, row, field) {
  return field === "Species" ? speciesAt(dataset, row) : valueAt(dataset, row, field);
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
});

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : DATE_TIME_FORMAT.format(date);
}

function formatNumber(value) {
  return numberFormat.format(value);
}

function currentReportingYear(date = new Date()) {
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDistrictName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function loadDistrictTargets(rows) {
  try {
    const saved = window.localStorage.getItem(DISTRICT_TARGETS_STORAGE_KEY);
    if (!saved) {
      const legacySaved = window.localStorage.getItem(LEGACY_DISTRICT_TARGETS_STORAGE_KEY);
      if (!legacySaved) return { targetsByYear: {}, error: "" };
      const legacyTargetsByYear = JSON.parse(legacySaved);
      if (
        !legacyTargetsByYear
        || typeof legacyTargetsByYear !== "object"
        || Array.isArray(legacyTargetsByYear)
      ) {
        throw new Error("Saved target data has an invalid format.");
      }

      const migratedTargetsByYear = {};
      for (const [year, yearTargets] of Object.entries(legacyTargetsByYear)) {
        if (!yearTargets || typeof yearTargets !== "object" || Array.isArray(yearTargets)) {
          throw new Error("Saved district targets have an invalid format.");
        }
        migratedTargetsByYear[year] = {};
        for (const [districtKey, target] of Object.entries(yearTargets)) {
          if (typeof target !== "number" || !Number.isFinite(target) || target < 0) {
            throw new Error("A saved district target is invalid.");
          }
          const matchingSource = rows.find(({ dataset, row }) => (
            normalizeDistrictName(valueAt(dataset, row, "District")) === districtKey
          ));
          migratedTargetsByYear[year][districtKey] = {
            district: matchingSource
              ? valueAt(matchingSource.dataset, matchingSource.row, "District")
              : districtKey,
            circle: matchingSource
              ? valueAt(matchingSource.dataset, matchingSource.row, "Circle") || "Others"
              : "Others",
            target,
          };
        }
      }
      window.localStorage.setItem(DISTRICT_TARGETS_STORAGE_KEY, JSON.stringify(migratedTargetsByYear));
      return { targetsByYear: migratedTargetsByYear, error: "" };
    }

    const targetsByYear = JSON.parse(saved);
    if (!targetsByYear || typeof targetsByYear !== "object" || Array.isArray(targetsByYear)) {
      throw new Error("Saved target data has an invalid format.");
    }
    for (const yearTargets of Object.values(targetsByYear)) {
      if (!yearTargets || typeof yearTargets !== "object" || Array.isArray(yearTargets)) {
        throw new Error("Saved district targets have an invalid format.");
      }
      for (const target of Object.values(yearTargets)) {
        if (
          !target
          || typeof target !== "object"
          || typeof target.district !== "string"
          || typeof target.circle !== "string"
          || typeof target.target !== "number"
          || !Number.isFinite(target.target)
          || target.target < 0
        ) {
          throw new Error("A saved district target is invalid.");
        }
      }
    }
    return { targetsByYear, error: "" };
  } catch (error) {
    return {
      targetsByYear: {},
      error: `Saved targets could not be loaded: ${error.message}`,
    };
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function datasetColumns(dataset) {
  if (indexOf(dataset, "Circle") >= 0) return dataset.headers;
  const divisionIndex = indexOf(dataset, "Division");
  if (divisionIndex < 0) return dataset.headers;
  return [
    ...dataset.headers.slice(0, divisionIndex + 1),
    "Circle",
    ...dataset.headers.slice(divisionIndex + 1),
  ];
}

function downloadCsv(dataset, rows, suffix = "filtered") {
  const headers = datasetColumns(dataset);
  const chunks = ["\uFEFF", `${headers.map(csvEscape).join(",")}\r\n`];
  for (let offset = 0; offset < rows.length; offset += 1000) {
    chunks.push(
      rows
        .slice(offset, offset + 1000)
        .map((row) => headers.map((header) => {
          const index = indexOf(dataset, header);
          return csvEscape(index >= 0 ? row[index] : valueAt(dataset, row, header));
        }).join(","))
        .join("\r\n") + "\r\n",
    );
  }
  const blob = new Blob(chunks, { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${dataset.source}-${suffix}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function matchesFilters(dataset, row, filters) {
  return FILTER_FIELDS.every((field) => {
    const selected = filters[field];
    return selected === "all" || filterValue(dataset, row, field) === selected;
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function summarize(datasetRows) {
  let records = 0;
  let seedlings = 0;
  let area = 0;
  const districts = new Set();
  const circles = new Set();
  const divisions = new Set();
  const species = new Set();
  const schemes = new Set();

  for (const { dataset, row } of datasetRows) {
    records += recordCountAt(dataset, row);
    seedlings += countAt(dataset, row);
    area += areaAt(dataset, row);
    for (const [set, field] of [
      [districts, "District"],
      [circles, "Circle"],
      [divisions, "Division"],
      [species, "Species"],
      [schemes, "Scheme"],
    ]) {
      const value = filterValue(dataset, row, field);
      if (value) set.add(value);
    }
  }

  return {
    records,
    seedlings,
    area,
    districts: districts.size,
    circles: circles.size,
    divisions: divisions.size,
    species: species.size,
    schemes: schemes.size,
  };
}

function groupData(datasetRows, field, metric) {
  const groups = new Map();
  for (const { dataset, row } of datasetRows) {
    const label = filterValue(dataset, row, field);
    if (!label) continue;
    const group = groups.get(label) ?? { name: label, records: 0, seedlings: 0 };
    group.records += recordCountAt(dataset, row);
    group.seedlings += countAt(dataset, row);
    groups.set(label, group);
  }

  return [...groups.values()]
    .sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name));
}

function tokenExpiry(token) {
  try {
    const body = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(body.padEnd(Math.ceil(body.length / 4) * 4, "=")));
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

function loadSession() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "null");
    if (
      saved
      && typeof saved.token === "string"
      && (saved.role === "admin" || (saved.role === "department" && typeof saved.department === "string"))
      && tokenExpiry(saved.token) > Date.now()
    ) return saved;
  } catch {
    // Ignore unreadable storage and show the login page.
  }
  return null;
}

function saveSession(session) {
  try {
    if (session) window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // The session still works for this page view without storage.
  }
}

function LoginPage({ onLogin, notice }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setLoginError("");
    try {
      onLogin(await login(username.trim(), password));
    } catch (submitError) {
      setLoginError(submitError.message || "Login failed.");
      setSubmitting(false);
    }
  }

  return (
    <main className="loading-screen">
      <div className="loading-mark"><Leaf size={27} /></div>
      <form className="loading-card login-card" onSubmit={handleSubmit}>
        <h1>Green Tamil Nadu Mission</h1>
        <p>Sign in to view the planting dashboard.</p>
        {notice && <div className="login-notice" role="status">{notice}</div>}
        <label className="login-field">
          <span>Login ID</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="admin or DEPARTMENT NAME"
            required
          />
        </label>
        <label className="login-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {loginError && <div className="login-error" role="alert">{loginError}</div>}
        <button className="button button-primary login-submit" type="submit" disabled={submitting}>
          {submitting ? <LoaderCircle className="spin" size={16} /> : <Lock size={16} />}
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <small>Government departments: your login ID is your department name in CAPITAL letters.</small>
      </form>
    </main>
  );
}

function LoadingScreen({ progress, error, onRetry }) {
  const totalRows = progress.merge + progress.palm;
  return (
    <main className="loading-screen">
      <div className="loading-mark"><Leaf size={27} /></div>
      {error ? (
        <div className="loading-card">
          <div className="error-icon"><X size={21} /></div>
          <h1>Data could not be loaded</h1>
          <p>{error}</p>
          <button className="button button-primary" onClick={onRetry}>
            <RefreshCw size={16} /> Try again
          </button>
          <small>Check that the dashboard API is deployed and its private GitHub credentials are configured.</small>
        </div>
      ) : (
        <div className="loading-card">
          <LoaderCircle className="spin loading-spinner" size={30} />
          <h1>Preparing your dashboard</h1>
          <p>Loading aggregated planting data from the dashboard API.</p>
          {totalRows > 0 && <span className="loading-count">{formatNumber(totalRows)} aggregate groups loaded</span>}
        </div>
      )}
    </main>
  );
}

function StatCard({ title, value, note, icon: Icon, tone = "green", onClick }) {
  return (
    <article
      className={`stat-card stat-tone-${tone} ${onClick ? "stat-card-clickable" : ""}`}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={`stat-icon ${tone}`}><Icon size={20} strokeWidth={1.8} /></div>
      <div className="stat-copy">
        <span className="stat-label">{title}</span>
        <strong>{value}</strong>
        <span className="stat-note">{note}</span>
      </div>
      {onClick && <ChevronRight className="stat-go" size={18} />}
    </article>
  );
}

function SectionHeading({ eyebrow, title, description, action }) {
  return (
    <div className="section-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function FilterBar({ options, filters, setFilters, onClear, compact = false }) {
  const filterControl = (field) => (
    <label className="select-wrap" key={field}>
      <span>{field}</span>
      <select
        value={filters[field]}
        onChange={(event) => setFilters((current) => ({ ...current, [field]: event.target.value }))}
      >
        <option value="all">All {FILTER_LABELS[field]}</option>
        {options[field].map((option) => <option value={option} key={option}>{option}</option>)}
      </select>
      <ChevronDown size={14} />
    </label>
  );

  return (
    <div className={`filter-bar ${compact ? "filter-bar-compact" : ""}`}>
      <div className="filter-main-row">
        <div className="filter-title"><span className="filter-dot" /> Filters</div>
        {FILTER_FIELDS.filter((field) => field !== "Year").map(filterControl)}
        <button className="clear-filter" onClick={onClear} title="Clear all filters">
          <FilterX size={15} /> <span>Clear</span>
        </button>
      </div>
      <div className="year-filter-row">
        <div className="year-filter-heading"><span className="filter-dot" /> Year filter</div>
        {filterControl("Year")}
        <span className="year-filter-help">Choose a planting year to filter all dashboard results.</span>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children, className = "" }) {
  return (
    <article className={`chart-card ${className}`}>
      <div className="chart-heading">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
      </div>
      {children}
    </article>
  );
}

function EmptyChart({ text = "No records match these filters." }) {
  return <div className="empty-chart"><Sprout size={24} /><span>{text}</span></div>;
}

function DivisionTooltip({ active, payload, onViewDetails }) {
  if (!active || !payload?.length) return null;
  const division = payload[0]?.payload?.name;
  if (!division) return null;

  return (
    <div className="division-tooltip">
      <strong>{division}</strong>
      <span>Records: {formatNumber(payload[0].value)}</span>
      <button className="button button-primary" onClick={() => onViewDetails(division)}>
        View details
      </button>
    </div>
  );
}

function DivisionDetails({ division, rows, onBack }) {
  const groups = useMemo(() => {
    const grouped = new Map();
    for (const { dataset, row } of rows) {
      const species = speciesAt(dataset, row) || "Not specified";
      const scheme = valueAt(dataset, row, "Scheme") || "Not specified";
      const key = `${species}\u0000${scheme}`;
      const group = grouped.get(key) ?? { species, scheme, records: 0, seedlings: 0 };
      group.records += recordCountAt(dataset, row);
      group.seedlings += countAt(dataset, row);
      grouped.set(key, group);
    }
    return [...grouped.values()].sort(
      (a, b) => b.seedlings - a.seedlings || a.species.localeCompare(b.species) || a.scheme.localeCompare(b.scheme),
    );
  }, [rows]);
  const totalSeedlings = groups.reduce((total, group) => total + group.seedlings, 0);
  const speciesCount = new Set(groups.map((group) => group.species)).size;
  const schemeCount = new Set(groups.map((group) => group.scheme)).size;

  return (
    <>
      <SectionHeading
        eyebrow="Geotagged division details"
        title={division}
        description="Palm records are excluded. See geotagged species, schemes, and seedling counts for this division."
        action={<button className="button button-outline" onClick={onBack}><ArrowLeft size={16} /> Back to overview</button>}
      />
      <div className="dataset-summary division-summary">
        <div><span>Planting records</span><strong>{formatNumber(rows.reduce((total, item) => total + recordCountAt(item.dataset, item.row), 0))}</strong></div>
        <div><span>Species</span><strong>{formatNumber(speciesCount)}</strong></div>
        <div><span>Schemes</span><strong>{formatNumber(schemeCount)}</strong></div>
        <div><span>Seedlings reported</span><strong>{formatNumber(totalSeedlings)}</strong></div>
      </div>
      <section className="report-table-card">
        <div className="report-table-heading">
          <div><h2>Species and scheme breakdown</h2><p>Seedling totals are grouped by species and scheme and reflect the current dashboard filters.</p></div>
          <span>{formatNumber(groups.length)} combinations</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Species</th><th>Scheme</th><th className="num">Seedlings reported</th><th className="num">Planting records</th></tr></thead>
            <tbody>
              {groups.map((group) => (
                <tr key={`${group.species}-${group.scheme}`}>
                  <td>{group.species}</td>
                  <td>{group.scheme}</td>
                  <td className="num strong">{formatNumber(group.seedlings)}</td>
                  <td className="num">{formatNumber(group.records)}</td>
                </tr>
              ))}
              {!groups.length && (
                <tr><td className="table-empty" colSpan={4}><Sprout size={23} /><strong>No planting records found</strong><span>Change the dashboard filters and try again.</span></td></tr>
              )}
              {groups.length > 0 && (
                <tr className="totals-row"><td colSpan={2}>Total</td><td className="num">{formatNumber(totalSeedlings)}</td><td className="num">{formatNumber(rows.reduce((total, item) => total + recordCountAt(item.dataset, item.row), 0))}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function govDepartmentAt(dataset, row) {
  return dataset.source === "palm" ? "" : valueAt(dataset, row, "Gov Department Type");
}

function RankBadge({ index }) {
  return <span className={`rank-cell ${index < 3 ? `rank-top rank-${index + 1}` : ""}`}>{index + 1}</span>;
}

// Percent shows the share of the total; the bar is scaled to the largest row so small shares stay visible.
function ShareCell({ value, total, max }) {
  const percent = total ? (value / total) * 100 : 0;
  const barPercent = max ? (value / max) * 100 : percent;
  return (
    <td className="num share-cell">
      <div className="share-wrap">
        <div className="share-bar"><span style={{ width: `${Math.max(barPercent, barPercent > 0 ? 2 : 0)}%` }} /></div>
        <em>{total ? `${percent.toFixed(1)}%` : "-"}</em>
      </div>
    </td>
  );
}

function AbstractTable({ title, subtitle, label, groups, onSelect }) {
  const totalRecords = groups.reduce((total, group) => total + group.records, 0);
  const totalSeedlings = groups.reduce((total, group) => total + group.seedlings, 0);

  return (
    <section className="report-table-card">
      <div className="report-table-heading">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
        <span>{formatNumber(groups.length)} groups</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>{label}</th><th className="num">Planting records</th><th className="num">Seedlings reported</th><th className="num">Share of seedlings</th></tr></thead>
          <tbody>
            {groups.map((group, index) => (
              <tr
                key={group.name}
                className={onSelect ? "clickable-row" : undefined}
                onClick={onSelect ? () => onSelect(group.name) : undefined}
                title={onSelect ? `View ${group.name} dashboard` : undefined}
              >
                <td><div className="name-cell"><RankBadge index={index} /><span>{group.name}</span></div></td>
                <td className="num">{formatNumber(group.records)}</td>
                <td className="num strong">{formatNumber(group.seedlings)}</td>
                <ShareCell value={group.seedlings} total={totalSeedlings} max={groups[0]?.seedlings} />
              </tr>
            ))}
            {!groups.length && (
              <tr><td className="table-empty" colSpan={4}><Sprout size={23} /><strong>No data found</strong><span>Change the filters and try again.</span></td></tr>
            )}
            {groups.length > 0 && (
              <tr className="totals-row"><td>Total</td><td className="num">{formatNumber(totalRecords)}</td><td className="num">{formatNumber(totalSeedlings)}</td><td className="num">100%</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function shortLabel(value, max = 16) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function SimpleBarChart({ data, dataKey, label, color, height = 280, horizontal = false }) {
  if (!data.length) return <EmptyChart />;
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={Math.max(height, data.length * 34 + 20)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="#edf1ed" horizontal={false} />
          <XAxis type="number" tickFormatter={(value) => compactFormat.format(value)} tick={{ fontSize: 11, fill: "#849087" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={250} tickFormatter={(value) => shortLabel(value, 30)} tick={{ fontSize: 11.5, fill: "#4a5d50" }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value) => [formatNumber(value), label]} cursor={{ fill: "#f2f7f2" }} />
          <Bar dataKey={dataKey} fill={color} radius={[0, 6, 6, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 42, left: 14 }}>
        <CartesianGrid stroke="#edf1ed" vertical={false} />
        <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} height={74} tickFormatter={(value) => shortLabel(value)} tick={{ fontSize: 11, fill: "#5f6f64" }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(value) => compactFormat.format(value)} tick={{ fontSize: 11, fill: "#849087" }} axisLine={false} tickLine={false} width={45} />
        <Tooltip formatter={(value) => [formatNumber(value), label]} cursor={{ fill: "#f2f7f2" }} />
        <Bar dataKey={dataKey} fill={color} radius={[5, 5, 0, 0]} maxBarSize={38} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const MONTH_LABEL = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });

/** Seedlings per calendar month (from the Date field), oldest first, limited to the latest `limit` months. */
function monthlyTrend(datasetRows, limit = 12) {
  const months = new Map();
  // Mistyped dates (e.g. year 5025) would stretch the axis; keep 2020 up to the current month.
  const latestMonth = dateKey(new Date()).slice(0, 7);
  for (const { dataset, row } of datasetRows) {
    const month = valueAt(dataset, row, "Date").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month) || month < "2020-01" || month > latestMonth) continue;
    const group = months.get(month) ?? { month, seedlings: 0, records: 0 };
    group.seedlings += countAt(dataset, row);
    group.records += recordCountAt(dataset, row);
    months.set(month, group);
  }
  return [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-limit)
    .map((group) => ({ ...group, name: MONTH_LABEL.format(new Date(`${group.month}-01T00:00:00Z`)) }));
}

function MonthlyTrendChart({ data, color = "#278452" }) {
  if (!data.length) return <EmptyChart text="No dated records match these filters." />;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 14, bottom: 18, left: 0 }}>
        <defs>
          <linearGradient id={`trend-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#edf1ed" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#718074" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tickFormatter={(value) => compactFormat.format(value)} tick={{ fontSize: 10, fill: "#849087" }} axisLine={false} tickLine={false} width={45} />
        <Tooltip formatter={(value, name) => [formatNumber(value), name === "seedlings" ? "Seedlings" : "Records"]} />
        <Area type="monotone" dataKey="seedlings" stroke={color} strokeWidth={2} fill={`url(#trend-${color.slice(1)})`} dot={{ r: 3, fill: color, strokeWidth: 0 }} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RankingList({ title, groups, max, tone }) {
  return (
    <div className={`ranking-list ranking-${tone}`}>
      <h3>{title}</h3>
      {groups.length ? (
        <ol>
          {groups.map((group) => (
            <li key={group.name}>
              <div className="ranking-row"><span>{group.name}</span><strong>{formatNumber(group.seedlings)}</strong></div>
              <div className="ranking-bar"><span style={{ width: `${max ? Math.max(2, (group.seedlings / max) * 100) : 0}%` }} /></div>
            </li>
          ))}
        </ol>
      ) : <p className="ranking-empty">No data for these filters.</p>}
    </div>
  );
}

/** Top and bottom performers by seedlings for a field such as District or Division. */
function RankingCard({ rows, field, label, count = 5, className = "" }) {
  // Names are merged case-insensitively so "Kanyakumari" and "KANYAKUMARI" rank as one.
  const groups = useMemo(() => {
    const merged = new Map();
    for (const { dataset, row } of rows) {
      const name = filterValue(dataset, row, field).trim().replace(/\s+/g, " ");
      if (!name) continue;
      const key = name.toLocaleUpperCase("en");
      const group = merged.get(key) ?? { name: key, seedlings: 0 };
      group.seedlings += countAt(dataset, row);
      merged.set(key, group);
    }
    return [...merged.values()]
      .filter((group) => group.seedlings > 0)
      .sort((a, b) => b.seedlings - a.seedlings || a.name.localeCompare(b.name));
  }, [rows, field]);
  const top = groups.slice(0, count);
  const bottom = groups.length > count ? groups.slice(-count).reverse() : [];
  const max = groups[0]?.seedlings ?? 0;
  return (
    <ChartCard title={`Top and bottom ${label.toLowerCase()}s`} subtitle={`Seedlings reported · ${formatNumber(groups.length)} ${label.toLowerCase()}s ranked`} className={className}>
      <div className="ranking-grid">
        <RankingList title={`Top ${top.length || ""}`.trim()} groups={top} max={max} tone="top" />
        <RankingList title={bottom.length ? `Lowest ${bottom.length}` : "Lowest"} groups={bottom} max={max} tone="bottom" />
      </div>
    </ChartCard>
  );
}

function progressTone(percent) {
  if (percent >= 100) return "done";
  if (percent >= 50) return "mid";
  return "low";
}

/** Forest Department district targets (uploaded on the Forest Department page) against seedlings reported. */
function TargetProgress({ forestRows, year, onUploadTargets }) {
  const targets = useMemo(() => loadDistrictTargets(forestRows).targetsByYear[year] ?? {}, [forestRows, year]);
  const items = useMemo(() => {
    const achieved = new Map();
    for (const { dataset, row } of forestRows) {
      if (valueAt(dataset, row, "Year") !== year) continue;
      const key = normalizeDistrictName(valueAt(dataset, row, "District"));
      achieved.set(key, (achieved.get(key) ?? 0) + countAt(dataset, row));
    }
    return Object.entries(targets)
      .map(([key, entry]) => {
        const done = achieved.get(key) ?? 0;
        return { key, district: entry.district, target: entry.target, done, percent: entry.target ? (done / entry.target) * 100 : 0 };
      })
      .sort((a, b) => b.percent - a.percent || a.district.localeCompare(b.district));
  }, [forestRows, targets, year]);
  const totalTarget = items.reduce((total, item) => total + item.target, 0);
  const totalDone = items.reduce((total, item) => total + item.done, 0);
  const overall = totalTarget ? (totalDone / totalTarget) * 100 : 0;

  return (
    <article className="chart-card chart-wide target-progress">
      <div className="chart-heading">
        <div>
          <h2>Target vs achievement · Forest Department</h2>
          <p>{year} district targets against geotagged seedlings reported (respects the district filter).</p>
        </div>
        {items.length > 0 && (
          <div className={`target-overall tone-${progressTone(overall)}`}>
            <strong>{overall.toFixed(1)}%</strong>
            <span>{formatNumber(totalDone)} of {formatNumber(totalTarget)}</span>
          </div>
        )}
      </div>
      {items.length ? (
        <div className="target-list">
          {items.map((item) => (
            <div key={item.key} className="target-item">
              <div className="target-row">
                <span>{item.district}</span>
                <span className="target-numbers">{formatNumber(item.done)} / {formatNumber(item.target)}</span>
                <strong className={`tone-${progressTone(item.percent)}`}>{item.percent.toFixed(0)}%</strong>
              </div>
              <div className="target-bar"><span className={`tone-${progressTone(item.percent)}`} style={{ width: `${Math.min(100, item.percent)}%` }} /></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-chart target-empty">
          <Target size={24} />
          <span>No district targets uploaded for {year}.</span>
          {onUploadTargets && (
            <button className="button button-outline" onClick={onUploadTargets}><Upload size={15} /> Upload targets on the Forest Department page</button>
          )}
        </div>
      )}
    </article>
  );
}

/** Map panel with its loading, error and "data not ready" states. */
function MapPanel({ mapState, points, onRetry, height, title, subtitle, categories }) {
  let body;
  if (mapState.status === "loading" || mapState.status === "idle") {
    body = <div className="empty-chart map-placeholder" style={{ height }}><LoaderCircle className="spin" size={22} /><span>Loading planting locations…</span></div>;
  } else if (mapState.status === "error") {
    body = (
      <div className="empty-chart map-placeholder" style={{ height }}>
        <MapPin size={22} /><span>{mapState.error}</span>
        <button className="button button-outline" onClick={onRetry}><RefreshCw size={14} /> Try again</button>
      </div>
    );
  } else if (!mapState.available) {
    body = (
      <div className="empty-chart map-placeholder" style={{ height }}>
        <MapPin size={22} /><span>Map locations will appear after the next data sync. Click “Refresh data” at the top to sync now.</span>
      </div>
    );
  } else {
    body = (
      <>
        <PlantingMap points={points} height={height} />
        <MapLegend categories={categories} />
      </>
    );
  }
  return (
    <article className="chart-card chart-wide map-card">
      <div className="chart-heading">
        <div><h2>{title}</h2><p>{subtitle}</p></div>
      </div>
      {body}
    </article>
  );
}

function rowCategory(dataset, row) {
  return mapCategory({
    source: dataset.source,
    department: valueAt(dataset, row, "Department"),
    govDepartment: govDepartmentAt(dataset, row),
  });
}

function MapPage({ rows, mapState, onRetry, isAdmin }) {
  const [year, setYear] = useState(() => currentReportingYear());
  const [district, setDistrict] = useState("all");
  const [category, setCategory] = useState("all");
  const points = mapState.points ?? [];
  const years = useMemo(() => uniqueSorted([...points.map((point) => point.year), currentReportingYear()]), [points]);
  const yearPoints = useMemo(
    () => points.filter((point) => (year === "all" || point.year === year) && (category === "all" || point.category === category)),
    [points, year, category],
  );
  const districts = useMemo(() => uniqueSorted(yearPoints.map((point) => point.districtKey)), [yearPoints]);
  const filteredPoints = useMemo(
    () => (district === "all" ? yearPoints : yearPoints.filter((point) => point.districtKey === district)),
    [yearPoints, district],
  );
  const mappedSeedlings = filteredPoints.reduce((total, point) => total + point.seedlings, 0);
  const mappedRecords = filteredPoints.reduce((total, point) => total + point.records, 0);
  const totalRecords = useMemo(() => rows.reduce((total, { dataset, row }) => (
    (year === "all" || valueAt(dataset, row, "Year") === year)
    && (district === "all" || valueAt(dataset, row, "District").trim().replace(/\s+/g, " ").toLocaleUpperCase("en") === district)
    && (category === "all" || rowCategory(dataset, row) === category)
      ? total + recordCountAt(dataset, row)
      : total
  ), 0), [rows, year, district, category]);
  const coverage = totalRecords ? Math.min(100, (mappedRecords / totalRecords) * 100) : 0;
  const categories = isAdmin ? MAP_CATEGORIES : MAP_CATEGORIES.filter((item) => item.id !== "palm");
  const topDistricts = useMemo(() => {
    const groups = new Map();
    for (const point of filteredPoints) groups.set(point.districtKey, (groups.get(point.districtKey) ?? 0) + point.seedlings);
    return [...groups].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [filteredPoints]);

  return (
    <>
      <SectionHeading
        eyebrow="Geotagged planting"
        title="Planting map"
        description="Every geotagged planting location on the map. Clusters show total seedlings; zoom in or click a cluster to see individual sites."
      />
      <div className="report-controls gov-department-filter">
        <label className="report-selector" htmlFor="map-year-select">
          <span>Year</span>
          <span className="select-wrap report-select">
            <select id="map-year-select" value={year} onChange={(event) => { setYear(event.target.value); setDistrict("all"); }}>
              <option value="all">All years</option>
              {years.map((option) => (
                <option key={option} value={option}>{option === currentReportingYear() ? `${option} (current year)` : option}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </span>
        </label>
        <label className="report-selector" htmlFor="map-category-select">
          <span>Planted by</span>
          <span className="select-wrap report-select">
            <select id="map-category-select" value={category} onChange={(event) => { setCategory(event.target.value); setDistrict("all"); }}>
              <option value="all">Everyone</option>
              {categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <ChevronDown size={14} />
          </span>
        </label>
        <label className="report-selector" htmlFor="map-district-select">
          <span>District</span>
          <span className="select-wrap report-select">
            <select id="map-district-select" value={district} onChange={(event) => setDistrict(event.target.value)}>
              <option value="all">All districts</option>
              {districts.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <ChevronDown size={14} />
          </span>
        </label>
      </div>
      <div className="stat-grid">
        <StatCard title="Mapped locations" value={formatNumber(filteredPoints.length)} note="Distinct GPS spots (≈11 m)" icon={MapPinned} />
        <StatCard title="Seedlings mapped" value={formatNumber(mappedSeedlings)} note="With a valid GPS location" icon={Sprout} tone="mint" />
        <StatCard title="Records with GPS" value={formatNumber(mappedRecords)} note={`of ${formatNumber(totalRecords)} records`} icon={FileBarChart} tone="gold" />
        <StatCard title="GPS coverage" value={`${coverage.toFixed(1)}%`} note="Records that can be mapped" icon={Crosshair} tone="blue" />
      </div>
      <div className="charts-grid">
        <MapPanel
          mapState={mapState}
          points={filteredPoints}
          onRetry={onRetry}
          height={560}
          title="Planting locations"
          subtitle="Click a dot for district, division, year, seedlings and a Google Maps link."
          categories={categories}
        />
        <ChartCard title="Mapped seedlings by district" subtitle="Top 8 districts in the current map view" className="chart-wide">
          <SimpleBarChart data={topDistricts.map(([name, seedlings]) => ({ name, seedlings }))} dataKey="seedlings" label="Seedlings" color="#278452" height={260} />
        </ChartCard>
      </div>
    </>
  );
}

function GovDepartmentDashboard({ rows, department: selectedDepartment, setDepartment, year, setYear, district, setDistrict, lockedDepartment = "", mapState, onRetryMap }) {
  const department = lockedDepartment ? "all" : selectedDepartment;
  const allGovRows = useMemo(
    () => rows.filter(({ dataset, row }) => govDepartmentAt(dataset, row)),
    [rows],
  );
  const years = useMemo(
    () => uniqueSorted([...allGovRows.map(({ dataset, row }) => valueAt(dataset, row, "Year")), currentReportingYear()]),
    [allGovRows],
  );
  const yearRows = useMemo(
    () => (year === "all" ? allGovRows : allGovRows.filter(({ dataset, row }) => valueAt(dataset, row, "Year") === year)),
    [allGovRows, year],
  );
  const districts = useMemo(
    () => uniqueSorted([...yearRows.map(({ dataset, row }) => valueAt(dataset, row, "District")), ...(district === "all" ? [] : [district])]),
    [yearRows, district],
  );
  const govRows = useMemo(
    () => (district === "all" ? yearRows : yearRows.filter(({ dataset, row }) => valueAt(dataset, row, "District") === district)),
    [yearRows, district],
  );
  const yearLabel = year === "all" ? "All years" : year;
  const departments = useMemo(
    () => groupData(govRows, "Gov Department Type", "seedlings"),
    [govRows],
  );
  const departmentOptions = useMemo(
    () => uniqueSorted([...departments.map((group) => group.name), ...(department === "all" ? [] : [department])]),
    [departments, department],
  );
  const selectedRows = useMemo(
    () => (department === "all" ? govRows : govRows.filter(({ dataset, row }) => govDepartmentAt(dataset, row) === department)),
    [govRows, department],
  );
  const selectedSummary = useMemo(() => summarize(selectedRows), [selectedRows]);
  const byDistrict = useMemo(() => groupData(selectedRows, "District", "seedlings"), [selectedRows]);
  const byYear = useMemo(
    () => groupData(selectedRows, "Year", "seedlings").sort((a, b) => a.name.localeCompare(b.name)),
    [selectedRows],
  );
  const bySpecies = useMemo(() => groupData(selectedRows, "Species", "seedlings"), [selectedRows]);
  const byMonth = useMemo(() => monthlyTrend(selectedRows), [selectedRows]);
  const isAll = department === "all" && !lockedDepartment;
  const departmentTitle = lockedDepartment || department;
  const departmentPoints = useMemo(() => (mapState?.points ?? []).filter((point) => (
    point.category === "gov"
    && (year === "all" || point.year === year)
    && (district === "all" || point.districtKey === district.trim().replace(/\s+/g, " ").toLocaleUpperCase("en"))
    && (department === "all" || point.govDepartment === department)
  )), [mapState?.points, year, district, department]);
  const departmentMapSeedlings = departmentPoints.reduce((total, point) => total + point.seedlings, 0);

  function downloadAbstract() {
    const groups = isAll ? departments : byDistrict;
    const header = isAll ? "Government Department" : "District";
    const abstractRows = groups.map((group) => [group.name, group.records, group.seedlings]);
    const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const suffix = `${isAll ? "govt-departments" : slug(departmentTitle)}-${slug(yearLabel)}-abstract`;
    downloadCsv(
      { source: "gov-department", headers: [header, "Planting records", "Seedlings reported"] },
      abstractRows,
      suffix,
    );
  }

  return (
    <>
      <SectionHeading
        eyebrow="Government department abstract"
        title={isAll ? "Government departments" : departmentTitle}
        description={isAll
          ? "Abstract of geotagged planting by government department. Select a department to see its dashboard."
          : "Abstract dashboard of geotagged planting for the selected government department."}
        action={<button className="button button-primary" onClick={downloadAbstract}><Download size={16} /> Export abstract CSV</button>}
      />
      <div className="report-controls gov-department-filter">
        {!lockedDepartment && (
        <label className="report-selector" htmlFor="gov-department-select">
          <span>Government department</span>
          <span className="select-wrap report-select gov-department-select">
            <select id="gov-department-select" value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="all">All government departments</option>
              {departmentOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <ChevronDown size={14} />
          </span>
        </label>
        )}
        <label className="report-selector" htmlFor="gov-year-select">
          <span>Year</span>
          <span className="select-wrap report-select">
            <select id="gov-year-select" value={year} onChange={(event) => setYear(event.target.value)}>
              <option value="all">All years</option>
              {years.map((option) => (
                <option key={option} value={option}>
                  {option === currentReportingYear() ? `${option} (current year)` : option}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </span>
        </label>
        <label className="report-selector" htmlFor="gov-district-select">
          <span>District</span>
          <span className="select-wrap report-select">
            <select id="gov-district-select" value={district} onChange={(event) => setDistrict(event.target.value)}>
              <option value="all">All districts</option>
              {districts.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <ChevronDown size={14} />
          </span>
        </label>
        {!isAll && !lockedDepartment && (
          <button className="button button-outline" onClick={() => setDepartment("all")}>
            <ArrowLeft size={15} /> All departments
          </button>
        )}
      </div>
      <div className="stat-grid">
        <StatCard title="Seedlings reported" value={formatNumber(selectedSummary.seedlings)} note={`${yearLabel} · ${isAll ? `${formatNumber(departments.length)} departments` : "selected department"}`} icon={Sprout} />
        <StatCard title="Planting records" value={formatNumber(selectedSummary.records)} note="Geotagged records" icon={FileBarChart} tone="mint" />
        <StatCard title="Districts covered" value={formatNumber(selectedSummary.districts)} note={`${formatNumber(selectedSummary.divisions)} divisions`} icon={MapPin} tone="gold" />
        <StatCard title="Species planted" value={formatNumber(selectedSummary.species)} note="Distinct species" icon={TreePine} tone="blue" />
      </div>
      <div className="charts-grid">
        {isAll && (
          <ChartCard title="Seedlings by department" subtitle="Seedlings reported · top 10 departments" className="chart-wide">
            <SimpleBarChart data={departments.slice(0, 10)} dataKey="seedlings" label="Seedlings" color="#278452" height={320} horizontal />
          </ChartCard>
        )}
        <ChartCard title="Seedlings by district" subtitle="Seedlings reported · top 12 districts" className={isAll ? "" : "chart-wide"}>
          <SimpleBarChart data={byDistrict.slice(0, 12)} dataKey="seedlings" label="Seedlings" color={isAll ? "#6ba77b" : "#278452"} />
        </ChartCard>
        <ChartCard title="Seedlings by year" subtitle="Seedlings reported per planting year">
          <SimpleBarChart data={byYear} dataKey="seedlings" label="Seedlings" color="#5784a5" />
        </ChartCard>
        <ChartCard title="Top species" subtitle="Seedlings reported · top 8 species">
          <SimpleBarChart data={bySpecies.slice(0, 8)} dataKey="seedlings" label="Seedlings" color="#d99848" />
        </ChartCard>
        <ChartCard title="Monthly trend" subtitle={`Seedlings reported per month · ${yearLabel}${byMonth.length === 12 ? " · latest 12 months" : ""}`} className={isAll ? "" : "chart-wide"}>
          <MonthlyTrendChart data={byMonth} />
        </ChartCard>
        {isAll && <RankingCard rows={selectedRows} field="District" label="District" className="chart-wide" />}
        {mapState && (
          <MapPanel
            mapState={mapState}
            points={departmentPoints}
            onRetry={onRetryMap}
            height={460}
            title="Planting locations"
            subtitle={`${formatNumber(departmentPoints.length)} GPS locations · ${formatNumber(departmentMapSeedlings)} seedlings · ${isAll ? "all government departments" : departmentTitle}`}
            categories={MAP_CATEGORIES.filter((item) => item.id === "gov")}
          />
        )}
        {!isAll && <RankingCard rows={selectedRows} field="District" label="District" className="chart-wide" />}
      </div>
      <div className="gov-abstract-tables">
        {isAll ? (
          <AbstractTable
            title="Department-wise abstract"
            subtitle="Click a department to open its dashboard."
            label="Government department"
            groups={departments}
            onSelect={setDepartment}
          />
        ) : (
          <AbstractTable
            title="District-wise abstract"
            subtitle={`Planting records and seedlings for ${departmentTitle} by district.`}
            label="District"
            groups={byDistrict}
          />
        )}
      </div>
    </>
  );
}

function DepartmentBreakdown({ rows, field, title, onSelect }) {
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const { dataset, row } of rows) {
      const name = valueAt(dataset, row, field) || "Others";
      const group = groups.get(name) ?? { name, seedlings: 0 };
      group.seedlings += countAt(dataset, row);
      groups.set(name, group);
    }
    return [...groups.values()].sort(
      (a, b) => b.seedlings - a.seedlings || a.name.localeCompare(b.name),
    );
  }, [rows, field]);
  const totalSeedlings = grouped.reduce((total, group) => total + group.seedlings, 0);

  return (
    <section className="report-table-card department-breakdown">
      <div className="report-table-heading">
      <div><h2>{title}</h2><p>Seedling totals from the current filtered geotagged data.</p></div>
      <span>{formatNumber(grouped.length)} groups</span>
    </div>
    <div className="table-scroll">
      <table>
        <thead><tr><th>{title}</th><th className="num">Seedlings reported</th></tr></thead>
        <tbody>
          {grouped.map((group) => (
            <tr
              key={group.name}
              className={onSelect && group.name !== "Others" ? "clickable-row" : undefined}
              onClick={onSelect && group.name !== "Others" ? () => onSelect(group.name) : undefined}
            >
              <td>{group.name}</td>
              <td className="num strong">{formatNumber(group.seedlings)}</td>
            </tr>
          ))}
          {!grouped.length && (
            <tr><td className="table-empty" colSpan={2}><Sprout size={23} /><strong>No {title.toLowerCase()} data found</strong><span>Change the filters and try again.</span></td></tr>
          )}
          {grouped.length > 0 && (
            <tr className="totals-row"><td>Total seedlings</td><td className="num">{formatNumber(totalSeedlings)}</td></tr>
          )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ForestLocationTable({ rows, selectedYear, targetsByDistrict, circle, district }) {
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const { dataset, row } of rows) {
      const circle = valueAt(dataset, row, "Circle") || "Others";
      const district = valueAt(dataset, row, "District") || "Others";
      const key = `${circle}\u0000${district}`;
      const group = groups.get(key) ?? { circle, district, seedlings: 0 };
      group.seedlings += countAt(dataset, row);
      groups.set(key, group);
    }
    for (const [districtKey, targetEntry] of Object.entries(targetsByDistrict)) {
      const key = `${targetEntry.circle}\u0000${districtKey}`;
      if (
        groups.has(key)
        || (circle !== "all" && targetEntry.circle !== circle)
        || (district !== "all" && districtKey !== normalizeDistrictName(district))
      ) continue;
      groups.set(key, {
        circle: targetEntry.circle,
        district: targetEntry.district,
        seedlings: null,
      });
    }
    return [...groups.values()].sort(
      (a, b) => a.circle.localeCompare(b.circle)
        || a.district.localeCompare(b.district),
    );
  }, [rows, targetsByDistrict, circle, district]);
  const totalSeedlings = grouped.reduce((total, group) => total + (group.seedlings ?? 0), 0);
  const hasSeedlingRows = grouped.some((group) => group.seedlings !== null);

  return (
    <section className="report-table-card department-breakdown">
      <div className="report-table-heading">
        <div><h2>Seedlings by location</h2><p>Circle and district totals for the selected filters.</p></div>
        <span>{formatNumber(grouped.length)} locations</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Circle</th><th>District</th><th className="num">Seedlings reported</th><th className="num">Target</th></tr>
          </thead>
          <tbody>
            {grouped.map((group) => {
              const target = targetsByDistrict[normalizeDistrictName(group.district)];

              return (
                <tr key={`${group.circle}-${group.district}`}>
                  <td>{group.circle}</td>
                  <td>{group.district}</td>
                  <td className="num strong">{group.seedlings === null ? "-" : formatNumber(group.seedlings)}</td>
                  <td className="num">{selectedYear === "all"
                    ? "Select a year"
                    : target === undefined ? "-" : formatNumber(target.target)}</td>
                </tr>
              );
            })}
            {!grouped.length && (
              <tr><td className="table-empty" colSpan={4}><Sprout size={23} /><strong>No location data found</strong><span>Change the filters and try again.</span></td></tr>
            )}
            {hasSeedlingRows && (
              <tr className="totals-row"><td colSpan={2}>Total seedlings</td><td className="num">{formatNumber(totalSeedlings)}</td><td className="num">—</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LocationSeedlingDetails({ title, rows, onBack }) {
  const [year, setYear] = useState("all");
  const [scheme, setScheme] = useState("all");
  const [species, setSpecies] = useState("all");
  const [circle, setCircle] = useState("all");
  const [district, setDistrict] = useState("all");
  const [division, setDivision] = useState("all");
  const [targetStorage, setTargetStorage] = useState(() => loadDistrictTargets(rows));
  const [targetUploadError, setTargetUploadError] = useState("");
  const [targetUploadMessage, setTargetUploadMessage] = useState("");
  const targetFileInput = useRef(null);
  const years = useMemo(() => uniqueSorted(rows.map(({ dataset, row }) => valueAt(dataset, row, "Year"))), [rows]);
  const schemes = useMemo(() => uniqueSorted(rows.map(({ dataset, row }) => valueAt(dataset, row, "Scheme"))), [rows]);
  const speciesOptions = useMemo(() => uniqueSorted(rows.map(({ dataset, row }) => speciesAt(dataset, row))), [rows]);
  const divisionLabel = title === "Forest Department" ? "Forest Division" : "Division";
  const attributeRows = useMemo(() => rows.filter(({ dataset, row }) => (
    (year === "all" || valueAt(dataset, row, "Year") === year)
    && (scheme === "all" || valueAt(dataset, row, "Scheme") === scheme)
    && (species === "all" || speciesAt(dataset, row) === species)
  )), [rows, year, scheme, species]);
  const targetsByDistrict = year === "all" ? {} : targetStorage.targetsByYear[year] ?? {};
  const circles = useMemo(
    () => uniqueSorted([
      ...attributeRows.map(({ dataset, row }) => valueAt(dataset, row, "Circle")),
      ...Object.values(targetsByDistrict).map(({ circle: targetCircle }) => targetCircle),
    ]),
    [attributeRows, targetsByDistrict],
  );
  const circleRows = useMemo(
    () => attributeRows.filter(({ dataset, row }) => circle === "all" || valueAt(dataset, row, "Circle") === circle),
    [attributeRows, circle],
  );
  const districts = useMemo(
    () => uniqueSorted([
      ...circleRows.map(({ dataset, row }) => valueAt(dataset, row, "District")),
      ...Object.values(targetsByDistrict)
        .filter((target) => circle === "all" || target.circle === circle)
        .map((target) => target.district),
    ]),
    [circleRows, targetsByDistrict, circle],
  );
  const districtRows = useMemo(
    () => circleRows.filter(({ dataset, row }) => district === "all" || valueAt(dataset, row, "District") === district),
    [circleRows, district],
  );
  const divisions = useMemo(
    () => uniqueSorted(districtRows.map(({ dataset, row }) => valueAt(dataset, row, "Division"))),
    [districtRows],
  );
  const filteredRows = useMemo(
    () => districtRows.filter(({ dataset, row }) => division === "all" || valueAt(dataset, row, "Division") === division),
    [districtRows, division],
  );
  const totalSeedlings = filteredRows.reduce((total, { dataset, row }) => total + countAt(dataset, row), 0);
  function saveUploadedTargets(fields, data, fileType) {
    const districtField = fields.find((field) => field.toLocaleLowerCase() === "district");
    const circleField = fields.find((field) => field.toLocaleLowerCase() === "circle");
    const targetField = fields.find((field) => field.toLocaleLowerCase() === "target");
    if (!districtField || !targetField) {
      setTargetUploadError(`The ${fileType} must include District and Target columns.`);
      return;
    }
    if (!data.length) {
      setTargetUploadError(`The ${fileType} has no district rows.`);
      return;
    }

    const uploadedTargets = {};
    let rowsWithoutDistrict = 0;
    for (let index = 0; index < data.length; index += 1) {
      const row = data[index];
      const districtName = String(row[districtField] ?? "").trim().replace(/\s+/g, " ");
      const uploadedCircle = circleField ? String(row[circleField] ?? "").trim().replace(/\s+/g, " ") : "";
      const targetText = String(row[targetField] ?? "").trim();
      if (!districtName && !targetText) continue;
      if (!districtName) {
        rowsWithoutDistrict += 1;
        continue;
      }
      if (!targetText) continue;
      const target = Number(targetText.replace(/,/g, ""));
      if (!Number.isFinite(target) || target < 0) {
        setTargetUploadError(`Target must be a non-negative number on ${fileType} row ${index + 2}.`);
        return;
      }
      const districtKey = normalizeDistrictName(districtName);
      if (Object.prototype.hasOwnProperty.call(uploadedTargets, districtKey)) {
        setTargetUploadError(`District "${districtName}" appears more than once in the ${fileType}.`);
        return;
      }
      const matchingSource = rows.find(({ dataset, row: sourceRow }) => (
        normalizeDistrictName(valueAt(dataset, sourceRow, "District")) === districtKey
      ));
      uploadedTargets[districtKey] = {
        district: districtName,
        circle: uploadedCircle
          || (matchingSource ? valueAt(matchingSource.dataset, matchingSource.row, "Circle") : "")
          || "Others",
        target,
      };
    }
    if (!Object.keys(uploadedTargets).length) {
      setTargetUploadError(`No district targets were found in the ${fileType}. Check that rows include District and Target values.`);
      return;
    }

    const nextTargetsByYear = {
      ...targetStorage.targetsByYear,
      [year]: uploadedTargets,
    };
    try {
      window.localStorage.setItem(DISTRICT_TARGETS_STORAGE_KEY, JSON.stringify(nextTargetsByYear));
      setTargetStorage({ targetsByYear: nextTargetsByYear, error: "" });
      const ignoredRowsMessage = rowsWithoutDistrict
        ? ` ${rowsWithoutDistrict} row${rowsWithoutDistrict === 1 ? " without" : "s without"} a district name ignored.`
        : "";
      setTargetUploadMessage(`${Object.keys(uploadedTargets).length} district targets saved for ${year}.${ignoredRowsMessage} Re-upload for this year to replace them.`);
    } catch (error) {
      setTargetUploadError(`Could not save targets in this browser: ${error.message}`);
    }
  }

  function handleTargetUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setTargetUploadError("");
    setTargetUploadMessage("");

    if (year === "all") {
      setTargetUploadError("Select a year before uploading district targets.");
      return;
    }
    const extension = file.name.toLocaleLowerCase().split(".").pop();
    if (!["csv", "xlsx", "xls"].includes(extension)) {
      setTargetUploadError("Upload a CSV or Excel file (.csv, .xlsx, or .xls) with District and Target columns.");
      return;
    }

    if (extension === "csv") {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
        complete: (result) => {
          if (result.errors.length) {
            const firstError = result.errors[0];
            setTargetUploadError(`Could not read the target CSV: ${firstError.message} (row ${firstError.row + 1}).`);
            return;
          }
          saveUploadedTargets(result.meta.fields ?? [], result.data, "CSV");
        },
        error: (error) => {
          setTargetUploadError(`Unable to read the target CSV: ${error.message}`);
        },
      });
      return;
    }

    async function readExcelTargets() {
      try {
        const XLSX = await import("@e965/xlsx");
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          setTargetUploadError("The Excel workbook does not contain a worksheet.");
          return;
        }

        const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
          header: 1,
          raw: false,
          defval: "",
          blankrows: false,
        });
        if (!sheetRows.length) {
          setTargetUploadError("The first worksheet in the Excel workbook is empty.");
          return;
        }

        const fields = sheetRows[0].map((field) => String(field ?? "").replace(/^\uFEFF/, "").trim());
        const data = sheetRows.slice(1).map((values) => (
          Object.fromEntries(fields.map((field, index) => [field, values[index] ?? ""]))
        ));
        saveUploadedTargets(fields, data, "Excel file");
      } catch (error) {
        setTargetUploadError(`Unable to read the Excel file: ${error.message}`);
      }
    }

    readExcelTargets();
  }

  function filterControl(label, value, setValue, values, allLabel) {
    return (
      <label className="report-selector forest-filter" key={label}>
        <span>{label}</span>
        <span className="select-wrap forest-filter-select">
          <select value={value} onChange={(event) => setValue(event.target.value)}>
            <option value="all">{allLabel}</option>
            {values.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <ChevronDown size={14} />
        </span>
      </label>
    );
  }

  return (
    <>
      <SectionHeading
        eyebrow={`${title} details`}
        title={title}
        description={`Explore ${title} seedling totals by Circle, District, and Division.`}
        action={<button className="button button-outline" onClick={onBack}><ArrowLeft size={16} /> Back to overview</button>}
      />
      <div className="report-controls forest-detail-filters">
        {filterControl("Circle", circle, (value) => {
          setCircle(value);
          setDistrict("all");
          setDivision("all");
        }, circles, "All circles")}
        {filterControl("District", district, (value) => {
          setDistrict(value);
          setDivision("all");
        }, districts, "All districts")}
        {filterControl(divisionLabel, division, setDivision, divisions, `All ${divisionLabel.toLowerCase()}s`)}
        {filterControl("Year", year, (value) => {
          setYear(value);
          setCircle("all");
          setDistrict("all");
          setDivision("all");
        }, years, "All years")}
        {filterControl("Scheme", scheme, (value) => {
          setScheme(value);
          setCircle("all");
          setDistrict("all");
          setDivision("all");
        }, schemes, "All schemes")}
        {filterControl("Species", species, (value) => {
          setSpecies(value);
          setCircle("all");
          setDistrict("all");
          setDivision("all");
        }, speciesOptions, "All species")}
      </div>
      <div className="target-upload-panel">
        <div>
          <strong>District targets</strong>
          <span>Select a year, then upload a CSV or Excel file with District and Target columns. Circle is optional. Excel files use the first worksheet. A new upload replaces targets for that year only.</span>
          <span>Targets are saved in this browser and stay until replaced by another upload.</span>
          {(targetStorage.error || targetUploadError) && (
            <span className="target-upload-message target-upload-error" role="alert">{targetStorage.error || targetUploadError}</span>
          )}
          {targetUploadMessage && <span className="target-upload-message" role="status">{targetUploadMessage}</span>}
        </div>
        <input
          ref={targetFileInput}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          hidden
          onChange={handleTargetUpload}
        />
        <button
          className="button button-outline"
          disabled={year === "all"}
          onClick={() => targetFileInput.current?.click()}
        >
          <Upload size={15} /> Upload targets
        </button>
      </div>
      <div className="dataset-summary division-summary">
        <div><span>Filtered seedlings reported</span><strong>{formatNumber(totalSeedlings)}</strong></div>
      </div>
      <ForestLocationTable
        rows={filteredRows}
        selectedYear={year}
        targetsByDistrict={targetsByDistrict}
        circle={circle}
        district={district}
      />
    </>
  );
}

function OtherDepartmentDetails({ rows, filters, setFilters, options, onBack, onViewGovDepartment }) {
  const totalSeedlings = rows.reduce((total, { dataset, row }) => total + countAt(dataset, row), 0);

  return (
    <>
      <SectionHeading
        eyebrow="Geotagged department details"
        title="Other departments"
        description="Seedling totals grouped by Department Type and Government Department Type. Palm data is excluded."
        action={<button className="button button-outline" onClick={onBack}><ArrowLeft size={16} /> Back to overview</button>}
      />
      <div className="dataset-summary division-summary">
        <div><span>Seedlings reported</span><strong>{formatNumber(totalSeedlings)}</strong></div>
      </div>
      <div className="report-controls department-year-filter">
        <label className="report-selector" htmlFor="department-year-filter">
          <span>Filter by year</span>
          <span className="select-wrap report-select">
            <select
              id="department-year-filter"
              value={filters.Year}
              onChange={(event) => setFilters((current) => ({ ...current, Year: event.target.value }))}
            >
              <option value="all">All years</option>
              {options.Year.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <ChevronDown size={14} />
          </span>
        </label>
      </div>
      <div className="department-breakdowns">
        <DepartmentBreakdown rows={rows} field="Department Type" title="Department Type" />
        <DepartmentBreakdown rows={rows} field="Gov Department Type" title="Government Department Type" onSelect={onViewGovDepartment} />
      </div>
    </>
  );
}

function Overview({ summary, chartRows, filters, options, setFilters, onClear, datasets, onViewDivision, onViewForestDepartment, onViewOtherDepartments, onViewPalmDetails }) {
  const nonPalmRows = chartRows.filter(({ dataset }) => dataset.source !== "palm");
  const palmRows = chartRows.filter(({ dataset }) => dataset.source === "palm");
  const nonPalmSummary = summarize(nonPalmRows);
  const palmSummary = summarize(palmRows);
  const forestRows = nonPalmRows.filter(({ dataset, row }) => (
    valueAt(dataset, row, "Department").toLocaleLowerCase() === "forest department"
  ));
  const otherDepartmentRows = nonPalmRows.filter(({ dataset, row }) => (
    valueAt(dataset, row, "Department").toLocaleLowerCase() !== "forest department"
  ));
  const forestSeedlings = summarize(forestRows).seedlings;
  const otherDepartmentSeedlings = summarize(otherDepartmentRows).seedlings;
  const now = new Date();
  const reportingYear = currentReportingYear(now);
  const currentYearSeedlings = nonPalmRows
    .filter(({ dataset, row }) => valueAt(dataset, row, "Year") === reportingYear)
    .reduce((total, { dataset, row }) => total + countAt(dataset, row), 0);
  const currentMonth = dateKey(now).slice(0, 7);
  const today = dateKey(now);
  const currentMonthSeedlings = nonPalmRows
    .filter(({ dataset, row }) => valueAt(dataset, row, "Date").startsWith(currentMonth))
    .reduce((total, { dataset, row }) => total + countAt(dataset, row), 0);
  const todaySeedlings = nonPalmRows
    .filter(({ dataset, row }) => valueAt(dataset, row, "Date") === today)
    .reduce((total, { dataset, row }) => total + countAt(dataset, row), 0);
  const districts = groupData(chartRows, "District", "seedlings").slice(0, 9);
  const divisions = groupData(chartRows, "Division", "records").slice(0, 8);
  const species = groupData(chartRows, "Species", "seedlings").slice(0, 7);
  const schemes = groupData(chartRows, "Scheme", "records").slice(0, 6);
  const trend = useMemo(() => monthlyTrend(nonPalmRows), [chartRows]);
  const targetYear = filters.Year !== "all" ? filters.Year : reportingYear;
  const sources = datasets.map((dataset) => ({
    name: dataset.source === "merge" ? "Merge data" : "Palm data",
    value: dataset.rows
      .filter((row) => matchesFilters(dataset, row, filters))
      .reduce((total, row) => total + recordCountAt(dataset, row), 0),
  })).filter((item) => item.value > 0);

  return (
    <>
      <SectionHeading
        eyebrow="Green Tamil Nadu Mission"
        title="Planting overview"
        description="A clear view of planting activity across Tamil Nadu."
        action={<span className="live-badge"><span /> Aggregated dashboard data</span>}
      />
      <FilterBar options={options} filters={filters} setFilters={setFilters} onClear={onClear} />
      <div className="stat-grid">
        <StatCard title="Overall geotagged seedlings" value={formatNumber(nonPalmSummary.seedlings)} note="Excludes palm" icon={Sprout} />
        <StatCard title="Current year geotagged seedlings" value={formatNumber(currentYearSeedlings)} note={`${reportingYear} · excludes palm`} icon={TreePine} tone="mint" />
        <StatCard title="Current month geotagged seedlings" value={formatNumber(currentMonthSeedlings)} note={`${now.toLocaleString("en", { month: "long", year: "numeric" })} · excludes palm`} icon={MapPin} tone="gold" />
        <StatCard title="Today geotagged seedlings" value={formatNumber(todaySeedlings)} note={`${now.toLocaleDateString()} · excludes palm`} icon={Leaf} tone="blue" />
      </div>
      <div className="stat-group-heading">
        <h2>Seedlings by source</h2>
        <p>Geotagged records are split by department; palm records are shown separately.</p>
      </div>
      <div className="stat-grid stat-grid-seedlings">
        <StatCard title="Forest Department" value={formatNumber(forestSeedlings)} note="Geotagged seedlings · view details" icon={TreePine} tone="mint" onClick={onViewForestDepartment} />
        <StatCard title="Other departments" value={formatNumber(otherDepartmentSeedlings)} note="All non-forest geotagged records · view details" icon={Sprout} tone="gold" onClick={onViewOtherDepartments} />
        <StatCard title="Palm seedlings" value={formatNumber(palmSummary.seedlings)} note="Palm data only · view details" icon={TreePine} tone="blue" onClick={onViewPalmDetails} />
      </div>
      <div className="stat-group-heading">
        <h2>Progress and trends</h2>
        <p>Monthly planting, Forest Department targets and the strongest and weakest areas for the current filters.</p>
      </div>
      <div className="charts-grid overview-insights">
        <ChartCard title="Monthly trend" subtitle={`Geotagged seedlings per month · excludes palm${trend.length === 12 ? " · latest 12 months" : ""}`} className="chart-wide">
          <MonthlyTrendChart data={trend} />
        </ChartCard>
        <TargetProgress forestRows={forestRows} year={targetYear} onUploadTargets={onViewForestDepartment} />
        <RankingCard rows={nonPalmRows} field="District" label="District" />
        <RankingCard rows={nonPalmRows} field="Division" label="Division" />
      </div>
      <div className="charts-grid">
        <ChartCard title="Planting by district" subtitle="Seedlings reported · top 9 districts" className="chart-wide">
          {districts.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={districts} margin={{ top: 8, right: 12, bottom: 42, left: 0 }}>
                <CartesianGrid stroke="#edf1ed" vertical={false} />
                <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} height={66} tick={{ fontSize: 10, fill: "#718074" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => compactFormat.format(value)} tick={{ fontSize: 11, fill: "#849087" }} axisLine={false} tickLine={false} width={45} />
                <Tooltip formatter={(value) => [formatNumber(value), "Seedlings"]} cursor={{ fill: "#f2f7f2" }} />
                <Bar dataKey="seedlings" fill="#278452" radius={[5, 5, 0, 0]} maxBarSize={38} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>
        <ChartCard title="Records by source" subtitle="Share of filtered records">
          {sources.length ? (
            <div className="donut-wrap">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={sources} dataKey="value" nameKey="name" innerRadius={62} outerRadius={86} paddingAngle={4} stroke="none">
                    {sources.map((entry, index) => <Cell key={entry.name} fill={COLORS[index]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => [formatNumber(value), "Records"]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-legend">
                {sources.map((item, index) => (
                  <div key={item.name}><span style={{ backgroundColor: COLORS[index] }} />{item.name}<strong>{formatNumber(item.value)}</strong></div>
                ))}
              </div>
            </div>
          ) : <EmptyChart />}
        </ChartCard>
        <ChartCard title="Division activity" subtitle="Record count · top 8 divisions">
          {divisions.length ? (
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={divisions} layout="vertical" margin={{ left: 10, right: 18 }}>
                <CartesianGrid stroke="#edf1ed" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#849087" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10, fill: "#718074" }} axisLine={false} tickLine={false} />
                <Tooltip
                  content={<DivisionTooltip onViewDetails={onViewDivision} />}
                  wrapperStyle={{ pointerEvents: "auto" }}
                  cursor={{ fill: "#f2f7f2" }}
                />
                <Bar
                  dataKey="records"
                  fill="#6ba77b"
                  radius={[0, 5, 5, 0]}
                  maxBarSize={20}
                  cursor="pointer"
                  onClick={(entry) => onViewDivision(entry.name)}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>
        <ChartCard title="Top species" subtitle="Seedlings reported · top 7 species">
          {species.length ? (
            <ResponsiveContainer width="100%" height={270}>
              <BarChart data={species} margin={{ top: 8, right: 10, bottom: 48, left: 0 }}>
                <CartesianGrid stroke="#edf1ed" vertical={false} />
                <XAxis dataKey="name" angle={-28} textAnchor="end" interval={0} height={70} tick={{ fontSize: 9, fill: "#718074" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => compactFormat.format(value)} tick={{ fontSize: 10, fill: "#849087" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip formatter={(value) => [formatNumber(value), "Seedlings"]} />
                <Bar dataKey="seedlings" fill="#d99848" radius={[5, 5, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>
        <ChartCard title="Scheme records" subtitle="Records · top 6 schemes" className="chart-wide">
          {schemes.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={schemes} margin={{ top: 8, right: 14, bottom: 35, left: 0 }}>
                <CartesianGrid stroke="#edf1ed" vertical={false} />
                <XAxis dataKey="name" angle={-20} textAnchor="end" interval={0} height={58} tick={{ fontSize: 10, fill: "#718074" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#849087" }} axisLine={false} tickLine={false} width={45} />
                <Tooltip formatter={(value) => [formatNumber(value), "Records"]} />
                <Bar dataKey="records" fill="#5784a5" radius={[5, 5, 0, 0]} maxBarSize={45} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>
      </div>
      <section className="source-strip">
        <div><span className="source-dot" /><strong>Sources</strong><span>Statistics use aggregated groups; source records and private columns are not sent to the browser.</span></div>
        <div className="source-files">{datasets.map((dataset) => <span key={dataset.source}>{dataset.fileName} <b>{formatNumber(dataset.rows.length)}</b> groups</span>)}</div>
        <small>Targets come from the district target file uploaded on the Forest Department page.</small>
      </section>
    </>
  );
}

function getDefaultColumns(dataset) {
  const preferred = [
    "Date", "District", "Circle", "Division", "Species",
    "Seedlings", "Record Count", "Year", "Scheme",
  ];
  return preferred.filter((field) => datasetColumns(dataset).includes(field));
}

function DataTable({ dataset, rows }) {
  const [query, setQuery] = useState("");
  const searchTerm = useDeferredValue(query.trim().toLocaleLowerCase());
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE);
  const defaultColumns = useMemo(() => getDefaultColumns(dataset), [dataset]);
  const columns = showAll ? datasetColumns(dataset) : defaultColumns;

  useEffect(() => setPage(0), [query, rows, pageSize]);

  const filtered = useMemo(() => {
    const result = searchTerm
      ? rows.filter((row) => row.some((value) => String(value ?? "").toLocaleLowerCase().includes(searchTerm))
        || valueAt(dataset, row, "Circle").toLocaleLowerCase().includes(searchTerm))
      : rows;
    if (!sort) return result;
    return [...result].sort((a, b) => {
      const first = valueAt(dataset, a, sort.column);
      const second = valueAt(dataset, b, sort.column);
      const firstNumber = Number(first);
      const secondNumber = Number(second);
      const comparison = first && second && Number.isFinite(firstNumber) && Number.isFinite(secondNumber)
        ? firstNumber - secondNumber
        : first.localeCompare(second, undefined, { numeric: true, sensitivity: "base" });
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [rows, searchTerm, sort, dataset]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  function toggleSort(column) {
    setSort((current) => ({
      column,
      direction: current?.column === column && current.direction === "asc" ? "desc" : "asc",
    }));
    setPage(0);
  }

  return (
    <section className="table-card">
      <div className="table-toolbar">
        <div className="table-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all fields..." />
          {query && <button aria-label="Clear search" onClick={() => setQuery("")}><X size={15} /></button>}
        </div>
        <div className="table-actions">
          <button className="button button-outline" onClick={() => setShowAll((value) => !value)}>
            <Table2 size={15} /> {showAll ? "Key fields" : `All ${datasetColumns(dataset).length} fields`}
          </button>
          <button className="button button-outline" onClick={() => downloadCsv(dataset, filtered)}>
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>{columns.map((column) => (
              <th key={column} className={`${NUMERIC_COLUMNS.has(column) ? "num" : ""} ${sort?.column === column ? "sorted" : ""}`}>
                <button onClick={() => toggleSort(column)} title={`Sort by ${column}`}>
                  {column}
                  {sort?.column === column
                    ? (sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
                    : <ArrowDownUp className="sort-muted" size={12} />}
                </button>
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={`${dataset.source}-${page * pageSize + rowIndex}`}>
                {columns.map((column) => {
                  const value = column === "Seedlings"
                    ? valueAt(dataset, row, "Seedlings") || valueAt(dataset, row, "Number of Seedlings")
                    : valueAt(dataset, row, column);
                  if (!value) return <td key={column}><span className="cell-empty">—</span></td>;
                  if (NUMERIC_COLUMNS.has(column) && Number.isFinite(Number(value))) {
                    return <td key={column} className={`num ${column === "Seedlings" ? "strong" : ""}`} title={value}>{formatNumber(Number(value))}</td>;
                  }
                  if (column === "Year") return <td key={column} title={value}><span className="year-pill">{value}</span></td>;
                  return <td key={column} title={value}>{value}</td>;
                })}
              </tr>
            ))}
            {!visibleRows.length && (
              <tr><td className="table-empty" colSpan={columns.length}><Sprout size={23} /><strong>No records found</strong><span>Try changing your filters or search.</span></td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>{filtered.length ? `${formatNumber(page * pageSize + 1)}–${formatNumber(Math.min((page + 1) * pageSize, filtered.length))}` : "0"} of {formatNumber(filtered.length)} aggregated groups ({formatNumber(filtered.reduce((total, row) => total + recordCountAt(dataset, row), 0))} records)</span>
        <div className="pagination">
          <label>Rows
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              {[25, 50, 100].map((size) => <option key={size}>{size}</option>)}
            </select>
          </label>
          <button aria-label="Previous page" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button>
          <span>Page {page + 1} of {pageCount}</span>
          <button aria-label="Next page" disabled={page >= pageCount - 1} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button>
        </div>
      </div>
    </section>
  );
}

function DatasetPage({ dataset, rows, title, description, summary, options, filters, setFilters, onClear }) {
  return (
    <>
      <SectionHeading
        eyebrow={`Data source · ${dataset.fileName}`}
        title={title}
        description={description}
        action={<button className="button button-primary" onClick={() => downloadCsv(dataset, rows)}><Download size={16} /> Download filtered CSV</button>}
      />
      <FilterBar compact options={options} filters={filters} setFilters={setFilters} onClear={onClear} />
      <div className="dataset-summary">
        <div><span>Filtered records</span><strong>{formatNumber(summary.records)}</strong></div>
        <div><span>Seedlings reported</span><strong>{formatNumber(summary.seedlings)}</strong></div>
        <div><span>Districts</span><strong>{formatNumber(summary.districts)}</strong></div>
        <div><span>Circles</span><strong>{formatNumber(summary.circles)}</strong></div>
        <div><span>Schemes</span><strong>{formatNumber(summary.schemes)}</strong></div>
      </div>
      <DataTable dataset={dataset} rows={rows} />
    </>
  );
}

const REPORT_COLUMNS = [
  { key: "forest", label: "Forest Department" },
  { key: "other", label: "Other departments" },
  { key: "palmForest", label: "Forest" },
  { key: "palmDepartments", label: "Departments" },
];

/** Which report column a row's seedlings belong to: merge is split Forest / other, palm is split Forest / departments. */
function reportBucket(dataset, row) {
  if (dataset.source === "palm") {
    return valueAt(dataset, row, "Department Type").toLocaleLowerCase() === "forest department" ? "palmForest" : "palmDepartments";
  }
  return valueAt(dataset, row, "Department").toLocaleLowerCase() === "forest department" ? "forest" : "other";
}

const REPORT_GROUPS = [...FILTER_FIELDS, "Department"];

/** The most specific department for a row: the government department if set, else Forest/Coastal/NGO/Trust etc. */
function departmentName(dataset, row) {
  const gov = valueAt(dataset, row, "Gov Department Type");
  if (gov) return gov;
  const department = dataset.source === "palm" ? "" : valueAt(dataset, row, "Department");
  if (department && department.toLocaleLowerCase() !== "other department") return department;
  return valueAt(dataset, row, "Department Type") || department || "Not specified";
}

function reportName(dataset, row, field) {
  return field === "Department" ? departmentName(dataset, row) : filterValue(dataset, row, field);
}

function Reports({ rows, options, filters, setFilters, onClear }) {
  const [reportField, setReportField] = useState("District");
  const { grouped, totals } = useMemo(() => {
    const groups = new Map();
    const sums = { forest: 0, other: 0, palmForest: 0, palmDepartments: 0, total: 0 };
    for (const { dataset, row } of rows) {
      const name = reportName(dataset, row, reportField).trim().replace(/\s+/g, " ");
      if (!name) continue;
      const seedlings = countAt(dataset, row);
      const bucket = reportBucket(dataset, row);
      // Department names are merged case-insensitively ("Police" and "POLICE" are one row).
      const key = reportField === "Department" ? name.toLocaleUpperCase("en") : name;
      const group = groups.get(key) ?? { name, forest: 0, other: 0, palmForest: 0, palmDepartments: 0, total: 0 };
      group[bucket] += seedlings;
      group.total += seedlings;
      sums[bucket] += seedlings;
      sums.total += seedlings;
      groups.set(key, group);
    }
    return {
      grouped: [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
      totals: sums,
    };
  }, [rows, reportField]);

  function downloadReport() {
    const headers = [
      reportField, "Forest Department seedlings", "Other departments seedlings",
      "Palm - Forest seedlings", "Palm - Departments seedlings", "Total seedlings", "Share of seedlings (%)",
    ];
    const reportRows = grouped.map((item) => [
      item.name, item.forest, item.other, item.palmForest, item.palmDepartments, item.total,
      totals.total ? ((item.total / totals.total) * 100).toFixed(2) : "0",
    ]);
    reportRows.push(["Total", totals.forest, totals.other, totals.palmForest, totals.palmDepartments, totals.total, "100"]);
    downloadCsv({ source: "report", headers }, reportRows, `${reportField.toLowerCase()}-seedlings-report`);
  }

  const amount = (value) => (value ? formatNumber(value) : <span className="cell-empty">—</span>);

  return (
    <>
      <SectionHeading
        eyebrow="Data exports"
        title="Reports"
        description="Seedlings by district, circle, division, year, species, scheme or department, split into Forest Department, other departments and palm."
        action={<button className="button button-primary" onClick={downloadReport}><Download size={16} /> Export report CSV</button>}
      />
      <FilterBar options={options} filters={filters} setFilters={setFilters} onClear={onClear} />
      <div className="report-controls">
        <div className="report-selector">
          <span>Group report by</span>
          <div className="select-wrap report-select">
            <select value={reportField} onChange={(event) => setReportField(event.target.value)}>
              {REPORT_GROUPS.map((field) => <option key={field}>{field}</option>)}
            </select>
            <ChevronDown size={14} />
          </div>
        </div>
        <span className="report-total">{formatNumber(totals.total)} seedlings included</span>
      </div>
      <section className="report-table-card seedling-report">
        <div className="report-table-heading">
          <div><h2>{reportField} report</h2><p>Seedlings reported by {reportField.toLowerCase()}, split by source.</p></div>
          <span>{formatNumber(grouped.length)} groups</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr className="group-header">
                <th rowSpan={2}>{reportField}</th>
                <th colSpan={2} className="group-cell">Geotagged seedlings</th>
                <th colSpan={2} className="group-cell group-palm">Palm seedlings</th>
                <th rowSpan={2} className="num total-col">Total seedlings</th>
                <th rowSpan={2} className="num">Share</th>
              </tr>
              <tr className="sub-header">
                {REPORT_COLUMNS.map((column) => (
                  <th key={column.key} className={`num ${column.key.startsWith("palm") ? "palm-col" : ""}`}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map((item, index) => (
                <tr key={item.name}>
                  <td><div className="name-cell"><RankBadge index={index} /><span>{item.name}</span></div></td>
                  {REPORT_COLUMNS.map((column) => (
                    <td key={column.key} className={`num ${column.key.startsWith("palm") ? "palm-col" : ""}`}>{amount(item[column.key])}</td>
                  ))}
                  <td className="num strong total-col">{formatNumber(item.total)}</td>
                  <ShareCell value={item.total} total={totals.total} max={grouped[0]?.total} />
                </tr>
              ))}
              {!grouped.length && (
                <tr><td className="table-empty" colSpan={7}><Sprout size={23} /><strong>No report data</strong><span>Change the filters to see available results.</span></td></tr>
              )}
              {grouped.length > 0 && (
                <tr className="totals-row">
                  <td>Total</td>
                  {REPORT_COLUMNS.map((column) => <td key={column.key} className="num">{formatNumber(totals[column.key])}</td>)}
                  <td className="num total-col">{formatNumber(totals.total)}</td>
                  <td className="num">100%</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <div className="report-note"><Leaf size={16} /><span>Geotagged “Other departments” and Palm “Departments” include government departments, NGOs, trusts and others. Palm “Forest” is palm planted by the Forest Department.</span></div>
    </>
  );
}

export default function App() {
  const [session, setSession] = useState(loadSession);
  const [notice, setNotice] = useState("");

  function handleLogin(nextSession) {
    saveSession(nextSession);
    setNotice("");
    setSession(nextSession);
  }

  function handleLogout(message = "") {
    saveSession(null);
    setNotice(message);
    setSession(null);
  }

  if (!session) return <LoginPage onLogin={handleLogin} notice={notice} />;
  return <Dashboard key={session.token} session={session} onLogout={handleLogout} />;
}

const DEPARTMENT_NAV_ITEMS = [{ id: "gov-departments", label: "Department dashboard", icon: Building2 }];

function Dashboard({ session, onLogout }) {
  const isAdmin = session.role === "admin";
  const navItems = isAdmin ? NAV_ITEMS : DEPARTMENT_NAV_ITEMS;
  const [datasets, setDatasets] = useState([]);
  const [activePage, setActivePage] = useState(isAdmin ? "overview" : "gov-departments");
  const [selectedDivision, setSelectedDivision] = useState("");
  const [selectedGovDepartment, setSelectedGovDepartment] = useState("all");
  const [govYear, setGovYear] = useState(() => currentReportingYear());
  const [govDistrict, setGovDistrict] = useState("all");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [progress, setProgress] = useState({ merge: 0, palm: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState("");
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState("");
  const [syncWarning, setSyncWarning] = useState("");
  const [error, setError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mapState, setMapState] = useState({ status: "idle", points: [], available: true, error: "" });
  const hasDataRef = useRef(false);
  const syncInProgressRef = useRef(false);

  async function loadData(forceRefresh = false) {
    if (syncInProgressRef.current) return;
    syncInProgressRef.current = true;
    const hasData = hasDataRef.current;
    setLoading(!hasData);
    setRefreshing(hasData);
    setError("");
    setSyncWarning("");
    setProgress({ merge: 0, palm: 0 });
    try {
      const loaded = await refreshDashboardData(({ source, rows }) => {
        setProgress((current) => ({ ...current, [source]: rows }));
      }, { forceRefresh, token: session.token });
      setDatasets(loaded.datasets);
      hasDataRef.current = true;
      setLastSyncedAt(loaded.lastSyncedAt ?? "");
      setSourceUpdatedAt(loaded.sourceUpdatedAt ?? "");
      setSyncWarning(loaded.warning);
      // Reload map points after a manual refresh, or when the old cache had no map data yet.
      setMapState((current) => (
        current.status === "ready" && (forceRefresh || !current.available)
          ? { status: "idle", points: [], available: true, error: "" }
          : current
      ));
    } catch (loadError) {
      if (loadError instanceof UnauthorizedError) {
        onLogout(loadError.message);
        return;
      }
      const message = loadError.message || "An unexpected error occurred while loading dashboard data.";
      if (hasData) setSyncWarning(message);
      else setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      syncInProgressRef.current = false;
    }
  }

  useEffect(() => {
    loadData();
    const intervalId = window.setInterval(() => loadData(), AUTO_REFRESH_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") loadData();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  async function loadMapPoints() {
    setMapState({ status: "loading", points: [], available: true, error: "" });
    try {
      const { points, available } = await fetchMapPoints(session.token);
      for (const point of points) {
        point.category = mapCategory(point);
        point.districtKey = point.district.trim().replace(/\s+/g, " ").toLocaleUpperCase("en");
      }
      setMapState({ status: "ready", points, available, error: "" });
    } catch (mapError) {
      if (mapError instanceof UnauthorizedError) {
        onLogout(mapError.message);
        return;
      }
      setMapState({ status: "error", points: [], available: true, error: mapError.message || "Map data could not be loaded." });
    }
  }

  const pageNeedsMap = activePage === "planting-map" || activePage === "gov-departments";
  useEffect(() => {
    if (pageNeedsMap && !loading && mapState.status === "idle") loadMapPoints();
  }, [pageNeedsMap, loading, mapState.status]);

  const options = useMemo(() => {
    const values = Object.fromEntries(FILTER_FIELDS.map((field) => [field, new Set()]));
    for (const dataset of datasets) {
      for (const row of dataset.rows) {
        for (const field of FILTER_FIELDS) {
          const value = filterValue(dataset, row, field);
          if (value) values[field].add(value);
        }
      }
    }
    return Object.fromEntries(FILTER_FIELDS.map((field) => [field, [...values[field]].sort((a, b) => a.localeCompare(b))]));
  }, [datasets]);

  const filteredDatasets = useMemo(
    () => datasets.map((dataset) => ({ ...dataset, filteredRows: dataset.rows.filter((row) => matchesFilters(dataset, row, filters)) })),
    [datasets, filters],
  );
  const chartRows = useMemo(
    () => filteredDatasets.flatMap((dataset) => dataset.filteredRows.map((row) => ({ dataset, row }))),
    [filteredDatasets],
  );
  const allRows = useMemo(
    () => datasets.flatMap((dataset) => dataset.rows.map((row) => ({ dataset, row }))),
    [datasets],
  );
  const summary = useMemo(() => summarize(chartRows), [chartRows]);
  const datasetSummaries = useMemo(
    () => filteredDatasets.map((dataset) => ({ ...dataset, summary: summarize(dataset.filteredRows.map((row) => ({ dataset, row }))) })),
    [filteredDatasets],
  );

  function clearFilters() {
    setFilters({ ...DEFAULT_FILTERS });
  }

  function viewDivisionDetails(division) {
    setSelectedDivision(division);
    setActivePage("division-details");
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function viewOtherDepartmentDetails() {
    setActivePage("other-department-details");
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function viewGovDepartment(department) {
    setSelectedGovDepartment(department);
    if (filters.Year !== "all") setGovYear(filters.Year);
    setGovDistrict("all");
    setActivePage("gov-departments");
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function viewForestDepartmentDetails() {
    setActivePage("forest-department-details");
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function viewPalmDetails() {
    setActivePage("palm-details");
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loading || error) return <LoadingScreen progress={progress} error={error} onRetry={() => loadData()} />;

  const merge = datasetSummaries.find((dataset) => dataset.source === "merge");
  const palm = datasetSummaries.find((dataset) => dataset.source === "palm");

  return (
    <div className="app-shell">
      {mobileNavOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-emblem"><Leaf size={23} /></div>
          <div><strong>Green Tamil Nadu</strong><span>{isAdmin ? "FOREST DEPARTMENT" : "DEPARTMENT LOGIN"}</span></div>
          <button className="mobile-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={20} /></button>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="side-nav">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activePage === id ? "nav-item active" : "nav-item"} onClick={() => { setActivePage(id); setMobileNavOpen(false); }}>
            <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mission-card"><div className="mission-icon"><Sprout size={17} /></div><strong>Growing a greener future</strong><span>Planting data for a thriving Tamil Nadu.</span></div>
          <div className="sidebar-foot"><span className="sidebar-status" /> PRIVATE DATA API <span>v1.0</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
            <div className="breadcrumb"><span>Green Tamil Nadu</span><span className="crumb-slash">/</span><strong>{activePage === "division-details" ? selectedDivision : activePage === "other-department-details" ? "Other departments" : activePage === "forest-department-details" ? "Forest Department" : activePage === "palm-details" ? "Palm seedlings" : navItems.find((item) => item.id === activePage)?.label}</strong></div>
          </div>
          <div className="topbar-right">
            {(sourceUpdatedAt || lastSyncedAt) && (
              <div className="data-status" title="Private GitHub data">
                <span className="sync-dot" />
                <div>
                  <strong>Private data updated {formatDateTime(sourceUpdatedAt || lastSyncedAt)}</strong>
                  {lastSyncedAt && <span>Last synced {formatDateTime(lastSyncedAt)}</span>}
                </div>
              </div>
            )}
            <button className="button button-outline refresh-button" disabled={refreshing} onClick={() => loadData(true)}><RefreshCw className={refreshing ? "spin" : ""} size={15} /> {refreshing ? "Refreshing…" : "Refresh data"}</button>
            <span className="session-badge" title={isAdmin ? "Administrator" : session.department}>
              {isAdmin ? "Admin" : session.department}
            </span>
            <button className="button button-outline" onClick={() => onLogout()}><LogOut size={15} /> Log out</button>
          </div>
        </header>

        <div className="page-content">
          {syncWarning && <div className="sync-notice" role="status">{syncWarning}</div>}
          {isAdmin && activePage === "overview" && (
            <Overview
              summary={summary}
              chartRows={chartRows}
              filters={filters}
              options={options}
              setFilters={setFilters}
              onClear={clearFilters}
              datasets={datasets}
              onViewDivision={viewDivisionDetails}
              onViewForestDepartment={viewForestDepartmentDetails}
              onViewOtherDepartments={viewOtherDepartmentDetails}
              onViewPalmDetails={viewPalmDetails}
            />
          )}
          {isAdmin && activePage === "forest-department-details" && (
            <LocationSeedlingDetails
              title="Forest Department"
              rows={chartRows.filter(({ dataset, row }) => (
                dataset.source !== "palm"
                && valueAt(dataset, row, "Department").toLocaleLowerCase() === "forest department"
              ))}
              onBack={() => setActivePage("overview")}
            />
          )}
          {isAdmin && activePage === "palm-details" && (
            <LocationSeedlingDetails
              title="Palm seedlings"
              rows={chartRows.filter(({ dataset }) => dataset.source === "palm")}
              onBack={() => setActivePage("overview")}
            />
          )}
          {isAdmin && activePage === "division-details" && selectedDivision && (
            <DivisionDetails
              division={selectedDivision}
              rows={chartRows.filter(({ dataset, row }) => (
                dataset.source !== "palm" && valueAt(dataset, row, "Division") === selectedDivision
              ))}
              onBack={() => setActivePage("overview")}
            />
          )}
          {isAdmin && activePage === "other-department-details" && (
            <OtherDepartmentDetails
              rows={chartRows.filter(({ dataset, row }) => (
                dataset.source !== "palm"
                && valueAt(dataset, row, "Department").toLocaleLowerCase() !== "forest department"
              ))}
              filters={filters}
              setFilters={setFilters}
              options={options}
              onBack={() => setActivePage("overview")}
              onViewGovDepartment={viewGovDepartment}
            />
          )}
          {activePage === "gov-departments" && (
            <GovDepartmentDashboard
              rows={allRows}
              department={selectedGovDepartment}
              setDepartment={(department) => {
                setSelectedGovDepartment(department);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              year={govYear}
              setYear={(year) => {
                setGovYear(year);
                setGovDistrict("all");
              }}
              district={govDistrict}
              setDistrict={setGovDistrict}
              lockedDepartment={isAdmin ? "" : session.department}
              mapState={mapState}
              onRetryMap={loadMapPoints}
            />
          )}
          {isAdmin && activePage === "planting-map" && (
            <MapPage rows={allRows} mapState={mapState} onRetry={loadMapPoints} isAdmin={isAdmin} />
          )}
          {isAdmin && activePage === "merge" && merge && (
            <DatasetPage dataset={merge} rows={merge.filteredRows} title="Merge data" description="Browse privacy-safe aggregated groups from merge.csv. Search, filter and export the public summary data." summary={merge.summary} options={options} filters={filters} setFilters={setFilters} onClear={clearFilters} />
          )}
          {isAdmin && activePage === "palm" && palm && (
            <DatasetPage dataset={palm} rows={palm.filteredRows} title="Palm data" description="Browse privacy-safe aggregated groups from palm.csv with the same district, division, species and scheme filters." summary={palm.summary} options={options} filters={filters} setFilters={setFilters} onClear={clearFilters} />
          )}
          {isAdmin && activePage === "reports" && (
            <Reports
              rows={chartRows}
              options={options}
              filters={filters}
              setFilters={setFilters}
              onClear={clearFilters}
            />
          )}
          <footer className="page-footer">
            <span>Green Tamil Nadu Mission <span className="footer-separator">·</span> Forest Department</span>
            <span>Source files: merge.csv &amp; palm.csv <span className="footer-separator">·</span> Aggregated data only</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
