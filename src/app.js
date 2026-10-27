import "./style.css";
import { AGENT_RESULT_KEY, RESULT_STATUSES, validateAgentResult, mergeAgentResults, readAgentResults } from "./agent-results.js";
import baseline from "./baseline-data.json";
import currentWeekPlan from "./current-week-data.json";
import sepOctPlan from "./sep-oct-plan.json";
import monthPlan from "./month-plan.json";
import resumeSprint from "./sprint-01-resume-plan.json";
import { cloudConfigured, getCloudSession, getCloudMeta, signIn, signUp, signOut, pullCloudSnapshot, pushCloudSnapshot } from "./sync.js";
import { normalizeLifecycle, mergeLifecycle, mergeRecords, linkedTask, upsertEntity, validDay } from "./lifecycle.js";
import { renderLifecycle } from "./lifecycle-view.js";
import { taskIdentity, stamp, mergeTasks } from "./task-merge.js";

const MODULES = [
  ["Health OS", "身体重建"],
  ["Wealth OS", "财务地基"],
  ["Experience OS", "生活体验"],
  ["Career OS", "职业成长"],
  ["Inner OS", "内在秩序"],
];

const STORE_KEY = "life-os-weekly-planner-v1";
const BUILD_KEY = "life-os-build-v1";
const PRE_V1_BACKUP_KEY = "life-os-before-v1-backup";
// Save the unmodified pre-upgrade stores once. No sessions or credentials are copied.
if (!localStorage.getItem(PRE_V1_BACKUP_KEY)) {
  const rawPlanner=localStorage.getItem(STORE_KEY),rawBuild=localStorage.getItem(BUILD_KEY);
  if (rawPlanner || rawBuild) {
    try {localStorage.setItem(PRE_V1_BACKUP_KEY,JSON.stringify({version:1,planner:JSON.parse(rawPlanner || '{"tasks":[]}'),buildItems:JSON.parse(rawBuild || '[]'),agentResults:readAgentResults(),savedAt:new Date().toISOString()}));}
    catch(error) {console.error('升级前备份未成功，请先导出本地数据',error);}
  }
}
const VIEWS=['day','planner','month','build','goals','review','agents','sync'];
let currentView = typeof location !== 'undefined' && VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'day';
let statsRange = "day";
let statsModule = "all";
let cloudSyncReady = false;
let syncTimer = null;
let agentResults = readAgentResults();
let agentImportPreview = null;
let agentImportError = "";

function loadBuild() {
  try {
    const v = JSON.parse(localStorage.getItem(BUILD_KEY));
    if (Array.isArray(v)) return v;
  } catch {}
  return [];
}
function saveBuild(items) {
  localStorage.setItem(BUILD_KEY, JSON.stringify(items));
  if (cloudSyncReady) queueCloudSync();
}
// User-confirmed continuous work session. Fixed ID prevents double counting after reload/cloud merge.
const VERIFIED_BUILD_SEEDS = [{
  id: "project35-20261011-1258-1527",
  content: "Project 35连续共创：复盘、简历结项、岗位投递规划、贷款核对、AI访谈、Agent池设计、Life OS执行记录（用户确认无其他活动，12:58–15:27）",
  at: "2026-10-11T12:58",
  duration: 149,
  module: "Career OS"
}];
function addVerifiedBuildSeeds(items) {
  const existing = new Set(items.map(x => x.id));
  return [...VERIFIED_BUILD_SEEDS.filter(x => !existing.has(x.id)), ...items];
}
let buildItems = addVerifiedBuildSeeds(loadBuild());
localStorage.setItem(BUILD_KEY, JSON.stringify(buildItems));
const PLAN_WEEK_START = "2026-09-21";
const MONTH_PLAN_VERSION = "2026-09-26-october-v1";
const RESUME_SPRINT_VERSION = "2026-10-11-resume-sprint-v8";
function currentWeekStart() {
  const today = new Date();
  today.setDate(today.getDate() - (today.getDay()+6)%7);
  return iso(today);
}

function id() {
  return (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
}
function seed() {
  return baseline.map(t => ({...t, id:id(), done:false}));
}
function addCurrentPlan(state) {
  if (currentWeekStart() !== PLAN_WEEK_START || state.weeklyPlanVersion === PLAN_WEEK_START) return state;
  const existing = new Set(state.tasks.map(t=>`${t.date}|${t.title}`));
  for (const task of currentWeekPlan) {
    if (!existing.has(`${task.date}|${task.title}`)) state.tasks.push({...task,id:id(),done:false});
  }
  state.weeklyPlanVersion = PLAN_WEEK_START;
  return state;
}
function addMonthlyPlan(state) {
  if (state.monthlyPlanVersion === MONTH_PLAN_VERSION || iso(new Date()) > "2026-10-31") return state;
  const existing = new Set(state.tasks.map(t=>`${t.date}|${t.title}`));
  for (const task of sepOctPlan) {
    if (!existing.has(`${task.date}|${task.title}`)) state.tasks.push({...task,id:id(),done:false});
  }
  state.monthlyPlanVersion = MONTH_PLAN_VERSION;
  return state;
}
const CLOSED_RESUME_TASKS = new Set(["核对并修正两版简历工作时间","优化数据分析师主简历","压缩投放版描述并突出策略归因","核实简历成果数据与AI效率指标","确认两版最终投递简历"]);
function reconcileConfirmedProgress(planner) {
  planner.tasks = (planner.tasks || []).filter(t => stamp(t) !== null || !CLOSED_RESUME_TASKS.has(t.title));
  const titles = new Set(resumeSprint.filter(t => t.done === true).map(t => t.date + "|" + t.title));
  planner.tasks = planner.tasks.map(t => stamp(t) === null && titles.has(t.date + "|" + t.title) ? {...t, done:true} : t);
  return planner;
}
function addResumeSprint(state) {
  if (state.resumeSprintVersion === RESUME_SPRINT_VERSION) return state;
  const existing = new Set(state.tasks.map(t => `${t.date}|${t.title}`));
  for (const task of resumeSprint) {
    if (!existing.has(`${task.date}|${task.title}`)) {
      state.tasks.push({...task, id:id(), done:Boolean(task.done)});
    }
  }
  reconcileConfirmedProgress(state);
  state.resumeSprintVersion = RESUME_SPRINT_VERSION;
  return state;
}
// Deduplicate planner tasks by their semantic identity, not generated UUIDs.
// Preserve completion if any copy was completed and retain informative notes.
// Pure helpers for conflict-safe planner reconciliation.
function dedupeTasks(tasks = []) {
  return mergeTasks(tasks);
}

// Tombstones prevent tasks deleted on one device from being revived by stale cloud copies.
// Identity is stable for the same date/module/title; use the latest explicit edit.
function mergedDeletions(a = [], b = []) {
  const map = new Map();
  for (const entry of [...a, ...b]) {
    if (!entry?.key || !Number.isFinite(Date.parse(entry.deletedAt || ""))) continue;
    const previous = map.get(entry.key);
    if (!previous || Date.parse(entry.deletedAt) > Date.parse(previous.deletedAt)) map.set(entry.key, entry);
  }
  return [...map.values()];
}
function withoutDeleted(tasks, deletions) {
  const removed = new Map(deletions.map(d => [d.key, Date.parse(d.deletedAt)]));
  return dedupeTasks(tasks).filter(t => {
    const time = Math.max(removed.get(taskIdentity(t)) ?? -Infinity, removed.get(`id:${t.id}`) ?? -Infinity);
    if (time === -Infinity) return true;
    const updated = Date.parse(t.updatedAt || "");
    return Number.isFinite(updated) && updated > time;
  });
}
function normalizePlanner(planner) {
  const deletedTasks = mergedDeletions(planner.deletedTasks || []);
  return reconcileConfirmedProgress(normalizeLifecycle({...planner, deletedTasks, tasks: withoutDeleted(planner.tasks || [], deletedTasks)}));
}
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    if (v && Array.isArray(v.tasks)) {
      v.weekStart = currentWeekStart();
      addCurrentPlan(v);
      addMonthlyPlan(v);
      addResumeSprint(v);
      v.tasks = withoutDeleted(v.tasks, v.deletedTasks || []);
      save(v);
      return v;
    }
  } catch {}
  const v = addResumeSprint(addMonthlyPlan(addCurrentPlan({ weekStart: currentWeekStart(), tasks: seed() })));
  v.tasks = withoutDeleted(v.tasks, v.deletedTasks || []);
  save(v);
  return v;
}
function save(state) {
  Object.assign(state, normalizeLifecycle(state));
  state.tasks = withoutDeleted(state.tasks, state.deletedTasks || []);
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (cloudSyncReady) queueCloudSync();
}
let state = load();
buildItems = withoutDeletedBuilds(buildItems,state);
localStorage.setItem(BUILD_KEY,JSON.stringify(buildItems));
function withoutDeletedBuilds(items,planner) {
  const removed=new Map((planner.deletedBuildItems || []).map(d=>[d.key,Date.parse(d.deletedAt)]));
  return items.filter(item=>!removed.has(item.id) || (stamp(item) ?? 0)>removed.get(item.id));
}

function snapshot() {
  return {
    version: 1,
    planner: state,
    buildItems,
    agentResults,
    savedAt: new Date().toISOString()
  };
}
function mergeByKey(cloudItems = [], localItems = [], keyFn) {
  const map = new Map();
  for (const item of cloudItems) map.set(keyFn(item), item);
  for (const item of localItems) map.set(keyFn(item), item);
  return [...map.values()];
}
function mergeSnapshot(cloudPayload = {}, localPayload = snapshot()) {
  const cloudPlanner = cloudPayload.planner || {};
  const localPlanner = localPayload.planner || {};
  const planner = {
    ...cloudPlanner,
    ...localPlanner,
    ...mergeLifecycle(cloudPlanner,localPlanner),
    lifecycleVersion:1,
    todayFocus: mergeDailyValues(cloudPlanner.todayFocus, localPlanner.todayFocus, cloudPlanner.focusUpdatedAt, localPlanner.focusUpdatedAt),
    focusUpdatedAt: mergeDailyValues(cloudPlanner.focusUpdatedAt, localPlanner.focusUpdatedAt, cloudPlanner.focusUpdatedAt, localPlanner.focusUpdatedAt),
    dailyNotes: mergeDailyValues(cloudPlanner.dailyNotes, localPlanner.dailyNotes, cloudPlanner.noteUpdatedAt, localPlanner.noteUpdatedAt),
    noteUpdatedAt: mergeDailyValues(cloudPlanner.noteUpdatedAt, localPlanner.noteUpdatedAt, cloudPlanner.noteUpdatedAt, localPlanner.noteUpdatedAt),
    dailyReviews: mergeDailyValues(cloudPlanner.dailyReviews, localPlanner.dailyReviews,
      reviewStamps(cloudPlanner.dailyReviews), reviewStamps(localPlanner.dailyReviews)),
    deletedTasks: mergedDeletions(cloudPlanner.deletedTasks, localPlanner.deletedTasks),
    deletedBuildItems: mergedDeletions(cloudPlanner.deletedBuildItems,localPlanner.deletedBuildItems),
    tasks: []
  };
  planner.tasks = withoutDeleted([...(cloudPlanner.tasks || []), ...(localPlanner.tasks || [])], planner.deletedTasks);
  // Older devices generated different UUIDs for the same seeded task.
  for (const [day, selected] of Object.entries(planner.todayFocus)) {
    const sourceTasks = [...(cloudPlanner.tasks || []), ...(localPlanner.tasks || [])];
    planner.todayFocus[day] = [...new Set((Array.isArray(selected) ? selected : []).map(ref => {
      const original = sourceTasks.find(t => t.id === ref);
      return planner.tasks.find(t => t.date === day && (t.id === ref || (original && taskIdentity(t) === taskIdentity(original))))?.id || ref;
    }).filter(Boolean))];
  }
  reconcileConfirmedProgress(planner);
  const buildIdentity=item=>({...item,id:item.id || `legacy:${item.at || ''}|${item.content || ''}`});
  const builds = withoutDeletedBuilds(addVerifiedBuildSeeds(mergeRecords(
    (cloudPayload.buildItems || []).map(buildIdentity),
    (localPayload.buildItems || []).map(buildIdentity)
  )),planner);
  const sourceTasks=[...(cloudPlanner.tasks || []),...(localPlanner.tasks || [])];
  for(const build of builds) {
    const original=sourceTasks.find(t=>t.id===build.taskId);
    const linked=planner.tasks.find(t=>t.id===build.taskId || (original && taskIdentity(t)===taskIdentity(original) && (t.projectId || '')===(original.projectId || '')));
    if(linked) {build.taskId=linked.id;build.projectId=build.projectId || linked.projectId || '';}
  }
  return { version: 1, planner, buildItems: builds,
    agentResults: mergeAgentResults(cloudPayload.agentResults, localPayload.agentResults),
    savedAt: new Date().toISOString() };
}
function reviewStamps(reviews = {}) {
  return Object.fromEntries(Object.entries(reviews).map(([day, review]) => [day, review?.updatedAt]));
}
function mergeDailyValues(cloud = {}, local = {}, cloudStamps = {}, localStamps = {}) {
  const merged = {...cloud};
  for (const [day, value] of Object.entries(local)) {
    const a = Date.parse(cloudStamps[day]) || 0, b = Date.parse(localStamps[day]) || 0;
    if (!(day in merged) || b > a || (a === b && (a === 0 || JSON.stringify(value) > JSON.stringify(merged[day])))) merged[day] = value;
  }
  return merged;
}
function toggleTodayFocus(taskId, day = iso(new Date())) {
  const valid = state.tasks.filter(t => t.date === day);
  const selected = ((state.todayFocus || {})[day] || []).filter(ref => valid.some(t => t.id === ref));
  if (!valid.some(t => t.id === taskId)) return false;
  if (!selected.includes(taskId) && selected.length >= 3) return false;
  state.todayFocus = {...state.todayFocus, [day]: selected.includes(taskId) ? selected.filter(ref => ref !== taskId) : [...selected, taskId]};
  state.focusUpdatedAt = {...state.focusUpdatedAt, [day]:new Date().toISOString()};
  save(state);
  return true;
}
function carryTask(taskId, targetDay = iso(new Date())) {
  const source = state.tasks.find(t => t.id === taskId);
  if (!source || source.done || source.date >= targetDay) return false;
  const key = taskIdentity({...source, date:targetDay});
  if (state.tasks.some(t => taskIdentity(t) === key)) return false;
  state.tasks.push({...source, id:id(), date:targetDay, done:false,
    carriedFrom:source.id, carriedFromDate:source.date, updatedAt:new Date().toISOString()});
  save(state);
  return true;
}
function applySnapshot(payload) {
  if (!payload) return;
  if (payload.planner?.tasks) state = normalizePlanner(payload.planner);
  if (Array.isArray(payload.buildItems)) buildItems = withoutDeletedBuilds(addVerifiedBuildSeeds(payload.buildItems),state);
  if (Array.isArray(payload.agentResults)) agentResults = mergeAgentResults(payload.agentResults);
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  localStorage.setItem(BUILD_KEY, JSON.stringify(buildItems));
  localStorage.setItem(AGENT_RESULT_KEY, JSON.stringify(agentResults));
}
// Always reconcile before upload: a direct write of a stale local snapshot
// can erase newer cloud changes made on another device.
let syncInFlight = null;
let syncPending = false;
function queueCloudSync() {
  if (!cloudConfigured || !getCloudSession()?.access_token) return;
  syncPending = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncNow().catch(error => {
      console.error("Life OS cloud sync failed; local data remains available", error);
      if (currentView === "sync") renderSync();
    });
  }, 700);
}
async function syncNow() {
  if (!cloudConfigured || !getCloudSession()?.access_token) return false;
  if (syncInFlight) {
    syncPending = true;
    await syncInFlight;
    if (!syncPending) return true;
    // The active operation may have started before the latest local edit.
    // The caller will run another reconciliation after it finishes.
  }
  syncPending = false;
  const work = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await pullCloudSnapshot();
      const merged = row?.payload ? mergeSnapshot(row.payload, snapshot()) : snapshot();
      applySnapshot(merged);
      try {
        const uploaded = await pushCloudSnapshot(merged, row?.updated_at ?? null);
        if (!uploaded) throw new Error("Cloud session expired or upload was skipped");
        return true;
      } catch (error) {
        if (error.code !== "SYNC_CONFLICT" || attempt === 2) throw error;
      }
    }
  })();
  syncInFlight = work;
  try { return await work; }
  finally {
    if (syncInFlight === work) syncInFlight = null;
    if (syncPending) queueCloudSync();
  }
}
async function initializeCloudSync() {
  cloudSyncReady = true;
  if (!cloudConfigured || !getCloudSession()?.access_token) return;
  try {
    await syncNow();
    renderCurrentView();
  } catch {}
}
function renderCurrentView() {
  if (currentView === "day") renderDay();
  else if (currentView === "build") renderBuild();
  else if (currentView === "month") renderMonth();
  else if (currentView === "sync") renderSync();
  else if (currentView === "agents") renderAgents();
  else if (currentView === "goals" || currentView === "review") renderLifecycle(lifecycleHost(),currentView);
  else render();
}

function navHtml(active) {
  const items = [
    ["day", "Day"],
    ["planner", "Weekly"],
    ["month", "Month"],
    ["build", "Build"],
    ["goals", "目标与计划"],
    ["review", "周月复盘"],
    ["agents", "Agents"],
    ["sync", "Sync"],
  ];
  return `<div class="view-tabs">${items.map(([key,label])=>`<button class="view-tab ${active===key?"active":""}" data-nav="${key}">${label}</button>`).join("")}</div>`;
}
function lifecycleHost() {
  return {getState:()=>state,getBuilds:()=>buildItems,setState:next=>{state=next;save(state);},
    nav:navHtml,bindNavigation,makeId:id,openTask:openEditor};
}
function projectOptions(selected = "") {
  return '<option value="">暂不关联项目</option>' + (state.projects || []).map(p=>`<option value="${escapeHtml(p.id)}" ${p.id===selected?'selected':''}>${escapeHtml(p.title)}${p.archived?'（已归档）':''}</option>`).join('');
}
function taskLinkOptions(selected = "") {
  return '<option value="">暂不关联任务</option>' + state.tasks.map(t=>`<option value="${escapeHtml(t.id)}" ${t.id===selected?'selected':''}>${escapeHtml(t.date)} · ${escapeHtml(t.title)}</option>`).join('');
}
function buildLinks(fd) {
  const taskId=fd.get('taskId') || '', projectId=fd.get('projectId') || '';
  const task=state.tasks.find(t=>t.id===taskId);
  if (taskId && !task) throw new Error('关联任务不存在');
  if (task && projectId && task.projectId !== projectId) throw new Error('任务与项目不一致，请选择任务所属项目');
  if (projectId && !(state.projects || []).some(p=>p.id===projectId)) throw new Error('项目不存在');
  return {taskId,projectId:task?.projectId || projectId};
}
function bindNavigation() {
  document.querySelectorAll("[data-nav]").forEach(el=>el.onclick=()=>{
    currentView = el.dataset.nav;
    if (typeof history !== 'undefined') history.replaceState(null,'',`#${currentView}`);
    renderCurrentView();
  });
}

function d(iso) { return new Date(`${iso}T00:00:00`); }
function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function addDays(isoDate, n) {
  const x=d(isoDate); x.setDate(x.getDate()+n); return iso(x);
}
function weekDates(start) { return [0,1,2,3,4,5,6].map(x=>addDays(start,x)); }
function fmtRange(start) {
  const end=addDays(start,6), a=d(start), b=d(end);
  return `${String(a.getMonth()+1).padStart(2,"0")}.${String(a.getDate()).padStart(2,"0")} — ${String(b.getMonth()+1).padStart(2,"0")}.${String(b.getDate()).padStart(2,"0")}`;
}
const weekday = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];

function openEditor(task={}, date=weekDates(state.weekStart)[0]) {
  const editing = Boolean(task.id);
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal-backdrop" id="modal">
      <form class="modal" id="taskForm">
        <h4>${editing ? "编辑任务" : "新增任务"}</h4>
        <div class="field"><label>日期</label><input name="date" type="date" value="${task.date || date}" required /></div>
        <div class="field"><label>模块</label><select name="module">${MODULES.map(([m])=>`<option ${task.module===m?"selected":""}>${m}</option>`).join("")}</select></div>
        <div class="field"><label>任务</label><input name="title" value="${escapeHtml(task.title||"")}" required /></div>
        <div class="field"><label>备注</label><textarea name="note">${escapeHtml(task.note||"")}</textarea></div>
        <div class="field"><label for="taskProject">关联项目</label><select id="taskProject" name="projectId">${projectOptions(task.projectId)}</select></div>
        <div class="field"><label for="taskPlan">关联月周计划</label><select id="taskPlan" name="planId"><option value="">暂不关联计划</option>${(state.plans || []).map(p=>`<option value="${escapeHtml(p.id)}" ${p.id===task.planId?'selected':''}>${escapeHtml(p.kind==='week'?'周':'月')} · ${escapeHtml(p.outcome)}</option>`).join('')}</select></div>
        <div class="modal-actions">
          ${editing ? `<button type="button" class="btn" id="deleteTask">删除</button>` : ""}
          <button type="button" class="btn" id="cancelModal">取消</button>
          <button class="btn primary">保存</button>
        </div>
      </form>
    </div>
  `);
  const modal=document.querySelector("#modal");
  modal.querySelector("#cancelModal").onclick=()=>modal.remove();
  if (editing) modal.querySelector("#deleteTask").onclick=()=>{
    const deletedAt = new Date().toISOString();
    state.deletedTasks = mergedDeletions(state.deletedTasks, [{ key: taskIdentity(task), deletedAt }, { key: `id:${task.id}`, deletedAt }]);
    state.tasks=state.tasks.filter(x=>x.id!==task.id); save(state); modal.remove(); renderCurrentView();
  };
  modal.querySelector("#taskForm").onsubmit=(e)=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    let links;
    try { links=linkedTask(state,fd.get('projectId') || '',fd.get('planId') || ''); } catch(error) { alert(error.message);return; }
    const next = {
      ...task,
      ...links,
      id: task.id || id(),
      done: task.done || false,
      date: fd.get("date"),
      module: fd.get("module"),
      title: fd.get("title").trim(),
      note: fd.get("note").trim(),
      updatedAt: new Date().toISOString()
    };
    if (!next.title || !validDay(next.date)) {alert('请填写任务名称和有效日期');return;}
    if (editing) {
      if (taskIdentity(task) !== taskIdentity(next)) {
        state.deletedTasks = mergedDeletions(state.deletedTasks, [{key:taskIdentity(task),deletedAt:next.updatedAt}]);
      }
      state.tasks=state.tasks.map(x=>x.id===task.id?next:x);
    }
    else state.tasks.push(next);
    save(state); modal.remove(); renderCurrentView();
  };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function renderAgents() {
  const card = (item, preview = false) => `<article class="sync-card agent-card">
    <div class="brand-kicker">${item.mode === "demo" ? "离线演示" : "模型任务"} · ${escapeHtml(item.module)}</div>
    <h3>${escapeHtml(item.objective)}</h3>
    <span class="badge">${escapeHtml(RESULT_STATUSES[item.status])}</span>
    <p class="agent-summary">${escapeHtml(item.summary || "尚无阶段结果")}</p>
    <ul>${item.next_actions.map(action => `<li>${escapeHtml(action)}</li>`).join("")}</ul>
    <p class="muted">${escapeHtml(item.task_id)} · ${item.mode === "demo" ? "模拟" : "尝试调用"} ${item.calls_attempted} 次</p>
    ${preview ? `<div class="sync-actions"><button class="btn primary" id="confirmAgentImport">确认导入结果</button><button class="btn" id="cancelAgentImport">取消</button></div>` : ""}
  </article>`;
  document.querySelector("#app").innerHTML = `<main class="shell">
    <header class="topbar"><div><div class="brand-kicker">Life OS · Agent Pool</div><h1>Agents</h1></div>${navHtml("agents")}</header>
    <section class="sync-hero"><div class="brand-kicker">目标 → 执行 → 审核 → 验收</div><h2>接收成果，决定下一步。</h2>
      <p>从私有任务下载结果文件，预览后导入。结果按任务去重保存；周计划完成状态和实际投入时间由你确认记录。</p>
      <div class="sync-actions"><label class="btn primary import-label">导入 Agent 结果<input id="importAgentResult" type="file" accept="application/json,.json" hidden /></label></div>
      <p class="muted">此页面不会触发模型调用。导入内容会随已有云同步保存到你的账户，请确认内容适合保存。</p>
    </section>
    ${agentImportError ? `<div class="sync-error" role="alert">${escapeHtml(agentImportError)}</div>` : ""}
    ${agentImportPreview ? `<section class="agent-preview"><h3>导入预览</h3>${card(agentImportPreview, true)}</section>` : ""}
    <section class="agent-results">${agentResults.length ? agentResults.map(item => card(item)).join("") : `<div class="day-empty">还没有 Agent 结果。下载任务输出中的 life-os-result.json 后导入。</div>`}</section>
    <p class="muted">文件内容由导出方提供，本页面无法验证提供者身份。模型审核通过会显示“待人工验收”，不会自动记为已完成。</p>
  </main>`;
  bindNavigation();
  document.querySelector("#importAgentResult").onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    agentImportPreview = null; agentImportError = "";
    try {
      if (file.size > 1000000) throw new Error("结果文件不能超过 1MB");
      agentImportPreview = validateAgentResult(JSON.parse(await file.text()));
    } catch (error) {
      agentImportError = error instanceof SyntaxError ? "文件不是有效的 JSON 结果" : error.message;
    }
    renderAgents();
  };
  if (agentImportPreview) {
    document.querySelector("#confirmAgentImport").onclick = () => {
      const next = mergeAgentResults(agentResults, [agentImportPreview]);
      try {
        localStorage.setItem(AGENT_RESULT_KEY, JSON.stringify(next));
        agentResults = next; agentImportPreview = null; agentImportError = "";
        if (cloudSyncReady) queueCloudSync();
      } catch { agentImportError = "保存失败，请检查浏览器存储空间后重试"; }
      renderAgents();
    };
    document.querySelector("#cancelAgentImport").onclick = () => { agentImportPreview = null; renderAgents(); };
  }
}


function nowLocalInput() {
  const x = new Date();
  const local = new Date(x.getTime() - x.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}

function startOfWeek(date) {
  const x = new Date(date);
  const day = (x.getDay()+6)%7;
  x.setDate(x.getDate()-day);
  x.setHours(0,0,0,0);
  return x;
}
function sameDay(a,b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
function inRange(item, range) {
  const x = new Date(item.at);
  const now = new Date();
  if (range==="day") return sameDay(x, now);
  if (range==="week") {
    const s=startOfWeek(now), e=new Date(s); e.setDate(e.getDate()+7);
    return x>=s && x<e;
  }
  if (range==="month") return x.getFullYear()===now.getFullYear() && x.getMonth()===now.getMonth();
  if (range==="year") return x.getFullYear()===now.getFullYear();
  return true;
}
function fmtBuildTime(at) {
  const x=new Date(at);
  return `${String(x.getMonth()+1).padStart(2,"0")}.${String(x.getDate()).padStart(2,"0")} ${String(x.getHours()).padStart(2,"0")}:${String(x.getMinutes()).padStart(2,"0")}`;
}
function durationMinutes(item) {
  const value = Number(item.duration);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function fmtDuration(minutes) {
  if (!minutes) return "0 分钟";
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours} 小时${rest ? ` ${rest} 分钟` : ""}` : `${rest} 分钟`;
}
function moduleOptions(selected = "") {
  return `<option value="" ${!selected ? "selected" : ""} disabled>选择 OS 分类</option>` +
    MODULES.map(([name])=>`<option value="${name}" ${selected===name ? "selected" : ""}>${name}</option>`).join("");
}
function editBuild(item) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `<form class="modal" id="editBuildForm">
    <h4>编辑记录</h4>
    <div class="field"><label for="editBuildContent">内容</label><input id="editBuildContent" name="content" required value="${escapeHtml(item.content)}" /></div>
    <div class="field"><label for="editBuildAt">开始时间</label><input id="editBuildAt" name="at" type="datetime-local" required value="${escapeHtml(item.at)}" /></div>
    <div class="field"><label for="editBuildDuration">时长（分钟）</label><input id="editBuildDuration" name="duration" type="number" inputmode="numeric" min="1" max="1440" step="1" value="${durationMinutes(item) || ""}" /></div>
    <div class="field"><label for="editBuildModule">OS 分类</label><select id="editBuildModule" name="module" required>${moduleOptions(item.module)}</select></div>
    <div class="field"><label for="editBuildTask">关联任务</label><select id="editBuildTask" name="taskId">${taskLinkOptions(item.taskId)}</select></div>
    <div class="field"><label for="editBuildProject">关联项目</label><select id="editBuildProject" name="projectId">${projectOptions(item.projectId)}</select></div>
    <div class="modal-actions"><button type="button" class="btn" id="cancelBuildEdit">取消</button><button class="btn primary">保存</button></div>
  </form>`;
  document.body.append(modal);
  modal.querySelector("#cancelBuildEdit").onclick=()=>modal.remove();
  modal.onclick=e=>{if(e.target===modal) modal.remove();};
  modal.querySelector("form").onsubmit=e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    let links; try {links=buildLinks(fd);} catch(error) {alert(error.message);return;}
    const updated={...item,...links,content:fd.get("content").trim(),at:fd.get("at"),duration:fd.get("duration") ? Number(fd.get("duration")) : 0,module:fd.get("module"),updatedAt:new Date().toISOString()};
    if (!updated.content || !validDay(String(updated.at).slice(0,10)) || !Number.isFinite(updated.duration) || updated.duration<0 || updated.duration>1440) {alert('请检查记录内容、日期和时长');return;}
    buildItems=buildItems.map(x=>x.id===item.id ? updated : x);
    saveBuild(buildItems); modal.remove(); renderBuild();
  };
}
function durationChart(items, range) {
  const now = new Date();
  let labels = [], keys = [];
  if (range === "day") {
    keys = Array.from({length:24}, (_,i)=>i);
    labels = keys.map(i=>`${i}时`);
  } else if (range === "week") {
    keys = Array.from({length:7}, (_,i)=>i);
    labels = ["周一","周二","周三","周四","周五","周六","周日"];
  } else if (range === "month") {
    keys = Array.from({length:new Date(now.getFullYear(),now.getMonth()+1,0).getDate()},(_,i)=>i+1);
    labels = keys.map(i=>`${i}日`);
  } else {
    keys = Array.from({length:12}, (_,i)=>i);
    labels = keys.map(i=>`${i+1}月`);
  }
  const values = keys.map(()=>0);
  for (const item of items) {
    const date = new Date(item.at);
    if (Number.isNaN(date.getTime())) continue;
    const key = range === "day" ? date.getHours() : range === "week" ? (date.getDay()+6)%7 : range === "month" ? date.getDate() : date.getMonth();
    values[keys.indexOf(key)] += durationMinutes(item);
  }
  const max = Math.max(...values, 1);
  return `<div class="duration-chart" role="img" aria-label="${range === "day" ? "今日每小时" : range === "week" ? "本周每日" : range === "month" ? "本月每日" : "今年每月"}记录时长：${values.reduce((sum,v)=>sum+v,0)} 分钟">
    <div class="chart-heading"><strong>投入时间</strong><span>单位：分钟 · 按记录的开始时间统计</span></div>
    <div class="chart-scroll"><div class="chart-bars ${range === "month" ? "chart-month" : ""} ${range === "week" ? "chart-week" : ""}">
      ${values.map((value,i)=>`<div class="chart-column" title="${labels[i]}：${fmtDuration(value)}"><span class="chart-value">${value || ""}</span><div class="chart-track"><div class="chart-fill" style="height:${value ? Math.max(4, value/max*100) : 0}%"></div></div><span class="chart-label">${labels[i]}</span></div>`).join("")}
    </div></div>
  </div>`;
}

function renderDay() {
  const today = iso(new Date());
  const todayDate = d(today);
  const tasks = state.tasks.filter(t=>t.date===today);
  const doneTasks = tasks.filter(t=>t.done);
  const openTasks = tasks.filter(t=>!t.done);
  const todayBuild = buildItems
    .filter(x=>String(x.at || "").slice(0,10)===today)
    .sort((a,b)=>new Date(b.at)-new Date(a.at));
  const totalMinutes = todayBuild.reduce((sum,x)=>sum+durationMinutes(x),0);
  const moduleMinutes = MODULES.map(([name,sub])=>({
    name, sub,
    minutes: todayBuild.filter(x=>x.module===name).reduce((sum,x)=>sum+durationMinutes(x),0)
  })).filter(x=>x.minutes>0);
  const maxModule = Math.max(...moduleMinutes.map(x=>x.minutes),1);
  const dailyNotes = state.dailyNotes || {};
  const note = dailyNotes[today] || "";
  const todayFocus = ((state.todayFocus || {})[today] || []).filter(ref => tasks.some(t => t.id === ref)).slice(0,3);
  const focusTasks = tasks.filter(t=>todayFocus.includes(t.id));
  const remainingMinutes = Math.max(0,300-totalMinutes);
  const attainment = Math.min(100,Math.round(totalMinutes/300*100));
  const review = (state.dailyReviews || {})[today] || {};
  const overdue = state.tasks.filter(t => !t.done && t.date < today && !tasks.some(current => taskIdentity(current) === taskIdentity({...t,date:today})));

  document.querySelector("#app").innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div><div class="brand-kicker">L ↗ Life OS</div><h1>我的人生操作系统</h1></div>
        ${navHtml("day")}
      </header>

      <section class="day-hero">
        <div>
          <div class="brand-kicker">TODAY · ${today}</div>
          <h2>${String(todayDate.getMonth()+1).padStart(2,"0")} 月 ${String(todayDate.getDate()).padStart(2,"0")} 日 · ${weekday[todayDate.getDay()]}</h2>
          <p>今天不用解决所有问题，只推进最重要的几件事。</p>
        </div>
        <div class="day-score">
          <strong>${doneTasks.length} / ${tasks.length}</strong>
          <span>今日任务完成</span>
        </div>
      </section>

      <section class="day-panel" aria-label="Project 35 execution dashboard">
        <div class="brand-kicker">PROJECT 35 · DAILY EXECUTION</div>
        <h3>今日有效投入：${fmtDuration(totalMinutes)} / 5 小时</h3>
        <div class="month-progress" role="progressbar" aria-label="有效投入目标达成率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${attainment}"><div style="width:${attainment}%"></div></div>
        <p>${totalMinutes >= 300 ? "今日已达到 300 分钟投入目标。" : `距离目标还差 ${remainingMinutes} 分钟；只记录真实投入，不自动补时长。`}</p>
        <div class="day-panel-head"><div><div class="brand-kicker">TOP 3</div><h3>今日最重要的三件事 · ${focusTasks.length}/3</h3></div></div>
        ${focusTasks.length ? focusTasks.map(t=>`<div class="day-build-item"><strong>${escapeHtml(t.title)}</strong><span class="badge">${t.done?"已完成":"进行中"}</span></div>`).join("") : '<p>在下方任务右侧点击「设为重点」，最多选择三件。</p>'}
      </section>
      <section class="day-panel"><h3>快速捕获</h3><form id="dayCaptureForm" class="cycle-inline"><input name="title" maxlength="280" placeholder="先记下一件事，稍后安排" aria-label="快速捕获待办" required /><button class="btn">加入收集箱</button></form><span id="dayCaptureStatus" role="status">在「目标与计划」中安排日期和项目。</span></section>
      <section class="day-layout">
        <article class="day-panel">
          <div class="day-panel-head">
            <div><div class="brand-kicker">TODAY'S FOCUS</div><h3>今天要推进的事</h3></div>
            <button class="btn" id="addTodayTask">＋ 添加</button>
          </div>
          <div class="day-focus-list">
            ${tasks.length ? tasks.map(t=>`
              <div class="day-focus-item ${t.done?"done":""}">
                <button class="check ${t.done?"done":""}" data-day-check="${t.id}" aria-label="完成">${t.done?"✓":""}</button>
                <div class="day-focus-copy">
                  <strong>${escapeHtml(t.title)}</strong>
                  ${t.note?`<small>${escapeHtml(t.note)}</small>`:""}
                  <span class="badge">${t.module}</span>
                  ${t.projectId?`<small>项目：${escapeHtml((state.projects || []).find(p=>p.id===t.projectId)?.title || '关联记录待同步')}</small>`:''}
                </div>
                <button class="edit" data-day-focus="${t.id}" aria-pressed="${todayFocus.includes(t.id)}">${todayFocus.includes(t.id)?"★ 重点":"☆ 设为重点"}</button><button class="edit" data-day-edit="${t.id}">编辑</button>
              </div>
            `).join("") : `<div class="day-empty">今天还没有安排。可以从 Weekly 里挑 1–3 件真正值得推进的事。</div>`}
          </div>
        </article>

        <article class="day-panel day-build-summary">
          <div class="brand-kicker">BUILD TODAY</div>
          <h3>${fmtDuration(totalMinutes)}</h3>
          <p>${todayBuild.length} 条记录 · 今天真实发生的投入</p>
          <div class="day-module-bars">
            ${moduleMinutes.length ? moduleMinutes.map(x=>`
              <div class="day-module-row">
                <span>${x.name}</span>
                <div class="module-bar-track"><div class="module-bar-fill" style="width:${Math.max(7,x.minutes/maxModule*100)}%"></div></div>
                <strong>${fmtDuration(x.minutes)}</strong>
              </div>
            `).join("") : `<div class="day-empty compact">今天还没有 Build 记录。</div>`}
          </div>
          <button class="btn primary" data-jump-build>记录一条 Build</button>
        </article>
      </section>

      <section class="day-panel day-build-list">
        <div class="day-panel-head">
          <div><div class="brand-kicker">WHAT ACTUALLY HAPPENED</div><h3>今天已经做过的事</h3></div>
        </div>
        ${todayBuild.length ? todayBuild.map(x=>`
          <div class="day-build-item">
            <div>
              <strong>${escapeHtml(x.content)}</strong>
              <small>${fmtBuildTime(x.at)} · ${fmtDuration(durationMinutes(x))}</small>
            </div>
            <span class="badge">${x.module || "未分类"}</span>
          </div>
        `).join("") : `<div class="day-empty">做完一件值得留下的事，再回来记 Build。</div>`}
      </section>

      <section class="day-panel day-note">
        <div class="brand-kicker">ONE LINE FOR TODAY</div>
        <h3>今天过得怎么样？</h3>
        <textarea id="dailyNote" maxlength="280" placeholder="留一句就够了。">${escapeHtml(note)}</textarea>
        <div class="day-note-foot"><span id="noteStatus">自动保存到 Life OS</span><span>${note.length}/280</span></div>
      </section>
      <section class="day-panel">
        <h3>日终复盘</h3>
        <p>已完成 ${doneTasks.length}/${tasks.length} 件 · 真实投入 ${fmtDuration(totalMinutes)}</p>
        <form id="dailyReviewForm" class="sync-form">
          <label>今天推进了什么？<textarea name="summary" maxlength="1000">${escapeHtml(review.summary || "")}</textarea></label>
          <label>明天的下一步<input name="nextStep" maxlength="280" value="${escapeHtml(review.nextStep || "")}" /></label>
          <button class="btn primary">保存复盘</button><span id="reviewStatus">${review.updatedAt ? "已保存" : "尚未复盘"}</span>
        </form>
      </section>
      <section class="day-panel">
        <h3>未完成任务结转</h3>
        <p>由你逐项选择，原日期记录会保留；结转不会生成投入时间。</p>
        ${overdue.length ? overdue.map(t=>`<div class="day-build-item"><div><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(t.date)} · ${escapeHtml(t.module || "")}</small></div><button class="btn" data-carry-task="${escapeHtml(t.id)}">安排到今天</button></div>`).join("") : '<p>没有待结转任务。</p>'}
      </section>
    </main>`;

  bindNavigation();
  document.querySelector('#dayCaptureForm').onsubmit=e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget);
    try {state=upsertEntity(state,'captures',{title:fd.get('title')},id);save(state);e.currentTarget.reset();document.querySelector('#dayCaptureStatus').textContent='已加入收集箱 · 尚未安排日期';} catch(error) {alert(error.message);}
  };
  document.querySelectorAll("[data-day-check]").forEach(el=>el.onclick=()=>{
    state.tasks=state.tasks.map(t=>t.id===el.dataset.dayCheck?{...t,done:!t.done,updatedAt:new Date().toISOString()}:t);
    save(state);
    renderDay();
  });
  document.querySelectorAll("[data-day-focus]").forEach(el=>el.onclick=()=>{
    if (!toggleTodayFocus(el.dataset.dayFocus,today)) { alert("每日最多设置 3 件重点任务"); return; }
    renderDay();
  });
  document.querySelectorAll("[data-day-edit]").forEach(el=>el.onclick=()=>openEditor(state.tasks.find(t=>t.id===el.dataset.dayEdit), today));
  document.querySelector("#addTodayTask").onclick=()=>openEditor({}, today);
  document.querySelector("[data-jump-build]").onclick=()=>{currentView="build"; renderBuild();};

  const noteEl=document.querySelector("#dailyNote");
  noteEl.oninput=()=>{
    const value=noteEl.value;
    document.querySelector(".day-note-foot span:last-child").textContent=`${value.length}/280`;
    document.querySelector("#noteStatus").textContent="保存中…";
      state.dailyNotes={...(state.dailyNotes||{}),[today]:value};
      state.noteUpdatedAt={...(state.noteUpdatedAt||{}),[today]:new Date().toISOString()};
      save(state);
      document.querySelector("#noteStatus").textContent="已保存 · 会随云同步备份";
  };
  document.querySelectorAll("[data-carry-task]").forEach(el=>el.onclick=()=>{carryTask(el.dataset.carryTask,today);renderDay();});
  document.querySelector("#dailyReviewForm").onsubmit=e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    state.dailyReviews={...state.dailyReviews,[today]:{summary:String(fd.get("summary") || "").trim().slice(0,1000),nextStep:String(fd.get("nextStep") || "").trim().slice(0,280),updatedAt:new Date().toISOString()}};
    save(state);
    document.querySelector("#reviewStatus").textContent="已保存 · 会随云同步备份";
  };
}

function renderBuild() {
  const filtered = buildItems.filter(x=>inRange(x, statsRange) && (statsModule === "all" || x.module === statsModule)).sort((a,b)=>new Date(b.at)-new Date(a.at));
  const byDate = {};
  for (const x of filtered) {
    const key = x.at.slice(0,10);
    (byDate[key] ||= []).push(x);
  }
  const totalMinutes = filtered.reduce((sum,x)=>sum+durationMinutes(x),0);
  document.querySelector("#app").innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div><div class="brand-kicker">L ↗ Life OS</div><h1>我的人生操作系统</h1></div>
        ${navHtml("build")}
      </header>

      <section class="build-hero">
        <div>
          <div class="brand-kicker">BUILD LOG</div>
          <h2>把做过的事，留下来。</h2>
          <p>记录做了什么、开始时间和投入时长。</p>
        </div>
        <form class="capture" id="buildForm">
          <div class="capture-main">
            <input name="content" autocomplete="off" placeholder="刚刚做了什么？" required />
            <input name="at" type="datetime-local" value="${nowLocalInput()}" required />
            <input name="duration" type="number" inputmode="numeric" min="1" max="1440" step="1" placeholder="时长（分钟）" aria-label="时长（分钟）" required />
            <select name="module" aria-label="OS 分类" required>${moduleOptions()}</select>
            <select name="taskId" aria-label="关联任务">${taskLinkOptions()}</select>
            <select name="projectId" aria-label="关联项目">${projectOptions()}</select>
          </div>
          <button class="btn primary">记录</button>
        </form>
      </section>

      <section class="build-stats">
        <div class="stats-head">
          <div>
            <div class="brand-kicker">STATISTICS</div>
            <h3>${filtered.length} 条记录</h3>
          </div>
          <div class="stats-filters"><label for="statsModule">分类</label><select id="statsModule" aria-label="筛选 OS 分类">
            <option value="all">全部 OS</option>
            ${MODULES.map(([name])=>`<option value="${name}" ${statsModule===name ? "selected" : ""}>${name}</option>`).join("")}
          </select><div class="range-tabs">
            ${[["day","日"],["week","周"],["month","月"],["year","年"]].map(([k,l])=>`<button class="range-tab ${statsRange===k?"active":""}" data-range="${k}">${l}</button>`).join("")}
          </div></div>
        </div>
        <div class="stat-cards">
          <div class="stat-card"><span>记录数</span><strong>${filtered.length}</strong></div>
          <div class="stat-card"><span>活跃天数</span><strong>${Object.keys(byDate).length}</strong></div>
          <div class="stat-card"><span>投入时长</span><strong>${fmtDuration(totalMinutes)}</strong></div>
        </div>
        ${durationChart(filtered, statsRange)}
      </section>

      <section class="build-list">
        ${filtered.length ? filtered.map(x=>`
          <article class="build-item">
            <div>
              <div class="build-content">${escapeHtml(x.content)}</div>
              <div class="build-time">${fmtBuildTime(x.at)}${durationMinutes(x) ? ` · ${fmtDuration(durationMinutes(x))}` : " · 未记录时长"}</div>
              <div class="build-category">${MODULES.some(([name])=>name===x.module) ? x.module : "未分类"}</div>
              ${x.projectId?`<div class="muted">项目：${escapeHtml((state.projects || []).find(p=>p.id===x.projectId)?.title || '关联记录待同步')}</div>`:''}
            </div>
            <div class="build-actions"><button class="edit" data-edit-build="${x.id}">编辑</button><button class="edit" data-delete-build="${x.id}">删除</button></div>
          </article>
        `).join("") : `<div class="build-empty">这个时间范围还没有记录。先写下第一条。</div>`}
      </section>
    </main>
  `;
  bindNavigation();
  document.querySelector("#buildForm").onsubmit=(e)=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    let links; try {links=buildLinks(fd);} catch(error) {alert(error.message);return;}
    const entry={id:id(),...links, content:fd.get("content").trim(), at:fd.get("at"), duration:Number(fd.get("duration")), module:fd.get("module"),updatedAt:new Date().toISOString()};
    if (!entry.content || !validDay(String(entry.at).slice(0,10)) || !Number.isFinite(entry.duration) || entry.duration<=0 || entry.duration>1440) {alert('请检查记录内容、日期和时长');return;}
    buildItems.unshift(entry);
    saveBuild(buildItems); renderBuild();
  };
  document.querySelectorAll("[data-range]").forEach(el=>el.onclick=()=>{statsRange=el.dataset.range; renderBuild();});
  document.querySelector("#statsModule").onchange=e=>{statsModule=e.target.value; renderBuild();};
  document.querySelectorAll("[data-edit-build]").forEach(el=>el.onclick=()=>editBuild(buildItems.find(x=>x.id===el.dataset.editBuild)));
  document.querySelectorAll("[data-delete-build]").forEach(el=>el.onclick=()=>{
    state.deletedBuildItems=mergedDeletions(state.deletedBuildItems,[{key:el.dataset.deleteBuild,deletedAt:new Date().toISOString()}]);
    save(state);
    buildItems=buildItems.filter(x=>x.id!==el.dataset.deleteBuild);
    saveBuild(buildItems); renderBuild();
  });
}

function monthBuildItems() {
  return buildItems.filter(x=>String(x.at || "").slice(0,7)===monthPlan.month);
}
function renderMonth() {
  const monthTasks = state.tasks.filter(t=>String(t.date || "").slice(0,7)===monthPlan.month);
  const monthBuild = monthBuildItems();
  const totalMinutes = monthBuild.reduce((sum,x)=>sum+durationMinutes(x),0);
  const activeDays = new Set(monthBuild.map(x=>String(x.at).slice(0,10))).size;
  const moduleMinutes = MODULES.map(([name,sub])=>({
    name, sub, minutes:monthBuild.filter(x=>x.module===name).reduce((sum,x)=>sum+durationMinutes(x),0)
  }));
  const maxModule = Math.max(...moduleMinutes.map(x=>x.minutes),1);
  const now = new Date();
  const weekStart = currentWeekStart();
  const weekEnd = addDays(weekStart,6);
  const weekTasks = state.tasks.filter(t=>t.date>=weekStart && t.date<=weekEnd);
  const openWeek = weekTasks.filter(t=>!t.done).slice(0,3);
  const completed = monthTasks.filter(t=>t.done).length;
  document.querySelector("#app").innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div><div class="brand-kicker">L ↗ Life OS</div><h1>我的人生操作系统</h1></div>
        ${navHtml("month")}
      </header>
      <section class="month-hero">
        <div class="brand-kicker">MONTHLY OPERATING PAGE · ${monthPlan.label}</div>
        <h2>${escapeHtml(monthPlan.title)}</h2>
        <p class="month-theme">${escapeHtml(monthPlan.theme)}</p>
        <p class="month-principle">${escapeHtml(monthPlan.principle)}</p>
      </section>
      <section class="month-outcomes">
        ${monthPlan.outcomes.map((o,i)=>`<article class="outcome-card">
          <div class="outcome-no">0${i+1}</div><span class="badge">${o.module}</span>
          <h3>${escapeHtml(o.title)}</h3><p>${escapeHtml(o.detail)}</p>
        </article>`).join("")}
      </section>
      <section class="month-grid">
        <article class="month-panel">
          <div class="brand-kicker">BUILD THIS MONTH</div>
          <h3>${fmtDuration(totalMinutes)}</h3>
          <p>${monthBuild.length} 条记录 · ${activeDays} 个活跃日</p>
          <div class="module-bars">
            ${moduleMinutes.map(x=>`<div class="module-bar-row"><span>${x.name}</span><div class="module-bar-track"><div class="module-bar-fill" style="width:${x.minutes ? Math.max(5,x.minutes/maxModule*100):0}%"></div></div><strong>${fmtDuration(x.minutes)}</strong></div>`).join("")}
          </div>
        </article>
        <article class="month-panel">
          <div class="brand-kicker">MONTH PROGRESS</div>
          <h3>${completed} / ${monthTasks.length}</h3>
          <p>十月计划已完成</p>
          <div class="month-progress"><div style="width:${monthTasks.length ? completed/monthTasks.length*100 : 0}%"></div></div>
          <div class="month-note">重点不是把任务全部清空，而是让 Career、Health 和 Life OS 持续向前。</div>
        </article>
      </section>
      <section class="month-panel week-focus">
        <div><div class="brand-kicker">THIS WEEK · ${fmtRange(weekStart)}</div><h3>本周重点</h3></div>
        <div class="focus-list">
          ${openWeek.length ? openWeek.map(t=>`<div class="focus-item"><span class="badge">${t.module}</span><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(t.note||"")}</small></div>`).join("") : '<div class="build-empty">本周任务已完成，可以留一点空间给生活。</div>'}
        </div>
      </section>
      <div class="footer">这个月不是填满时间，而是重新拿回时间的使用权。</div>
    </main>`;
  bindNavigation();
}


function fmtSyncTime(value) {
  if (!value) return "尚未同步";
  const x = new Date(value);
  return Number.isNaN(x.getTime()) ? "尚未同步" : x.toLocaleString("zh-CN", { hour12:false });
}
function downloadBackup() {
  const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `life-os-backup-${iso(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result);
      if (!incoming || (incoming.version !== undefined && incoming.version !== 1) || !Array.isArray(incoming.planner?.tasks) || (incoming.buildItems !== undefined && !Array.isArray(incoming.buildItems))) throw new Error('备份格式不兼容');
      localStorage.setItem('life-os-before-import-backup',JSON.stringify(snapshot()));
      const merged = mergeSnapshot(incoming, snapshot());
      applySnapshot(merged);
      queueCloudSync();
      renderSync();
    } catch {
      alert("备份文件无法读取");
    }
  };
  reader.readAsText(file);
}
function importBackupText(raw) {
  const incoming=JSON.parse(raw);
  if (!incoming || (incoming.version !== undefined && incoming.version !== 1) || !Array.isArray(incoming.planner?.tasks) || (incoming.buildItems !== undefined && !Array.isArray(incoming.buildItems))) throw new Error('备份格式不兼容');
  localStorage.setItem('life-os-before-import-backup',JSON.stringify(snapshot()));
  applySnapshot(mergeSnapshot(incoming,snapshot()));
  queueCloudSync();
}
function renderSync() {
  const session = getCloudSession();
  const meta = getCloudMeta();
  const signedIn = Boolean(session?.access_token);
  const statusText = !cloudConfigured ? "等待云端配置" : signedIn ? (meta.status === "syncing" ? "正在同步" : meta.status === "error" ? "同步异常" : "云同步已连接") : "尚未登录";
  document.querySelector("#app").innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div><div class="brand-kicker">L ↗ Life OS</div><h1>我的人生操作系统</h1></div>
        ${navHtml("sync")}
      </header>
      <section class="sync-hero">
        <div class="brand-kicker">DATA SYNC</div>
        <h2>让记录跟着你，而不是跟着浏览器。</h2>
        <p>所有修改先保存在当前设备；连接云端后会自动备份，并在其他设备登录后合并历史记录。</p>
      </section>
      <section class="sync-grid">
        <article class="sync-card">
          <div class="brand-kicker">SYNC STATUS</div>
          <h3>${statusText}</h3>
          <p>最近同步：${fmtSyncTime(meta.lastSyncedAt)}</p>
          ${meta.error ? `<div class="sync-error">同步失败：${escapeHtml(meta.error)}。本地记录仍在，可点击“立即同步”重试。</div>` : ""}
          ${!cloudConfigured ? `<div class="sync-callout">同步代码已经就绪，还需要 Supabase Project URL 与 anon public key 才能启用真正的跨设备云同步。</div>` : ""}
          ${cloudConfigured && !signedIn ? `
            <form id="syncLoginForm" class="sync-form">
              <input name="email" type="email" placeholder="邮箱" autocomplete="email" required />
              <input name="password" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password" minlength="6" required />
              <div class="sync-actions"><button class="btn primary" name="action" value="login">登录并同步</button><button class="btn" type="button" id="syncSignup">创建账号</button></div>
            </form>` : ""}
          ${signedIn ? `<div class="sync-actions"><button class="btn primary" id="syncNow">立即同步</button><button class="btn" id="syncLogout">退出云同步</button></div>` : ""}
        </article>
        <article class="sync-card">
          <div class="brand-kicker">LOCAL BACKUP</div>
          <h3>手动备份保险</h3>
          <p>即使云端还没启用，也可以先把当前 Weekly 与 Build 历史导出成一个 JSON 文件。</p>
          <div class="sync-actions"><button class="btn primary" id="exportBackup">导出备份</button><button class="btn" id="exportUpgradeBackup" ${localStorage.getItem(PRE_V1_BACKUP_KEY)?'':'disabled'}>导出升级前备份</button><label class="btn import-label">导入备份<input id="importBackup" type="file" accept="application/json,.json" hidden /></label></div>
          <details class="backup-text"><summary>文本备份与跨站迁移</summary><p>备份只包含任务和记录，不含登录凭据。导入会合并现有数据，并保留导入前快照。</p><button class="btn" id="showBackupText">读取当前备份</button><label for="backupJson">备份 JSON</label><textarea id="backupJson" aria-label="备份 JSON" spellcheck="false"></textarea><button class="btn" id="importBackupText">合并导入文本备份</button><p id="backupTextStatus" role="status"></p></details>
        </article>
      </section>
      <section class="sync-card sync-explain">
        <div class="brand-kicker">HOW IT WORKS</div>
        <h3>本地优先，云端兜底</h3>
        <p>记录时不会等待网络；先写入手机本地，再自动上传云端。新设备登录时会先合并本地与云端数据，再写回云端，避免第一次同步把旧历史覆盖。</p>
      </section>
    </main>`;
  bindNavigation();
  document.querySelector("#exportBackup").onclick=downloadBackup;
  document.querySelector('#showBackupText').onclick=()=>{document.querySelector('#backupJson').value=JSON.stringify(snapshot());document.querySelector('#backupTextStatus').textContent='已读取当前备份，可复制保存';};
  document.querySelector('#importBackupText').onclick=()=>{
    try {importBackupText(document.querySelector('#backupJson').value);document.querySelector('#backupTextStatus').textContent='已合并到当前设备；登录后可云同步';}
    catch(error) {document.querySelector('#backupTextStatus').textContent=`导入失败：${error.message}`;}
  };
  document.querySelector('#exportUpgradeBackup').onclick=()=>{
    const raw=localStorage.getItem(PRE_V1_BACKUP_KEY);if(!raw) return;
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='life-os-before-v1-backup.json';a.click();URL.revokeObjectURL(url);
  };
  document.querySelector("#importBackup").onchange=e=>{if(e.target.files?.[0]) importBackup(e.target.files[0]);};
  if (cloudConfigured && !signedIn) {
    const form=document.querySelector("#syncLoginForm");
    form.onsubmit=async e=>{
      e.preventDefault();
      const fd=new FormData(form);
      try { await signIn(fd.get("email"),fd.get("password")); await syncNow(); renderSync(); }
      catch(err) { alert(`登录失败：${err.message}`); }
    };
    document.querySelector("#syncSignup").onclick=async()=>{
      const fd=new FormData(form);
      const email=String(fd.get("email")||"").trim(), password=String(fd.get("password")||"");
      if (!email || password.length<6) return alert("先填写邮箱和至少 6 位密码");
      try {
        const result=await signUp(email,password);
        alert(result?.access_token ? "账号已创建并登录" : "账号已创建，请按邮箱提示完成验证后再登录");
        if (result?.access_token) { await syncNow(); renderSync(); }
      } catch(err) { alert(`创建失败：${err.message}`); }
    };
  }
  if (signedIn) {
    document.querySelector("#syncNow").onclick=async()=>{try{await syncNow();renderSync();}catch(err){alert(`同步失败：${err.message}`);}};
    document.querySelector("#syncLogout").onclick=()=>{signOut();renderSync();};
  }
}

function render() {
  const todayISO = iso(new Date());
  const isCurrentWeek = state.weekStart === currentWeekStart();
  const dates=weekDates(state.weekStart);
  const visible=state.tasks.filter(t=>dates.includes(t.date));
  const done=visible.filter(t=>t.done).length;
  const pct=visible.length?Math.round(done/visible.length*100):0;

  document.querySelector("#app").innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div><div class="brand-kicker">L ↗ Life OS</div><h1>我的人生操作系统</h1></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          ${navHtml("planner")}
          <div class="local-note">本地即时保存 · 云同步可用后自动备份</div>
        </div>
      </header>

      <section class="hero">
        <div>
          <div class="brand-kicker">WEEKLY OVERVIEW</div>
          <h2>每一步，都算数。</h2>
          <p>在解决问题的同时，<br/>继续把今天过好。</p>
        </div>
        <div class="progress-card">
          <div class="progress-ring" style="--p:${pct}%"><strong>${pct}%</strong></div>
          <div><div class="muted">本周完成度</div><div style="font-size:18px;margin-top:6px">${done} / ${visible.length} 项已完成</div></div>
        </div>
      </section>

      <section>
        <div class="brand-kicker">五个生活模块</div>
        <div class="modules">
          ${MODULES.map(([name,sub])=>{
            const ts=visible.filter(t=>t.module===name);
            return `<div class="module"><div><div class="module-name">${name}</div><div class="module-sub">${sub}</div></div><div class="module-count">${ts.filter(t=>t.done).length} / ${ts.length}</div></div>`;
          }).join("")}
        </div>
      </section>

      <section class="priority">
        <strong>这周最重要的两件事</strong>
        <span>${({"2026-09-21":"好好体验旅程 · 留下实际记录","2026-09-28":"享受旅程 · 平稳返程","2026-10-05":"完成离职收尾 · 简历起步","2026-10-12":"简历成稿 · AI 数据练习","2026-10-19":"岗位投递 · 项目小样","2026-10-26":"复盘求职 · 规划十一月"})[state.weekStart] || "选定一件重要的事 · 留一次周复盘"}</span>
        <span class="muted">一步一步，把生活过好</span>
      </section>

      <section class="planner">
        <div class="planner-head">
          <div class="planner-title">
            <h3>${isCurrentWeek ? "本周计划" : "周计划"}　${fmtRange(state.weekStart)}</h3>
            <p>每次做好眼前这一件事。 · ${visible.filter(t=>!t.done).length} 项待完成</p>
          </div>
          <div class="actions">
            <button class="btn primary" id="addTop">新增任务</button>
            <button class="btn" id="prevWeek">上一周</button>
            <button class="btn" id="thisWeek">本周</button>
            <button class="btn" id="nextWeek">下一周</button>
          </div>
        </div>
        <div class="days">
          ${dates.map(date=>{
            const dd=d(date), ts=visible.filter(t=>t.date===date);
            return `<article class="day ${date===todayISO?"today":""}">
              <div class="day-head">
                <div><div class="day-title">${weekday[dd.getDay()]}${date===todayISO?" · 今天":""}</div><div class="day-date">${String(dd.getMonth()+1).padStart(2,"0")}月${String(dd.getDate()).padStart(2,"0")} 日</div></div>
                <div class="day-count">${ts.filter(t=>t.done).length} / ${ts.length} 完成</div>
              </div>
              <div>
                ${ts.length?ts.map(t=>`
                  <div class="task ${t.done?"done":""}">
                    <div class="task-row">
                      <button class="check ${t.done?"done":""}" data-check="${t.id}" aria-label="完成">${t.done?"✓":""}</button>
                      <div class="task-title">${escapeHtml(t.title)}</div>
                    </div>
                    ${t.note?`<div class="task-note">${escapeHtml(t.note)}</div>`:""}
                    <div class="task-meta"><span class="badge">${t.module}</span><button class="edit" data-edit="${t.id}">编辑</button></div>
                  </div>`).join(""):`<div class="empty">这一天还没有任务。</div>`}
                <button class="add-task" data-add="${date}">＋ 添加任务</button>
              </div>
            </article>`;
          }).join("")}
        </div>
        <div class="footer">不用一次解决所有问题。完成一件，就是向前一步。</div>
      </section>
    </main>
  `;
  bindNavigation();
  document.querySelectorAll("[data-check]").forEach(el=>el.onclick=()=>{
    state.tasks=state.tasks.map(t=>t.id===el.dataset.check?{...t,done:!t.done,updatedAt:new Date().toISOString()}:t); save(state); render();
  });
  document.querySelectorAll("[data-edit]").forEach(el=>el.onclick=()=>openEditor(state.tasks.find(t=>t.id===el.dataset.edit)));
  document.querySelectorAll("[data-add]").forEach(el=>el.onclick=()=>openEditor({}, el.dataset.add));
  document.querySelector("#addTop").onclick=()=>openEditor({}, dates[0]);
  document.querySelector("#prevWeek").onclick=()=>{state.weekStart=addDays(state.weekStart,-7); save(state); render();};
  document.querySelector("#nextWeek").onclick=()=>{state.weekStart=addDays(state.weekStart,7); save(state); render();};
  document.querySelector("#thisWeek").onclick=()=>{state.weekStart=currentWeekStart(); addCurrentPlan(state); save(state); render();};
}
window.addEventListener('hashchange',()=>{
  const view=location.hash.slice(1);
  if(VIEWS.includes(view) && view!==currentView) {currentView=view;renderCurrentView();}
});
renderCurrentView();
initializeCloudSync();
