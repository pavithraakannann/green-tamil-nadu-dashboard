import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileBarChart,
  FilterX,
  Leaf,
  LoaderCircle,
  MapPin,
  Menu,
  RefreshCw,
  Search,
  Sprout,
  Table2,
  TreePine,
  Upload,
  X,
} from "lucide-react";
import Papa from "papaparse";
import {
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
import { refreshDashboardData } from "./dataService.js";
import { circleForDivision } from "./divisionCircles.js";

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "merge", label: "Merge data", icon: Table2 },
  { id: "palm", label: "Palm data", icon: TreePine },
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
const DISTRICT_TARGETS_STORAGE_KEY = "green-tamil-nadu-district-targets-v2";
const LEGACY_DISTRICT_TARGETS_STORAGE_KEY = "green-tamil-nadu-district-targets-v1";

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

function areaAt(dataset, row) {
  const area = valueAt(dataset, row, "Land parcel area") || valueAt(dataset, row, "Total Area");
  const value = Number(area.replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function filterValue(dataset, row, field) {
  return field === "Species" ? speciesAt(dataset, row) : valueAt(dataset, row, field);
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
    records += 1;
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
    group.records += 1;
    group.seedlings += countAt(dataset, row);
    groups.set(label, group);
  }

  return [...groups.values()]
    .sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name));
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
          <small>Expected sanitized files: public/data/merge.csv.gz and public/data/palm.csv.gz</small>
        </div>
      ) : (
        <div className="loading-card">
          <LoaderCircle className="spin loading-spinner" size={30} />
          <h1>Preparing your dashboard</h1>
          <p>Reading the local planting records. Large files may take a moment.</p>
          {totalRows > 0 && <span className="loading-count">{formatNumber(totalRows)} rows parsed</span>}
        </div>
      )}
    </main>
  );
}

function StatCard({ title, value, note, icon: Icon, tone = "green", onClick }) {
  return (
    <article
      className={`stat-card ${onClick ? "stat-card-clickable" : ""}`}
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
      <Activity className="stat-spark" size={30} />
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
        <span className="chart-menu"><ArrowDownUp size={15} /></span>
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
      group.records += 1;
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
        <div><span>Planting records</span><strong>{formatNumber(rows.length)}</strong></div>
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
            <thead><tr><th>Species</th><th>Scheme</th><th>Seedlings reported</th><th>Planting records</th></tr></thead>
            <tbody>
              {groups.map((group) => (
                <tr key={`${group.species}-${group.scheme}`}>
                  <td>{group.species}</td>
                  <td>{group.scheme}</td>
                  <td>{formatNumber(group.seedlings)}</td>
                  <td>{formatNumber(group.records)}</td>
                </tr>
              ))}
              {!groups.length && (
                <tr><td className="table-empty" colSpan={4}><Sprout size={23} /><strong>No planting records found</strong><span>Change the dashboard filters and try again.</span></td></tr>
              )}
              {groups.length > 0 && (
                <tr className="totals-row"><td colSpan={2}>Total</td><td>{formatNumber(totalSeedlings)}</td><td>{formatNumber(rows.length)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function DepartmentBreakdown({ rows, field, title }) {
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
        <thead><tr><th>{title}</th><th>Seedlings reported</th></tr></thead>
        <tbody>
          {grouped.map((group) => (
            <tr key={group.name}>
              <td>{group.name}</td>
              <td>{formatNumber(group.seedlings)}</td>
            </tr>
          ))}
          {!grouped.length && (
            <tr><td className="table-empty" colSpan={2}><Sprout size={23} /><strong>No {title.toLowerCase()} data found</strong><span>Change the filters and try again.</span></td></tr>
          )}
          {grouped.length > 0 && (
            <tr className="totals-row"><td>Total seedlings</td><td>{formatNumber(totalSeedlings)}</td></tr>
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
            <tr><th>Circle</th><th>District</th><th>Seedlings reported</th><th>Target</th></tr>
          </thead>
          <tbody>
            {grouped.map((group) => {
              const target = targetsByDistrict[normalizeDistrictName(group.district)];

              return (
                <tr key={`${group.circle}-${group.district}`}>
                  <td>{group.circle}</td>
                  <td>{group.district}</td>
                  <td>{group.seedlings === null ? "-" : formatNumber(group.seedlings)}</td>
                  <td>{selectedYear === "all"
                    ? "Select a year"
                    : target === undefined ? "-" : formatNumber(target.target)}</td>
                </tr>
              );
            })}
            {!grouped.length && (
              <tr><td className="table-empty" colSpan={4}><Sprout size={23} /><strong>No location data found</strong><span>Change the filters and try again.</span></td></tr>
            )}
            {hasSeedlingRows && (
              <tr className="totals-row"><td colSpan={2}>Total seedlings</td><td>{formatNumber(totalSeedlings)}</td><td>—</td></tr>
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

function OtherDepartmentDetails({ rows, filters, setFilters, options, onBack }) {
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
        <DepartmentBreakdown rows={rows} field="Gov Department Type" title="Government Department Type" />
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
  const sources = datasets.map((dataset) => ({
    name: dataset.source === "merge" ? "Merge data" : "Palm data",
    value: dataset.rows.filter((row) => matchesFilters(dataset, row, filters)).length,
  })).filter((item) => item.value > 0);

  return (
    <>
      <SectionHeading
        eyebrow="Green Tamil Nadu Mission"
        title="Planting overview"
        description="A clear view of planting activity across Tamil Nadu."
        action={<span className="live-badge"><span /> Local CSV data</span>}
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
        <div><span className="source-dot" /><strong>Sources</strong><span>Statistics are calculated from original local CSV records.</span></div>
        <div className="source-files">{datasets.map((dataset) => <span key={dataset.source}>{dataset.fileName} <b>{formatNumber(dataset.rows.length)}</b></span>)}</div>
        <small>Target and achievement fields are not present in the supplied files.</small>
      </section>
    </>
  );
}

function getDefaultColumns(dataset) {
  const preferred = [
    "Date", "District", "Circle", "Division", "Species",
    "Seedlings", "Year", "Scheme", "Report ID",
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
              <th key={column}>
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
                  return <td key={column} title={value}>{value || <span className="cell-empty">—</span>}</td>;
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
        <span>{filtered.length ? `${formatNumber(page * pageSize + 1)}–${formatNumber(Math.min((page + 1) * pageSize, filtered.length))}` : "0"} of {formatNumber(filtered.length)} records</span>
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

function Reports({ datasets, rows, summary, options, filters, setFilters, onClear }) {
  const [reportField, setReportField] = useState("District");
  const grouped = useMemo(() => groupData(rows, reportField, "seedlings"), [rows, reportField]);
  const reportRows = grouped.map((item) => [item.name, item.records, item.seedlings]);
  const reportDataset = useMemo(() => ({
    source: "report",
    fileName: "green-tamil-nadu-report.csv",
    headers: [reportField, "Records", "Seedlings reported"],
    rows: reportRows,
  }), [reportField, reportRows]);
  const downloadReport = () => downloadCsv(reportDataset, reportRows, `${reportField.toLowerCase()}-report`);

  return (
    <>
      <SectionHeading
        eyebrow="Data exports"
        title="Reports"
        description="Explore district, circle, division, year, species and scheme summaries from the filtered records."
        action={<button className="button button-primary" onClick={downloadReport}><Download size={16} /> Export report CSV</button>}
      />
      <FilterBar options={options} filters={filters} setFilters={setFilters} onClear={onClear} />
      <div className="report-controls">
        <div className="report-selector">
          <span>Group report by</span>
          <div className="select-wrap report-select">
            <select value={reportField} onChange={(event) => setReportField(event.target.value)}>
              {FILTER_FIELDS.map((field) => <option key={field}>{field}</option>)}
            </select>
            <ChevronDown size={14} />
          </div>
        </div>
        <span className="report-total">{formatNumber(summary.records)} records included</span>
      </div>
      <section className="report-table-card">
        <div className="report-table-heading"><div><h2>{reportField} report</h2><p>Records and reported seedlings by {reportField.toLowerCase()}.</p></div><span>{formatNumber(grouped.length)} groups</span></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>{reportField}</th><th>Records</th><th>Seedlings reported</th></tr></thead>
            <tbody>{grouped.map((item, index) => (
              <tr key={item.name}><td><span className="rank-cell">{String(index + 1).padStart(2, "0")}</span>{item.name}</td><td>{formatNumber(item.records)}</td><td>{formatNumber(item.seedlings)}</td></tr>
            ))}
            {!grouped.length && <tr><td className="table-empty" colSpan={3}><Sprout size={23} /><strong>No report data</strong><span>Change the filters to see available results.</span></td></tr>}
            {grouped.length > 0 && <tr className="totals-row"><td>Total · {datasets.length} sources</td><td>{formatNumber(summary.records)}</td><td>{formatNumber(summary.seedlings)}</td></tr>}
          </tbody>
          </table>
        </div>
      </section>
      <div className="report-note"><Leaf size={16} /><span>Summary metrics use the available planting count field for each record. No target or achievement fields exist in the supplied CSV files.</span></div>
    </>
  );
}

export default function App() {
  const [datasets, setDatasets] = useState([]);
  const [activePage, setActivePage] = useState("overview");
  const [selectedDivision, setSelectedDivision] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [progress, setProgress] = useState({ merge: 0, palm: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  async function loadData() {
    setLoading(true);
    setError("");
    setProgress({ merge: 0, palm: 0 });
    try {
      const loaded = await refreshDashboardData(({ source, rows }) => {
        setProgress((current) => ({ ...current, [source]: rows }));
      });
      setDatasets(loaded);
    } catch (loadError) {
      setError(loadError.message || "An unexpected error occurred while loading the CSV files.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

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

  if (loading || error) return <LoadingScreen progress={progress} error={error} onRetry={loadData} />;

  const merge = datasetSummaries.find((dataset) => dataset.source === "merge");
  const palm = datasetSummaries.find((dataset) => dataset.source === "palm");

  return (
    <div className="app-shell">
      {mobileNavOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-emblem"><Leaf size={23} /></div>
          <div><strong>Green Tamil Nadu</strong><span>FOREST DEPARTMENT</span></div>
          <button className="mobile-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={20} /></button>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="side-nav">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activePage === id ? "nav-item active" : "nav-item"} onClick={() => { setActivePage(id); setMobileNavOpen(false); }}>
            <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mission-card"><div className="mission-icon"><Sprout size={17} /></div><strong>Growing a greener future</strong><span>Planting data for a thriving Tamil Nadu.</span></div>
          <div className="sidebar-foot"><span className="sidebar-status" /> LOCAL DATA MODE <span>v1.0</span></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
            <div className="breadcrumb"><span>Green Tamil Nadu</span><span className="crumb-slash">/</span><strong>{activePage === "division-details" ? selectedDivision : activePage === "other-department-details" ? "Other departments" : activePage === "forest-department-details" ? "Forest Department" : activePage === "palm-details" ? "Palm seedlings" : NAV_ITEMS.find((item) => item.id === activePage)?.label}</strong></div>
          </div>
          <div className="topbar-right">
            <span className="topbar-source"><span /> Local CSV data</span>
            <button className="button button-outline refresh-button" onClick={loadData}><RefreshCw size={15} /> Refresh data</button>
            <div className="avatar">GT</div>
          </div>
        </header>

        <div className="page-content">
          {activePage === "overview" && (
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
          {activePage === "forest-department-details" && (
            <LocationSeedlingDetails
              title="Forest Department"
              rows={chartRows.filter(({ dataset, row }) => (
                dataset.source !== "palm"
                && valueAt(dataset, row, "Department").toLocaleLowerCase() === "forest department"
              ))}
              onBack={() => setActivePage("overview")}
            />
          )}
          {activePage === "palm-details" && (
            <LocationSeedlingDetails
              title="Palm seedlings"
              rows={chartRows.filter(({ dataset }) => dataset.source === "palm")}
              onBack={() => setActivePage("overview")}
            />
          )}
          {activePage === "division-details" && selectedDivision && (
            <DivisionDetails
              division={selectedDivision}
              rows={chartRows.filter(({ dataset, row }) => (
                dataset.source !== "palm" && valueAt(dataset, row, "Division") === selectedDivision
              ))}
              onBack={() => setActivePage("overview")}
            />
          )}
          {activePage === "other-department-details" && (
            <OtherDepartmentDetails
              rows={chartRows.filter(({ dataset, row }) => (
                dataset.source !== "palm"
                && valueAt(dataset, row, "Department").toLocaleLowerCase() !== "forest department"
              ))}
              filters={filters}
              setFilters={setFilters}
              options={options}
              onBack={() => setActivePage("overview")}
            />
          )}
          {activePage === "merge" && merge && (
            <DatasetPage dataset={merge} rows={merge.filteredRows} title="Merge data" description="Browse planting records from merge.csv. Search across all fields and export filtered records." summary={merge.summary} options={options} filters={filters} setFilters={setFilters} onClear={clearFilters} />
          )}
          {activePage === "palm" && palm && (
            <DatasetPage dataset={palm} rows={palm.filteredRows} title="Palm data" description="Browse palm planting records from palm.csv with the same district, division, species and scheme filters." summary={palm.summary} options={options} filters={filters} setFilters={setFilters} onClear={clearFilters} />
          )}
          {activePage === "reports" && (
            <Reports
              datasets={datasets}
              rows={chartRows}
              summary={summary}
              options={options}
              filters={filters}
              setFilters={setFilters}
              onClear={clearFilters}
            />
          )}
          <footer className="page-footer">
            <span>Green Tamil Nadu Mission <span className="footer-separator">·</span> Forest Department</span>
            <span>Source files: merge.csv &amp; palm.csv <span className="footer-separator">·</span> Local data only</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
