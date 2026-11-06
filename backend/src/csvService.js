import Papa from "papaparse";
import { Readable } from "node:stream";

const SAFE_DIMENSIONS = [
  "District",
  "Circle",
  "Division",
  "Year",
  "Species",
  "Species (English)",
  "Scheme",
  "Date",
  "Department",
  "Department Type",
  "Gov Department Type",
];
const SEEDLING_COLUMNS = ["Seedlings", "Number of Seedlings"];
const MAX_SEEDLING_VALUE = Number.MAX_SAFE_INTEGER;
const MAX_CSV_BYTES = 300 * 1024 * 1024;

function parseCount(value) {
  if (value === undefined || value === null || String(value).trim() === "") return 0;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_SEEDLING_VALUE) {
    throw new Error("CSV contains an invalid seedling count.");
  }
  return parsed;
}

function dateOnly(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (!match) return "";
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === match[1]
    ? match[1]
    : "";
}

function createAggregator(source) {
  let dimensions = [];
  let dimensionIndexes = [];
  let seedlingIndexes = [];
  let columnCount = 0;
  let groups = new Map();

  function setHeaders(values) {
    const headers = values.map((value, index) => (
      index === 0 ? String(value ?? "").replace(/^\uFEFF/, "").trim() : String(value ?? "").trim()
    ));
    columnCount = headers.length;
    const sourceHeaders = new Map();
    for (const [index, header] of headers.entries()) {
      const key = header.toLocaleLowerCase();
      if (sourceHeaders.has(key)) throw new Error(`${source}.csv contains duplicate column names.`);
      sourceHeaders.set(key, index);
    }

    dimensions = SAFE_DIMENSIONS.filter((field) => sourceHeaders.has(field.toLocaleLowerCase()));
    dimensionIndexes = dimensions.map((field) => sourceHeaders.get(field.toLocaleLowerCase()));
    seedlingIndexes = SEEDLING_COLUMNS
      .map((field) => sourceHeaders.get(field.toLocaleLowerCase()))
      .filter((index) => index !== undefined);
    if (!seedlingIndexes.length) {
      throw new Error(`${source}.csv does not contain Seedlings or Number of Seedlings.`);
    }
    if (!dimensions.includes("District") && !dimensions.includes("Division")) {
      throw new Error(`${source}.csv does not contain a supported public location column.`);
    }
  }

  function addRow(values, rowNumber) {
    if (!dimensions.length) {
      setHeaders(values);
      return;
    }
    if (values.length !== columnCount) {
      throw new Error(`${source}.csv has an invalid number of columns near line ${rowNumber}.`);
    }

    const safeValues = dimensionIndexes.map((index, dimensionNumber) => {
      const value = String(values[index] ?? "").trim();
      return dimensions[dimensionNumber] === "Date" ? dateOnly(value) : value;
    });
    const seedlings = parseCount(
      seedlingIndexes
        .map((index) => values[index])
        .find((value) => String(value ?? "").trim() !== ""),
    );
    const key = JSON.stringify(safeValues);
    const group = groups.get(key) ?? { values: safeValues, seedlings: 0, records: 0 };
    group.seedlings += seedlings;
    group.records += 1;
    if (!Number.isSafeInteger(group.records) || !Number.isFinite(group.seedlings) || group.seedlings > MAX_SEEDLING_VALUE) {
      throw new Error(`${source}.csv totals exceed the supported numeric range near row ${rowNumber}.`);
    }
    groups.set(key, group);
  }

  function finish() {
    if (!dimensions.length) throw new Error(`${source}.csv is empty or has no header row.`);
    if (!groups.size) throw new Error(`${source}.csv contains no data rows.`);
    const headers = [...dimensions, "Seedlings", "Record Count"];
    const rows = [...groups.values()].map(({ values, seedlings, records }) => [
      ...values,
      String(seedlings),
      String(records),
    ]);
    groups = new Map();
    return { source, fileName: `${source}.csv · aggregated`, headers, rows };
  }

  return { addRow, finish };
}

export function aggregateCsv(csvText, source) {
  const parsed = Papa.parse(csvText, {
    header: false,
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length) {
    const firstError = parsed.errors[0];
    throw new Error(`Could not parse ${source}.csv: ${firstError.message} (row ${firstError.row + 1}).`);
  }
  const aggregator = createAggregator(source);
  parsed.data.forEach((row, index) => aggregator.addRow(row, index + 1));
  return aggregator.finish();
}

export async function aggregateCsvStream(input, source) {
  const aggregator = createAggregator(source);
  let bytesRead = 0;
  let rowNumber = 0;
  const limitedInput = Readable.from((async function* limitCsvSize() {
    for await (const chunk of input) {
      bytesRead += chunk.length;
      if (bytesRead > MAX_CSV_BYTES) {
        throw new Error(`${source}.csv exceeds the 300 MB download limit.`);
      }
      yield chunk;
    }
  }()));
  const parser = Papa.parse(Papa.NODE_STREAM_INPUT, {
    header: false,
    skipEmptyLines: "greedy",
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      limitedInput.destroy();
      parser.destroy();
      reject(error);
    };

    limitedInput.on("error", fail);
    parser.on("error", (error) => {
      fail(new Error(`Could not parse ${source}.csv: ${error.message}`));
    });
    parser.on("data", (row) => {
      rowNumber += 1;
      try {
        aggregator.addRow(row, rowNumber);
      } catch (error) {
        fail(error);
      }
    });
    parser.on("end", () => {
      if (settled) return;
      try {
        settled = true;
        resolve(aggregator.finish());
      } catch (error) {
        reject(error);
      }
    });
    limitedInput.pipe(parser);
  });
}
