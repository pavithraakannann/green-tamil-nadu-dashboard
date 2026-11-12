// Converts the district × department target workbook into backend/data/targets.json.
// Usage: node scripts/import-targets.mjs "<path to target .xlsx>" [year]
// The first sheet must have "District" in the header row, one column per department and a TOTAL column.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "@e965/xlsx";

const [file, yearArgument = "2026-2027"] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/import-targets.mjs "<target workbook.xlsx>" [year]');
  process.exit(1);
}
if (!/^\d{4}-\d{4}$/.test(yearArgument)) throw new Error(`Year must look like 2026-2027, got "${yearArgument}".`);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const workbook = XLSX.read(readFileSync(file), { type: "buffer", cellFormula: false, cellHTML: false });
const sheetName = workbook.SheetNames.find((name) => name.includes(yearArgument)) ?? workbook.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: true });

const headerIndex = rows.findIndex((row) => row.some((cell) => clean(cell).toLowerCase() === "district"));
if (headerIndex < 0) throw new Error("No header row with a District column was found.");
const header = rows[headerIndex].map(clean);
const districtColumn = header.findIndex((cell) => cell.toLowerCase() === "district");
const totalColumn = header.findIndex((cell) => cell.toLowerCase() === "total");
const departmentColumns = header
  .map((name, index) => ({ name, index }))
  .filter(({ name, index }) => name && index > districtColumn && index !== totalColumn);

// Spelling slips in the source sheet, corrected for display (matching to the data does not depend on them).
const DISTRICT_TYPOS = { Tiiruchirappalli: "Tiruchirappalli" };
const fixDistrictTypos = (name) => DISTRICT_TYPOS[name] ?? name;

const toNumber = (value, where) => {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid target "${value}" at ${where}.`);
  return number;
};

const districts = [];
for (const row of rows.slice(headerIndex + 1)) {
  const district = fixDistrictTypos(clean(row[districtColumn]));
  if (!district || district.toLowerCase() === "total" || clean(row[0]).toLowerCase() === "total") continue;
  const targets = {};
  let sum = 0;
  for (const { name, index } of departmentColumns) {
    const value = toNumber(row[index], `${district} / ${name}`);
    targets[name] = value;
    sum += value;
  }
  if (totalColumn >= 0) {
    const total = toNumber(row[totalColumn], `${district} / TOTAL`);
    if (Math.abs(total - sum) > 0.5) throw new Error(`${district}: department targets add up to ${sum} but TOTAL is ${total}.`);
  }
  districts.push({ district, targets });
}
if (!districts.length) throw new Error("No district rows were found.");

const output = {
  year: yearArgument,
  sourceFile: basename(file),
  sheet: sheetName,
  importedAt: new Date().toISOString(),
  columns: departmentColumns.map(({ name }) => name),
  districts,
};
const outFile = resolve(dirname(fileURLToPath(import.meta.url)), "../backend/data/targets.json");
writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`);
const grandTotal = districts.reduce((total, { targets }) => total + Object.values(targets).reduce((a, b) => a + b, 0), 0);
console.log(`${districts.length} districts × ${output.columns.length} departments, total target ${grandTotal}, written to ${outFile}`);
