import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProgressReport, indiaDate } from "../src/progress.js";

const payload = {
  datasets: [
    {
      source: "merge",
      headers: ["District", "Year", "Species", "Scheme", "Bag Type", "Date", "Department", "Department Type", "Seedlings"],
      rows: [
        ["Erode", "2026-2027", "Sandal wood", "Green Tamil Nadu Mission", "Poly bag 16 x 30", "2026-11-10", "Forest Department", "Forest Department", "100"],
        ["Erode", "2026-2027", "Silver Oak", "Green Tamil Nadu Mission", "Poly bag 13 x 25", "2026-11-16", "Forest Department", "Forest Department", "200"],
        ["Erode", "2026-2027", "Silver Oak", "Green Tamil Nadu Mission", "Poly bag 13 x 25", "2026-11-17", "Forest Department", "Forest Department", "30"],
        ["Erode", "2026-2027", "Mango", "Green Tamil Nadu Mission", "Poly bag 16 x 30", "2026-11-17", "Forest Department", "Forest Department", "50"],
        ["Erode", "2026-2027", "Teak", "Green Tamil Nadu Mission", "Poly bag 13 x 25", "2026-10-01", "Forest Department", "Forest Department", "70"],
        ["Erode", "2025-2026", "Teak", "Green Tamil Nadu Mission", "Poly bag 13 x 25", "2025-10-01", "Forest Department", "Forest Department", "1000"],
      ],
      progressBags: {
        headers: ["Rule", "Year", "Date", "Seedlings", "Record Count"],
        rows: [
          ["sandalwood", "2026-2027", "2026-11-10", "100", "1"],
          ["silverOak", "2026-2027", "2026-11-16", "200", "1"],
          ["silverOak", "2026-2027", "2026-11-17", "30", "1"],
          ["fruit", "2026-2027", "2026-11-17", "50", "1"],
          ["agroforestry", "2026-2027", "2026-10-01", "70", "1"],
        ],
      },
    },
    {
      source: "palm",
      headers: ["District", "Year", "Date", "Department Type", "Seedlings"],
      rows: [["Erode", "2026-2027", "2026-11-17", "Forest Department", "40"], ["Erode", "2026-2027", "2026-11-01", "Govt Department", "10"]],
    },
  ],
};

const row = (report, id) => {
  const item = [...report.daap, ...report.apo].find((entry) => entry.id === id);
  return [item.asOn, item.today, item.total];
};

test("progress: today is records dated today (India time); as on = total minus today", () => {
  const now = new Date("2026-11-16T20:00:00Z"); // 17 Nov 01:30 in India
  assert.equal(indiaDate(now), "2026-11-17");
  const report = buildProgressReport(payload, { totalSeeds: 5 }, { now });
  assert.equal(report.today, "2026-11-17");
  assert.equal(report.baselineDay, "2026-11-16");
  assert.deepEqual(row(report, "planting"), [370, 80, 450]);
  assert.deepEqual(row(report, "overall"), [1370, 80, 1450]);
  // Silver Oak is counted from bag size data (13 x 25 bag + GTM scheme).
  assert.deepEqual(row(report, "silverOak"), [200, 30, 230]);
  // Fruit Bearing is counted from bag size data (16 x 30 bag + GTM scheme).
  assert.deepEqual(row(report, "fruit"), [0, 50, 50]);
  // Agroforestry is counted from bag size data (13 x 25 bag + GTM scheme).
  assert.deepEqual(row(report, "agroforestry"), [70, 0, 70]);
  // Sandalwood is counted from bag size data (16 x 30 bag + GTM scheme).
  assert.deepEqual(row(report, "sandalwood"), [100, 0, 100]);
  assert.deepEqual(row(report, "palmyrah"), [15, 40, 55]);
  assert.deepEqual(row(report, "palmGtm"), [10, 40, 50]);
  assert.deepEqual(row(report, "palmUdhavi"), [5, null, 5]);
  assert.deepEqual(row(report, "palm"), [15, 40, 55]);
});

test("progress: Udhavi failure leaves palm total empty but keeps GTM", () => {
  const report = buildProgressReport(payload, { error: "down" }, { now: new Date("2026-11-17T06:00:00Z") });
  assert.equal(report.udhaviError, "down");
  assert.deepEqual(row(report, "palm"), [null, 40, null]);
  assert.deepEqual(row(report, "palmGtm"), [10, 40, 50]);
});
