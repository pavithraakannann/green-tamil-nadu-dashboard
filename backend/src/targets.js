import targetFile from "../data/targets.json" with { type: "json" };
import palmTargetFile from "../data/palmTargets.json" with { type: "json" };
import { normalizeDepartment } from "./auth.js";
import { districtKey } from "./districtNames.js";

export { districtKey };

/**
 * Target groups: each combines one or more target-sheet columns and says which planting rows count
 * towards it. Rows are matched in this order; the first match wins. Achievement counts geotagged
 * (merge) seedlings only — palm is excluded, as agreed with the mission.
 */
export const TARGET_GROUPS = [
  { id: "forest", label: "Forest Department", columns: ["Forest Department"],
    match: ({ department }) => department === "FOREST DEPARTMENT" },
  { id: "rdpr", label: "Rural Development & Panchayat Raj (DRDA + MGNREGS)",
    columns: ["Rural Development & Panchayat Raj (DRDA)", "Forest Department & Rural Development & Panchayat Raj (MGNREGS)"],
    match: ({ gov }) => gov.includes("RURAL DEVELOPMENT") },
  { id: "agriculture", label: "Agriculture Department", columns: ["Agriculture Department"],
    match: ({ gov, department }) => gov.includes("AGRICULTURE") || department === "AGRICULTURE DEPARTMENT" },
  { id: "horticulture", label: "Horticulture Department", columns: ["Horticulture Department"],
    match: ({ gov }) => gov.includes("HORTICULTURE") },
  { id: "revenue", label: "Revenue Department", columns: ["Revenue Department"],
    match: ({ gov }) => gov.includes("REVENUE") },
  { id: "hrce", label: "Hindu Religious and Charitable Endowments", columns: ["Hindu Religious and Charitable Endowment"],
    match: ({ gov }) => gov.includes("HINDU RELIGIOUS") },
  { id: "higher-education", label: "Higher Education (All Colleges)", columns: ["Higher Education (All Colleges)"],
    match: ({ gov }) => gov.includes("HIGHER EDUCATION") || gov.includes("COLLEGE") },
  { id: "education", label: "Education Department", columns: ["Education Department"],
    match: ({ gov }) => gov.includes("EDUCATION") },
  { id: "tnpcb", label: "Tamil Nadu Pollution Control Board", columns: ["Tamil Nadu Pollution Control Board (TNPCB)"],
    match: ({ gov }) => gov.includes("POLLUTION CONTROL") },
  { id: "nhai", label: "National Highways Authority of India", columns: ["National Highways Authority of India (NHAI)"],
    match: ({ gov }) => gov.includes("NATIONAL HIGHWAYS") || gov.includes("NHAI") },
  { id: "highways", label: "Highways", columns: ["Highways"],
    match: ({ gov }) => gov.includes("HIGHWAYS") },
  { id: "municipal", label: "Municipal Administration (Corporation, Municipality & Town Panchayat)",
    columns: ["Corporation City", "Municipality and Town Panchayat"],
    match: ({ gov }) => gov.includes("MUNICIPAL") || gov.includes("CORPORATION CITY") || gov.includes("TOWN PANCHAYAT") },
  { id: "tafcorn", label: "Tamil Nadu Forest Plantation Corporation (TAFCORN)", columns: ["Tamil Nadu Forest Plantation Corporation (TAFCORN)"],
    match: ({ gov, department }) => [gov, department].some((value) => value.includes("TAFCORN") || value.includes("PLANTATION CORPORATION")) },
  { id: "animal-husbandry", label: "Animal Husbandry Department", columns: ["Animal Husbandry Dept."],
    match: ({ gov }) => gov.includes("ANIMAL HUSBANDRY") },
  { id: "pwd", label: "Public Works Department", columns: ["Public Works Department"],
    match: ({ gov }) => gov.includes("PUBLIC WORKS") },
  { id: "water-resources", label: "Water Resources Department", columns: ["TN Water Resource Department"],
    match: ({ gov }) => gov.includes("WATER RESOURCE") },
  { id: "sports", label: "Sports and Youth Welfare", columns: ["Sports and Youth Welfare"],
    match: ({ gov }) => gov.includes("SPORTS") || gov.includes("YOUTH WELFARE") },
  { id: "police", label: "Police Department", columns: ["Police Dept."],
    match: ({ gov }) => gov.includes("POLICE") },
  { id: "courts", label: "District Courts", columns: ["District Courts"],
    match: ({ gov }) => gov.includes("COURT") },
  { id: "mahalir", label: "Mahalir Thittam", columns: ["Mahalir Thittam"],
    match: ({ gov }) => gov.includes("MAHALIR") },
  { id: "mines", label: "Mines and Minerals Department", columns: ["Mines and Minerals Dept."],
    match: ({ gov }) => gov.includes("MINES") || gov.includes("GEOLOGY") },
  { id: "dgcf", label: "District Green Committee Fund", columns: ["District Green Committee Fund"],
    match: ({ gov }) => gov.includes("GREEN COMMITTEE") },
  { id: "dic", label: "District Industrial Centre", columns: ["District Industrial Centre"],
    match: ({ gov }) => gov.includes("INDUSTRIAL CENTRE") || gov.includes("INDUSTRIES CENTRE") },
  { id: "spb", label: "Seshasayee Paper and Boards (SPB)", columns: ["Seshasayee Paper and Boards (SPB)"],
    match: ({ gov }) => gov.includes("SESHASAYEE") },
  { id: "industries", label: "Industries", columns: ["Industries"],
    match: ({ gov }) => gov.includes("INDUSTRIES") || gov.includes("MICRO , SMALL") || gov.includes("MICRO, SMALL") },
  { id: "others", label: "Others (NGOs, Volunteers, etc.)", columns: ["Others (NGOs, Volunteers, etc.)"],
    match: () => true },
];

/** Which target group a planting row belongs to (by its Department / Gov Department Type). */
export function targetGroupFor({ department = "", govDepartment = "" }) {
  const facts = { department: normalizeDepartment(department), gov: normalizeDepartment(govDepartment) };
  return TARGET_GROUPS.find((group) => group.match(facts)) ?? TARGET_GROUPS[TARGET_GROUPS.length - 1];
}

/**
 * Target vs geotagged achievement for the target year, by district and target group.
 * `payload` must already be filtered for the session (see payloadForSession), so a department
 * only ever sees its own group and its own seedlings.
 */
export function buildTargetReport(payload, session, targets = targetFile) {
  let groups = TARGET_GROUPS;
  if (session.role !== "admin") {
    groups = [targetGroupFor({ govDepartment: session.department })];
  }
  const groupIds = new Set(groups.map((group) => group.id));
  const districts = targets.districts.map(({ district, targets: columnTargets }) => ({
    district,
    key: districtKey(district),
    targets: Object.fromEntries(groups.map((group) => [
      group.id,
      group.columns.reduce((total, column) => total + (columnTargets[column] ?? 0), 0),
    ])),
    achieved: Object.fromEntries(groups.map((group) => [group.id, 0])),
  }));
  const byKey = new Map(districts.map((entry) => [entry.key, entry]));
  const unmatched = new Map();
  const govGroups = {};

  const merge = payload.datasets.find((dataset) => dataset.source === "merge");
  if (merge) {
    const index = (name) => merge.headers.indexOf(name);
    const [year, district, department, gov, seedlings] = ["Year", "District", "Department", "Gov Department Type", "Seedlings"].map(index);
    for (const row of merge.rows) {
      if (year < 0 || row[year] !== targets.year) continue;
      const govName = gov < 0 ? "" : normalizeDepartment(row[gov]);
      const group = targetGroupFor({ department: department < 0 ? "" : row[department], govDepartment: govName });
      if (!groupIds.has(group.id)) continue;
      if (govName) govGroups[govName] = group.id;
      const count = Number(row[seedlings]) || 0;
      const entry = byKey.get(districtKey(row[district]));
      if (entry) entry.achieved[group.id] += count;
      else {
        const name = String(row[district] ?? "").trim() || "Not specified";
        unmatched.set(name, (unmatched.get(name) ?? 0) + count);
      }
    }
  }

  return {
    year: targets.year,
    sourceFile: targets.sourceFile,
    groups: groups.map(({ id, label, columns }) => ({ id, label, columns })),
    districts: districts.map(({ district, key, targets: groupTargets, achieved }) => ({ district, key, targets: groupTargets, achieved })),
    // Government department name (capitals) -> target group, so pages can find a department's targets.
    govGroups,
    unmatchedDistricts: [...unmatched].map(([district, achieved]) => ({ district, achieved })),
  };
}

/**
 * Palm target vs palm seedlings for the target year, by district, split into Forest Department
 * and other departments. Palm data is admin-only, so department sessions get null.
 */
export function buildPalmTargetReport(payload, session, targets = palmTargetFile) {
  if (session.role !== "admin") return null;
  const districts = targets.districts.map(({ district, target }) => ({
    district, key: districtKey(district), target, forest: 0, departments: 0,
  }));
  const byKey = new Map(districts.map((entry) => [entry.key, entry]));
  const extra = new Map();

  const palm = payload.datasets.find((dataset) => dataset.source === "palm");
  if (palm) {
    const index = (name) => palm.headers.indexOf(name);
    const [year, district, type, seedlings] = ["Year", "District", "Department Type", "Seedlings"].map(index);
    for (const row of palm.rows) {
      if (year < 0 || row[year] !== targets.year) continue;
      const bucket = type >= 0 && normalizeDepartment(row[type]) === "FOREST DEPARTMENT" ? "forest" : "departments";
      const count = Number(row[seedlings]) || 0;
      const key = districtKey(row[district]);
      let entry = byKey.get(key);
      if (!entry) {
        // Districts without a palm target are still listed (target 0) so no seedlings go missing.
        entry = extra.get(key);
        if (!entry) {
          const name = String(row[district] ?? "").trim() || "Not specified";
          entry = { district: name, key, target: 0, forest: 0, departments: 0 };
          extra.set(key, entry);
        }
      }
      entry[bucket] += count;
    }
  }

  return { year: targets.year, districts: [...districts, ...extra.values()] };
}
