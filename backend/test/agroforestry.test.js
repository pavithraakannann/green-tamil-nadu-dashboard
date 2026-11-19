import assert from "node:assert/strict";
import { test } from "node:test";
import { payloadForSession } from "../src/auth.js";
import { aggregateCsv } from "../src/csvService.js";
import { buildProgressReport } from "../src/progress.js";

const csv = [
  "District,Year,Species,Scheme,Bag Type,Date,Department,Department Type,Seedlings",
  // Counted: 13 x 25 bag, GTM schemes, not Casuarina / Mangrove.
  "Erode,2026-2027,Teak,Green Tamil Nadu Mission,Poly bag 13 x 25,2026-11-18,Forest Department,Forest Department,100",
  "Erode,2026-2027,Neem,Green Tamilnadu Mission - Bio-shields,Poly bag 13 x 25,2026-11-19,Forest Department,Forest Department,20",
  // Not counted: wrong bag, excluded species, Silver Oak (own row), other scheme, other year.
  "Erode,2026-2027,Teak,Green Tamil Nadu Mission,Poly bag 16 x 30,2026-11-19,Forest Department,Forest Department,7",
  "Erode,2026-2027,Casuarina junghuhniana,Green Tamil Nadu Mission,Poly bag 13 x 25,2026-11-19,Forest Department,Forest Department,5",
  "Erode,2026-2027,grey mangrove,Green Tamil Nadu Mission,Poly bag 13 x 25,2026-11-19,Forest Department,Forest Department,4",
  "Erode,2026-2027,Teak,TBGPCCR,Poly bag 13 x 25,2026-11-19,Forest Department,Forest Department,3",
  "Erode,2026-2027,Silver Oak,Green Tamil Nadu Mission,Poly bag 13 x 25,2026-11-19,Forest Department,Forest Department,9",
  "Erode,2025-2026,Teak,Green Tamil Nadu Mission,Poly bag 13 x 25,2025-11-19,Forest Department,Forest Department,2",
].join("\n");

test("agroforestry progress: 13 x 25 bag, GTM schemes, excluding Casuarina and Mangrove", () => {
  const merge = aggregateCsv(csv, "merge");
  const payload = { datasets: [merge, { source: "palm", headers: ["District", "Year", "Date", "Seedlings"], rows: [] }] };
  const report = buildProgressReport(payload, null, { now: new Date("2026-11-19T06:00:00Z") });
  const agro = report.apo.find((row) => row.id === "agroforestry");
  assert.deepEqual([agro.asOn, agro.today, agro.total], [100, 20, 120]);
  assert.equal(report.agroforestryAvailable, true);
});

test("Silver Oak is counted by bag rule (13 x 25 + GTM scheme), not bare species match", () => {
  const mix = [
    "District,Year,Species,Scheme,Bag Type,Date,Department,Department Type,Seedlings",
    // Counted: 13 x 25 bag, Silver Oak, GTM scheme.
    "Erode,2026-2027,Silver Oak,Green Tamil Nadu Mission,Poly bag 13 x 25,2026-11-18,Forest Department,Forest Department,500",
    // Not counted: wrong bag.
    "Erode,2026-2027,Silver Oak,Green Tamil Nadu Mission,Poly bag 16 x 30,2026-11-18,Forest Department,Forest Department,200",
    // Not counted: wrong scheme.
    "Erode,2026-2027,Silver Oak,TBGPCCR,Poly bag 13 x 25,2026-11-18,Forest Department,Forest Department,100",
  ].join("\n");
  const payload = { datasets: [aggregateCsv(mix, "merge")] };
  const report = buildProgressReport(payload, null, { now: new Date("2026-11-19T06:00:00Z") });
  const so = report.apo.find((row) => row.id === "silverOak");
  assert.deepEqual([so.asOn, so.today, so.total], [500, 0, 500]);
});

test("agroforestry rule totals never leave the server", () => {
  const payload = { datasets: [aggregateCsv(csv, "merge")] };
  assert.ok(payload.datasets[0].progressBags);
  assert.equal(payloadForSession(payload, { role: "admin" }).datasets[0].progressBags, undefined);
});

test("Silver Oak beyond its target goes to Agroforestry", () => {
  // Silver Oak target is 10,00,000: 9,99,990 before today + 30 today = 20 over the target (all today).
  const overflow = [
    "District,Year,Species,Scheme,Bag Type,Date,Department,Department Type,Seedlings",
    "Erode,2026-2027,Silver Oak,Green Tamil Nadu Mission,Poly bag 13 x 25,2026-11-18,Forest Department,Forest Department,999990",
    "Erode,2026-2027,Silver Oak,Green Tamil Nadu Mission,Poly bag 13 x 25,2026-11-19,Forest Department,Forest Department,30",
    "Erode,2026-2027,Teak,Green Tamil Nadu Mission,Poly bag 13 x 25,2026-11-18,Forest Department,Forest Department,100",
  ].join("\n");
  const payload = { datasets: [aggregateCsv(overflow, "merge")] };
  const report = buildProgressReport(payload, null, { now: new Date("2026-11-19T06:00:00Z") });
  const values = (id) => { const line = report.apo.find((row) => row.id === id); return [line.asOn, line.today, line.total]; };
  assert.deepEqual(values("silverOak"), [999990, 10, 1000000]);
  assert.deepEqual(values("agroforestry"), [100, 20, 120]);
  assert.equal(report.silverOakExtra, 20);
});

test("Sandalwood is counted by bag rule (16 x 30 + Sandalwood + GTM scheme)", () => {
  const sandal = [
    "District,Year,Species,Scheme,Bag Type,Date,Department,Department Type,Seedlings",
    // Counted: 16 x 30 bag, Sandalwood species, GTM scheme.
    "Erode,2026-2027,Sandal wood,Green Tamil Nadu Mission,Poly bag 16 x 30,2026-11-18,Forest Department,Forest Department,500",
    "Erode,2026-2027,Sandalwood,Green Tamilnadu Mission - Bio-shields,Poly bag 16 x 30,2026-11-19,Forest Department,Forest Department,200",
    // Not counted: wrong bag.
    "Erode,2026-2027,Sandal wood,Green Tamil Nadu Mission,Poly bag 13 x 25,2026-11-18,Forest Department,Forest Department,100",
    // Not counted: wrong scheme.
    "Erode,2026-2027,Sandal wood,TBGPCCR,Poly bag 16 x 30,2026-11-18,Forest Department,Forest Department,50",
  ].join("\n");
  const payload = { datasets: [aggregateCsv(sandal, "merge")] };
  const report = buildProgressReport(payload, null, { now: new Date("2026-11-19T06:00:00Z") });
  const sw = report.apo.find((row) => row.id === "sandalwood");
  assert.deepEqual([sw.asOn, sw.today, sw.total], [500, 200, 700]);
});

test("Fruit Bearing is counted by bag rule (16 x 30 + all except Casuarina & Mangrove + GTM scheme)", () => {
  const fruit = [
    "District,Year,Species,Scheme,Bag Type,Date,Department,Department Type,Seedlings",
    // Counted: 16 x 30 bag, fruit species, GTM scheme.
    "Erode,2026-2027,Mango,Green Tamil Nadu Mission,Poly bag 16 x 30,2026-11-18,Forest Department,Forest Department,300",
    "Erode,2026-2027,Indian Gooseberry,Green Tamilnadu Mission - Bio-shields,Poly bag 16 x 30,2026-11-19,Forest Department,Forest Department,150",
    // Not counted: wrong bag (13 x 25).
    "Erode,2026-2027,Mango,Green Tamil Nadu Mission,Poly bag 13 x 25,2026-11-19,Forest Department,Forest Department,100",
    // Not counted: excluded species (Casuarina).
    "Erode,2026-2027,Casuarina junghuhniana,Green Tamil Nadu Mission,Poly bag 16 x 30,2026-11-19,Forest Department,Forest Department,50",
    // Not counted: excluded species (Mangrove).
    "Erode,2026-2027,grey mangrove,Green Tamil Nadu Mission,Poly bag 16 x 30,2026-11-19,Forest Department,Forest Department,40",
    // Not counted: Sandalwood (own row).
    "Erode,2026-2027,Sandal wood,Green Tamil Nadu Mission,Poly bag 16 x 30,2026-11-19,Forest Department,Forest Department,30",
    // Not counted: Silver Oak (own row).
    "Erode,2026-2027,Silver Oak,Green Tamil Nadu Mission,Poly bag 16 x 30,2026-11-19,Forest Department,Forest Department,20",
  ].join("\n");
  const payload = { datasets: [aggregateCsv(fruit, "merge")] };
  const report = buildProgressReport(payload, null, { now: new Date("2026-11-19T06:00:00Z") });
  const fr = report.apo.find((row) => row.id === "fruit");
  assert.deepEqual([fr.asOn, fr.today, fr.total], [300, 150, 450]);
});
