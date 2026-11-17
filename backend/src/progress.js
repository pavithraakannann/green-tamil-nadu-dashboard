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
const AGROFORESTRY_KEYS = lower(AGROFORESTRY_SPECIES);

export const DAAP_ROWS = [
  { id: "planting", name: "DAAP Planting", target: 34700000 },
  { id: "palm", name: "Palm (GTM + Udhavi)", target: 10000000 },
  { id: "palmGtm", name: "of which GTM geotagged", sub: true },
  { id: "palmUdhavi", name: "of which Udhavi geotagged", sub: true },
  { id: "overall", name: "Overall geotagged (all years)" },
];

export const APO_ROWS = [
  { id: "sandalwood", name: "Sandalwood", target: 510000, source: "merge", match: (species) => species.includes("sandal"), note: "Species: Sandal wood" },
  { id: "palmyrah", name: "Palmyrah", target: 1048000, sameAs: "palm", note: "All palm: GTM (Forest Department and other departments) + Udhavi" },
  { id: "silverOak", name: "Silver Oak", target: 1000000, source: "merge", match: (species) => species === "silver oak", note: "Species: Silver Oak" },
  { id: "fruit", name: "Fruit Bearing", target: 1241000, source: "merge", match: (species) => FRUIT_KEYS.has(species), note: `Species: ${FRUIT_SPECIES.join(", ")}` },
  { id: "agroforestry", name: "Agroforestry", target: 1795000, source: "merge", match: (species) => AGROFORESTRY_KEYS.has(species), note: `Species: ${AGROFORESTRY_SPECIES.join(", ")}` },
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
    values[item.id] = sum(item.source, (row, columns) => {
      if (!inYear(row, columns)) return false;
      return item.match(String(row[columns.species] ?? "").trim().toLocaleLowerCase("en"));
    });
  }
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
  };
}
