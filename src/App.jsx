import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Activity,
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
  X,
} from "lucide-react";
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

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "merge", label: "Merge data", icon: Table2 },
  { id: "palm", label: "Palm data", icon: TreePine },
  { id: "reports", label: "Reports", icon: FileBarChart },
];
const FILTER_FIELDS = ["District", "Division", "Year", "Species", "Scheme"];
const FILTER_LABELS = {
  District: "districts",
  Division: "divisions",
  Year: "years",
  Species: "species",
  Scheme: "schemes",
};
const DEFAULT_FILTERS = {
  District: "all",
  Division: "all",
  Year: "all",
  Species: "all",
  Scheme: "all",
};
const COLORS = ["#248451", "#69a879", "#d99545", "#5784a5", "#9d75b6", "#d16d52"];
const ROWS_PER_PAGE = 25;

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
  return index < 0 ? "" : String(row[index] ?? "").trim();
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

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(dataset, rows, suffix = "filtered") {
  const chunks = ["\uFEFF", `${dataset.headers.map(csvEscape).join(",")}\r\n`];
  for (let offset = 0; offset < rows.length; offset += 1000) {
    chunks.push(
      rows
        .slice(offset, offset + 1000)
        .map((row) => dataset.headers.map((_, index) => csvEscape(row[index])).join(","))
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
  const divisions = new Set();
  const species = new Set();
  const schemes = new Set();

  for (const { dataset, row } of datasetRows) {
    records += 1;
    seedlings += countAt(dataset, row);
    area += areaAt(dataset, row);
    for (const [set, field] of [
      [districts, "District"],
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

function StatCard({ title, value, note, icon: Icon, tone = "green" }) {
  return (
    <article className="stat-card">
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

function Overview({ summary, chartRows, filters, options, setFilters, onClear, datasets }) {
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
        <StatCard title="Planting records" value={formatNumber(summary.records)} note="Across both local files" icon={Sprout} />
        <StatCard title="Seedlings reported" value={formatNumber(summary.seedlings)} note="Summed from available count fields" icon={TreePine} tone="mint" />
        <StatCard title="Districts covered" value={formatNumber(summary.districts)} note="With district information" icon={MapPin} tone="gold" />
        <StatCard title="Species recorded" value={formatNumber(summary.species)} note="English-name variants included" icon={Leaf} tone="blue" />
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
                <Tooltip formatter={(value) => [formatNumber(value), "Records"]} />
                <Bar dataKey="records" fill="#6ba77b" radius={[0, 5, 5, 0]} maxBarSize={20} />
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
    "Date", "District", "Division", "Species",
    "Seedlings", "Year", "Scheme", "Report ID",
  ];
  return preferred.filter((field) => indexOf(dataset, field) >= 0);
}

function DataTable({ dataset, rows }) {
  const [query, setQuery] = useState("");
  const searchTerm = useDeferredValue(query.trim().toLocaleLowerCase());
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE);
  const defaultColumns = useMemo(() => getDefaultColumns(dataset), [dataset]);
  const columns = showAll ? dataset.headers : defaultColumns;

  useEffect(() => setPage(0), [query, rows, pageSize]);

  const filtered = useMemo(() => {
    const result = searchTerm
      ? rows.filter((row) => row.some((value) => String(value ?? "").toLocaleLowerCase().includes(searchTerm)))
      : rows;
    if (!sort) return result;
    const sortIndex = indexOf(dataset, sort.column);
    if (sortIndex < 0) return result;
    return [...result].sort((a, b) => {
      const first = String(a[sortIndex] ?? "").trim();
      const second = String(b[sortIndex] ?? "").trim();
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
            <Table2 size={15} /> {showAll ? "Key fields" : `All ${dataset.headers.length} fields`}
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
        description="Explore district, division, year, species and scheme summaries from the filtered records."
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
            <div className="breadcrumb"><span>Green Tamil Nadu</span><span className="crumb-slash">/</span><strong>{NAV_ITEMS.find((item) => item.id === activePage)?.label}</strong></div>
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
