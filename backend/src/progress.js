/**
 * Progress abstract (like the mission's daily update sheet): current-year DAAP and APO targets vs
 * geotagged till date, split by each record's Date: "today" = records dated today (India time),
 * "as on yesterday" = total minus today.
 */
export const PROGRESS_YEAR = "2026-2027";

export const FRUIT_SPECIES = [
  "Mango", "Indian Gooseberry", "Malabar Plum / Jamun", "Tamarind tree", "Lemon", "Psidium guajava", "Jack fruit tree",
  "Custard Apple", "Fig", "Punica granatum", "Sapota/Chiko", "Limonia acidissima", "Bengal quince", "Soursop",
  "Common jujube", "Anacardium occidentale",
];
// Timber / farm-forestry species (Silver Oak and Sandal wood have their own rows).
export const AGROFORESTRY_SPECIES = [
  "Teak", "Mahogany", "Malabar Neem wood", "Melia azedarach", "Casuarina junghuhniana", "Red sanders", "Rose wood",
  "White kashmir teak", "Eucalyptus", "Indian Kino tree", "Thornt Bamboo", "Senegal mahogany", "Neolamarckia cadamba",
];
const lower = (list) => new Set(list.map((name) => name.toLocaleLowerCase("en")));
const FRUIT_KEYS = lower(FRUIT_SPECIES);

// Agroforestry is counted by bag size and scheme, not by a species list.
export const AGROFORESTRY_BAG = "13 x 25";
export const AGROFORESTRY_EXCLUDED = ["Casuarina", "Mangrove"];
// Silver Oak and Sandalwood have their own APO rows, so they are not counted again under Agroforestry.
// These are keywords to match in species names (e.g., "sandal" matches "Sandal wood" and "Sandalwood").
export const AGROFORESTRY_OWN_ROW_KEYWORDS = ["silver oak", "sandal"];
export const AGROFORESTRY_SCHEMES = ["Green Tamil Nadu Mission", "Green Tamilnadu Mission - Bio-shields"];
const AGROFORESTRY_SCHEME_KEYS = lower(AGROFORESTRY_SCHEMES);
const normalise = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");

/**
 * Progress rows that need columns outside the main aggregate (Bag Type). The CSV aggregator
 * applies these per record and keeps only rule id, Year and Date totals (server-side only).
 */
export const BAG_PROGRESS_RULES = [
  {
    id: "sandalwood",
    match: ({ species, scheme, bagType }) => {
      const name = normalise(species);
      return /\b16\s*x\s*30\b/.test(normalise(bagType))
        && name.includes("sandal")
        && AGROFORESTRY_SCHEME_KEYS.has(normalise(scheme));
    },
  },
  {
    id: "silverOak",
    match: ({ species, scheme, bagType }) => {
      const name = normalise(species);
      return /\b13\s*x\s*25\b/.test(normalise(bagType))
        && name.includes("silver oak")
        && AGROFORESTRY_SCHEME_KEYS.has(normalise(scheme));
    },
  },
  {
    id: "fruit",
    match: ({ species, scheme, bagType }) => {
      const name = normalise(species);
      return /\b16\s*x\s*30\b/.test(normalise(bagType))
        && !AGROFORESTRY_EXCLUDED.some((excluded) => name.includes(excluded.toLocaleLowerCase("en")))
        && !AGROFORESTRY_OWN_ROW_KEYWORDS.some((keyword) => name.includes(keyword))
        && AGROFORESTRY_SCHEME_KEYS.has(normalise(scheme));
    },
  },
  {
    id: "agroforestry",
    match: ({ species, scheme, bagType }) => {
      const name = normalise(species);
      return /\b13\s*x\s*25\b/.test(normalise(bagType))
        && !AGROFORESTRY_EXCLUDED.some((excluded) => name.includes(excluded.toLocaleLowerCase("en")))
        && !AGROFORESTRY_OWN_ROW_KEYWORDS.some((keyword) => name.includes(keyword))
        && AGROFORESTRY_SCHEME_KEYS.has(normalise(scheme));
    },
  },
  {
    id: "urbanPlanting",
    match: ({ species, scheme, bagType }) => {
      const name = normalise(species);
      return /\b30\s*x\s*45\b/.test(normalise(bagType))
        && !AGROFORESTRY_EXCLUDED.some((excluded) => name.includes(excluded.toLocaleLowerCase("en")))
        && !AGROFORESTRY_OWN_ROW_KEYWORDS.some((keyword) => name.includes(keyword))
        && AGROFORESTRY_SCHEME_KEYS.has(normalise(scheme));
    },
  },
];

export const DAAP_ROWS = [
  { id: "planting", name: "DAAP Planting", target: 34700000 },
  { id: "palm", name: "Palm (GTM + Udhavi)", target: 10000000 },
  { id: "palmGtm", name: "of which GTM geotagged", sub: true },
  { id: "palmUdhavi", name: "of which Udhavi geotagged", sub: true },
  { id: "overall", name: "Overall geotagged (all years)" },
];

export const APO_ROWS = [
  { id: "sandalwood", name: "Sandalwood", target: 510000, bagRule: true, note: `16 x 30 cm bag, Sandalwood, year 2026-27, scheme ${AGROFORESTRY_SCHEMES.join(" or ")}` },
  { id: "palmyrah", name: "Palmyrah", target: 1048000, sameAs: "palm", note: "All palm: GTM (Forest Department and other departments) + Udhavi" },
  { id: "silverOak", name: "Silver Oak", target: 1000000, bagRule: true, note: `${AGROFORESTRY_BAG} cm bag, Silver Oak, scheme ${AGROFORESTRY_SCHEMES.join(" or ")}; excess beyond the target goes to Agroforestry` },
  { id: "fruit", name: "Fruit Bearing", target: 1241000, bagRule: true, note: `16 x 30 cm bag, All except Casuarina & Mangrove, year 2026-27, scheme ${AGROFORESTRY_SCHEMES.join(" or ")}` },
  { id: "agroforestry", name: "Agroforestry", target: 1795000, bagRule: true, note: `${AGROFORESTRY_BAG} cm bag, All except Casuarina & Mangrove, year 2026-27, scheme ${AGROFORESTRY_SCHEMES.join(" or ")}; plus Silver Oak geotagged beyond the Silver Oak target` },
  { id: "urbanPlanting", name: "Urban Planting", target: 300000, bagRule: true, note: `30 x 45 cm bag, All except Casuarina & Mangrove, year 2026-27, scheme ${AGROFORESTRY_SCHEMES.join(" or ")}` },
];

/** Calendar date (YYYY-MM-DD) in India, so "today" changes at midnight IST. */
export function indiaDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * Total and today's geotagged for every progress row, using each record's Date.
 * Udhavi has no dates, so its "today" is null.
 */
export function progressValues(payload, udhaviSeeds, today, year = PROGRESS_YEAR) {
  const datasets = Object.fromEntries(payload.datasets.map((dataset) => [dataset.source, dataset]));
  function sum(source, keep) {
    const result = { total: 0, today: 0 };
    const dataset = datasets[source];
    if (!dataset) return result;
    const index = (name) => dataset.headers.indexOf(name);
    const columns = { year: index("Year"), species: index("Species"), department: index("Department Type"), date: index("Date"), seedlings: index("Seedlings") };
    for (const row of dataset.rows) {
      if (!keep(row, columns)) continue;
      const count = Number(row[columns.seedlings]) || 0;
      result.total += count;
      if (columns.date >= 0 && String(row[columns.date] ?? "").slice(0, 10) === today) result.today += count;
    }
    return result;
  }
  const inYear = (row, columns) => row[columns.year] === year;
  // Totals from the server-side per-rule aggregate (rows: Rule, Year, Date, Seedlings, Record Count).
  function sumBagRule(id) {
    const result = { total: 0, today: 0 };
    const progressBags = datasets.merge?.progressBags;
    if (!progressBags) return result;
    for (const [rule, ruleYear, date, seedlings] of progressBags.rows) {
      if (rule !== id || ruleYear !== year) continue;
      const count = Number(seedlings) || 0;
      result.total += count;
      if (date === today) result.today += count;
    }
    return result;
  }
  const values = {
    planting: sum("merge", inYear),
    palmGtm: sum("palm", inYear),
    palmUdhavi: { total: Number.isFinite(udhaviSeeds) ? udhaviSeeds : null, today: null },
    overall: sum("merge", () => true),
  };
  values.palm = {
    total: values.palmUdhavi.total === null ? null : values.palmGtm.total + values.palmUdhavi.total,
    today: values.palmGtm.today,
  };
  for (const item of APO_ROWS) {
    if (item.sameAs) {
      values[item.id] = { ...values[item.sameAs] };
      continue;
    }
    if (item.bagRule) {
      values[item.id] = sumBagRule(item.id);
      continue;
    }
    values[item.id] = sum(item.source, (row, columns) => {
      if (!inYear(row, columns)) return false;
      return item.match(String(row[columns.species] ?? "").trim().toLocaleLowerCase("en"));
    });
  }
  const silverTarget = APO_ROWS.find((row) => row.id === "silverOak").target;
  const silver = values.silverOak;
  const silverAsOn = silver.total - silver.today;
  const capped = (count) => Math.min(count, silverTarget);
  const extra = (count) => Math.max(0, count - silverTarget);
  values.silverOak = { total: capped(silver.total), today: capped(silver.total) - capped(silverAsOn) };
  values.silverOakExtra = { total: extra(silver.total), today: extra(silver.total) - extra(silverAsOn) };
  values.agroforestry = {
    total: values.agroforestry.total + values.silverOakExtra.total,
    today: values.agroforestry.today + values.silverOakExtra.today,
  };
  return values;
}

/** The progress report sent to admin sessions. */
export function buildProgressReport(payload, udhavi, { now = new Date(), year = PROGRESS_YEAR } = {}) {
  const today = indiaDate(now);
  const yesterday = indiaDate(new Date(now.valueOf() - 24 * 60 * 60 * 1000));
  const udhaviSeeds = udhavi && !udhavi.error ? Number(udhavi.totalSeeds) : null;
  const values = progressValues(payload, udhaviSeeds, today, year);
  const line = ({ id, name, target = 0, sub = false, note = "" }) => {
    const { total, today: todayCount } = values[id];
    const asOn = total === null ? null : todayCount === null ? total : total - todayCount;
    return { id, name, target, sub, note, asOn, today: todayCount, total };
  };
  return {
    year,
    today,
    baselineDay: yesterday,
    udhaviError: udhavi?.error ?? null,
    daap: DAAP_ROWS.map(line),
    apo: APO_ROWS.map(line),
    fruitSpecies: FRUIT_SPECIES,
    agroforestrySpecies: AGROFORESTRY_SPECIES,
    agroforestryRule: APO_ROWS.find((row) => row.id === "agroforestry").note,
    silverOakExtra: values.silverOakExtra.total,
    agroforestryAvailable: Boolean(payload.datasets.find((dataset) => dataset.source === "merge")?.progressBags),
  };
}