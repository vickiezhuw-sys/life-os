// Pure helpers for conflict-safe planner reconciliation.
export function taskIdentity(task) {
  return [task.date, task.module || "", String(task.title || "").trim().replace(/\s+/g, " ")].join("|");
}
export function stamp(t) {
  const n = Date.parse(t?.updatedAt || "");
  return Number.isFinite(n) ? n : null;
}
export function mergeTasks(items = []) {
  // Stable UUID follows renames/date changes; semantic identity still folds legacy seeds.
  const byId = new Map(), withoutId = [];
  const versionedIds = new Set(items.filter(t=>t?.id && stamp(t)!==null).map(t=>t.id));
  for (const task of items) {
    if (!task?.id || !versionedIds.has(task.id)) {withoutId.push(task);continue;}
    const previous=byId.get(task.id);
    if (!previous) {byId.set(task.id,task);continue;}
    const a=stamp(previous),b=stamp(task);
    const winner = b !== null && (a === null || b > a || (b === a && JSON.stringify(task)>JSON.stringify(previous))) ? task : previous;
    byId.set(task.id,a === null && b === null ? {...winner,done:Boolean(previous.done || task.done),note:winner.note || previous.note || task.note || ''} : winner);
  }
  const map = new Map();
  for (const task of [...byId.values(),...withoutId]) {
    if (!task?.date || !task?.title) continue;
    const key = taskIdentity(task) + '|' + (task.projectId || '');
    const previous = map.get(key);
    if (!previous) { map.set(key, { ...task }); continue; }
    const a = stamp(previous), b = stamp(task);
    // Explicit user edits beat old unversioned snapshots. Legacy vs legacy
    // keeps the historical completed state to avoid silently losing progress.
    let winner, loser;
    if (a !== null || b !== null) {
      const chooseNew = b !== null && (a === null || b > a || (b === a && JSON.stringify(task) > JSON.stringify(previous)));
      winner = chooseNew ? task : previous;
      loser = chooseNew ? previous : task;
    } else {
      winner = { ...previous, done: Boolean(previous.done || task.done) };
      loser = task;
    }
    map.set(key, {
      ...winner,
      note: a === null && b === null ? winner.note || loser.note || "" : winner.note ?? ""
    });
  }
  return [...map.values()];
}
