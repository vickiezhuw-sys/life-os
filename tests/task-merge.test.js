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
test('stable task ID follows explicit rename and reschedule in either order',()=>{
 const old={...base,done:true,updatedAt:'2026-10-27T08:00:00Z'};
 const fresh={...base,date:'2026-10-28',title:'新任务名',done:false,note:'',projectId:'p',planId:'w',updatedAt:'2026-10-27T09:00:00Z'};
 for(const merged of [mergeTasks([old,fresh]),mergeTasks([fresh,old])]) {
  assert.equal(merged.length,1);assert.equal(merged[0].title,'新任务名');assert.equal(merged[0].planId,'w');assert.equal(merged[0].done,false);
 }
});
test('explicit note clearing is preserved over stale copy',()=>{
 const old={...base,note:'old note',updatedAt:'2026-10-27T08:00:00Z'};
 const fresh={...base,note:'',updatedAt:'2026-10-27T09:00:00Z'};
 assert.equal(mergeTasks([fresh,old])[0].note,'');
});
test('identical task names under different projects remain distinct',()=>{
 assert.equal(mergeTasks([{...base,id:'a',projectId:'a'},{...base,id:'b',projectId:'b'}]).length,2);
});
