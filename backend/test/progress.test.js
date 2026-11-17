import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProgressReport, indiaDate } from "../src/progress.js";

const payload = {
  datasets: [
    {
      source: "merge",
      headers: ["District", "Year", "Species", "Date", "Seedlings"],
      rows: [
        ["Erode", "2026-2027", "Sandal wood", "2026-11-10", "100"],
        ["Erode", "2026-2027", "Silver Oak", "2026-11-16", "200"],
        ["Erode", "2026-2027", "Silver Oak", "2026-11-17", "30"],
        ["Erode", "2026-2027", "Mango", "2026-11-17", "50"],
        ["Erode", "2026-2027", "Teak", "2026-10-01", "70"],
        ["Erode", "2025-2026", "Teak", "2025-10-01", "1000"],
      ],
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
  assert.deepEqual(row(report, "silverOak"), [200, 30, 230]);
  assert.deepEqual(row(report, "fruit"), [0, 50, 50]);
  assert.deepEqual(row(report, "agroforestry"), [70, 0, 70]);
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
