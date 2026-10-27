import test from "node:test";
import assert from "node:assert/strict";
import { mergeTasks } from "../src/task-merge.js";

const base = { id: "one", date: "2026-10-27", module: "Career OS", title: "面试", note: "" };
test("newer explicit uncheck wins over older completed snapshot in any order", () => {
  const old = { ...base, done: true, updatedAt: "2026-10-27T08:00:00Z" };
  const newer = { ...base, done: false, updatedAt: "2026-10-27T09:00:00Z" };
  assert.equal(mergeTasks([old, newer])[0].done, false);
  assert.equal(mergeTasks([newer, old])[0].done, false);
});
test("versioned task beats legacy snapshot", () => {
  assert.equal(mergeTasks([{ ...base, done: false, updatedAt: "2026-10-27T09:00:00Z" }, { ...base, done: true }])[0].done, false);
});
test("legacy snapshots keep past completed behavior", () => {
  assert.equal(mergeTasks([{ ...base, done: false }, { ...base, done: true }])[0].done, true);
});
test("different dates and modules remain distinct", () => {
  assert.equal(mergeTasks([{ ...base }, { ...base, date: "2026-10-28" }, { ...base, module: "Health OS" }]).length, 3);
});
