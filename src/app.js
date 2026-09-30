import "./style.css";
import baseline from "./baseline-data.json";
import currentWeekPlan from "./current-week-data.json";
import sepOctPlan from "./sep-oct-plan.json";
import monthPlan from "./month-plan.json";
import { cloudConfigured, getCloudSession, getCloudMeta, signIn, signUp, signOut, pullCloudSnapshot, pushCloudSnapshot } from "./sync.js";

const MODULES = [
  ["Health OS", "身体重建"],
  ["Wealth OS", "财务地基"],
  ["Experience OS", "生活体验"],
  ["Career OS", "职业成长"],
  ["Inner OS", "内在秩序"],
];

const STORE_KEY = "life-os-weekly-planner-v1";
const BUILD_KEY = "life-os-build-v1";
let currentView = "day";
let statsRange = "day";
let statsModule = "all";
let cloudSyncReady = false;
let syncTimer = null;

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
let buildItems = loadBuild();
const PLAN_WEEK_START = "2026-09-21";
const MONTH_PLAN_VERSION = "2026-09-26-october-v1";
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
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    if (v && Array.isArray(v.tasks)) {
      v.weekStart = currentWeekStart();
      addCurrentPlan(v);
      addMonthlyPlan(v);
      save(v);
      return v;
    }
  } catch {}
  const v = addMonthlyPlan(addCurrentPlan({ weekStart: currentWeekStart(), tasks: seed() }));
  save(v);
  return v;
}
function save(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (cloudSyncReady) queueCloudSync();
}
let state = load();

function snapshot() {
  return {
    version: 1,
    planner: state,
    buildItems,
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
    tasks: mergeByKey(
      cloudPlanner.tasks || [],
      localPlanner.tasks || [],
      item => item.id || `${item.date || ""}|${item.title || ""}`
    )
  };
  const builds = mergeByKey(
    cloudPayload.buildItems || [],
    localPayload.buildItems || [],
    item => item.id || `${item.at || ""}|${item.content || ""}`
  );
  return { version: 1, planner, buildItems: builds, savedAt: new Date().toISOString() };
}
function applySnapshot(payload) {
  if (!payload) return;
  if (payload.planner?.tasks) state = payload.planner;
  if (Array.isArray(payload.buildItems)) buildItems = payload.buildItems;
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  localStorage.setItem(BUILD_KEY, JSON.stringify(buildItems));
}
function queueCloudSync() {
  if (!cloudConfigured || !getCloudSession()?.access_token) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushCloudSnapshot(snapshot()).catch(()=>{}), 700);
}
async function syncNow() {
  if (!cloudConfigured || !getCloudSession()?.access_token) return false;
  const row = await pullCloudSnapshot();
  const merged = row?.payload ? mergeSnapshot(row.payload, snapshot()) : snapshot();
  applySnapshot(merged);
  await pushCloudSnapshot(merged);
  return true;
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
  else render();
}

function navHtml(active) {
  const items = [
    ["day", "Day"],
    ["planner", "Weekly"],
    ["month", "Month"],
    ["build", "Build"],
    ["sync", "Sync"],
  ];
  return `<div class="view-tabs">${items.map(([key,label])=>`<button class="view-tab ${active===key?"active":""}" data-nav="${key}">${label}</button>`).join("")}</div>`;
}
function bindNavigation() {
  document.querySelectorAll("[data-nav]").forEach(el=>el.onclick=()=>{
    currentView = el.dataset.nav;
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
    state.tasks=state.tasks.filter(x=>x.id!==task.id); save(state); modal.remove(); renderCurrentView();
  };
  modal.querySelector("#taskForm").onsubmit=(e)=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const next = {
      id: task.id || id(),
      done: task.done || false,
      date: fd.get("date"),
      module: fd.get("module"),
      title: fd.get("title").trim(),
      note: fd.get("note").trim()
    };
    if (editing) state.tasks=state.tasks.map(x=>x.id===task.id?next:x);
    else state.tasks.push(next);
    save(state); modal.remove(); renderCurrentView();
  };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
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
    <div class="modal-actions"><button type="button" class="btn" id="cancelBuildEdit">取消</button><button class="btn primary">保存</button></div>
  </form>`;
  document.body.append(modal);
  modal.querySelector("#cancelBuildEdit").onclick=()=>modal.remove();
  modal.onclick=e=>{if(e.target===modal) modal.remove();};
  modal.querySelector("form").onsubmit=e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const updated={...item,content:fd.get("content").trim(),at:fd.get("at"),duration:fd.get("duration") ? Number(fd.get("duration")) : 0,module:fd.get("module")};
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
                </div>
                <button class="edit" data-day-edit="${t.id}">编辑</button>
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
    </main>`;

  bindNavigation();
  document.querySelectorAll("[data-day-check]").forEach(el=>el.onclick=()=>{
    state.tasks=state.tasks.map(t=>t.id===el.dataset.dayCheck?{...t,done:!t.done}:t);
    save(state);
    renderDay();
  });
  document.querySelectorAll("[data-day-edit]").forEach(el=>el.onclick=()=>openEditor(state.tasks.find(t=>t.id===el.dataset.dayEdit), today));
  document.querySelector("#addTodayTask").onclick=()=>openEditor({}, today);
  document.querySelector("[data-jump-build]").onclick=()=>{currentView="build"; renderBuild();};

  const noteEl=document.querySelector("#dailyNote");
  let noteTimer=null;
  noteEl.oninput=()=>{
    const value=noteEl.value;
    document.querySelector(".day-note-foot span:last-child").textContent=`${value.length}/280`;
    document.querySelector("#noteStatus").textContent="保存中…";
    clearTimeout(noteTimer);
    noteTimer=setTimeout(()=>{
      state.dailyNotes={...(state.dailyNotes||{}),[today]:value};
      save(state);
      document.querySelector("#noteStatus").textContent="已保存 · 会随云同步备份";
    },450);
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
    buildItems.unshift({id:id(), content:fd.get("content").trim(), at:fd.get("at"), duration:Number(fd.get("duration")), module:fd.get("module")});
    saveBuild(buildItems); renderBuild();
  };
  document.querySelectorAll("[data-range]").forEach(el=>el.onclick=()=>{statsRange=el.dataset.range; renderBuild();});
  document.querySelector("#statsModule").onchange=e=>{statsModule=e.target.value; renderBuild();};
  document.querySelectorAll("[data-edit-build]").forEach(el=>el.onclick=()=>editBuild(buildItems.find(x=>x.id===el.dataset.editBuild)));
  document.querySelectorAll("[data-delete-build]").forEach(el=>el.onclick=()=>{
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
          ${meta.error ? `<div class="sync-error">${escapeHtml(meta.error)}</div>` : ""}
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
          <div class="sync-actions"><button class="btn primary" id="exportBackup">导出备份</button><label class="btn import-label">导入备份<input id="importBackup" type="file" accept="application/json,.json" hidden /></label></div>
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
    state.tasks=state.tasks.map(t=>t.id===el.dataset.check?{...t,done:!t.done}:t); save(state); render();
  });
  document.querySelectorAll("[data-edit]").forEach(el=>el.onclick=()=>openEditor(state.tasks.find(t=>t.id===el.dataset.edit)));
  document.querySelectorAll("[data-add]").forEach(el=>el.onclick=()=>openEditor({}, el.dataset.add));
  document.querySelector("#addTop").onclick=()=>openEditor({}, dates[0]);
  document.querySelector("#prevWeek").onclick=()=>{state.weekStart=addDays(state.weekStart,-7); save(state); render();};
  document.querySelector("#nextWeek").onclick=()=>{state.weekStart=addDays(state.weekStart,7); save(state); render();};
  document.querySelector("#thisWeek").onclick=()=>{state.weekStart=currentWeekStart(); addCurrentPlan(state); save(state); render();};
}
renderDay();
initializeCloudSync();
