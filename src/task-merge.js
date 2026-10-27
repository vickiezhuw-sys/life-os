// Pure helpers for conflict-safe planner reconciliation.
export function taskIdentity(task) {
  return [task.date, task.module || "", String(task.title || "").trim().replace(/\s+/g, " ")].join("|");
}
function stamp(t) {
  const n = Date.parse(t?.updatedAt || "");
  return Number.isFinite(n) ? n : null;
}
export function mergeTasks(items = []) {
  const map = new Map();
  for (const task of items) {
    if (!task?.date || !task?.title) continue;
    const key = taskIdentity(task);
    const previous = map.get(key);
    if (!previous) { map.set(key, { ...task }); continue; }
    const a = stamp(previous), b = stamp(task);
    // Explicit user edits beat old unversioned snapshots. Legacy vs legacy
    // keeps the historical completed state to avoid silently losing progress.
    let winner, loser;
    if (a !== null || b !== null) {
      const chooseNew = b !== null && (a === null || b > a || (b === a && String(task.id) > String(previous.id)));
      winner = chooseNew ? task : previous;
      loser = chooseNew ? previous : task;
    } else {
      winner = { ...previous, done: Boolean(previous.done || task.done) };
      loser = task;
    }
    map.set(key, {
      ...winner,
      note: winner.note || loser.note || ""
    });
  }
  return [...map.values()];
}
