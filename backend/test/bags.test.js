import assert from "node:assert/strict";
import { test } from "node:test";
import { payloadForSession } from "../src/auth.js";
import { aggregateCsv } from "../src/csvService.js";

const csv = [
  "District,Division,Year,Species,Bag Type,Department,Department Type,Gov Department Type,Mobile,Seedlings",
  "Erode,Erode,2026-2027,Teak,Big bag,Forest Department,,,9999999999,10",
  "Erode,Erode,2026-2027,Teak,Big bag,Forest Department,,,8888888888,5",
  "Erode,Erode,2026-2027,Neem,Small bag,Other Department,,HORTICULTURE,7777777777,3",
].join("\n");

test("bag size aggregate: grouped by species and bag type, no personal columns", () => {
  const dataset = aggregateCsv(csv, "merge");
  assert.ok(dataset.bags);
  assert.ok(dataset.bags.headers.includes("Bag Type"));
  assert.ok(!dataset.bags.headers.includes("Mobile"));
  assert.ok(!dataset.headers.includes("Bag Type"));
  const index = (name) => dataset.bags.headers.indexOf(name);
  const teak = dataset.bags.rows.find((row) => row[index("Species")] === "Teak");
  assert.deepEqual([teak[index("Bag Type")], teak[index("Seedlings")], teak[index("Record Count")]], ["Big bag", "15", "2"]);
});

test("bag size aggregate is sent to admin sessions only", () => {
  const payload = { datasets: [aggregateCsv(csv, "merge"), { source: "palm", headers: ["District", "Seedlings"], rows: [] }] };
  assert.ok(payloadForSession(payload, { role: "admin" }).datasets[0].bags);
  assert.equal(payloadForSession(payload, { role: "department", department: "HORTICULTURE" }).datasets[0].bags, undefined);
});
