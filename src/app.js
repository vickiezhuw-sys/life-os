import "./style.css";
import baseline from "./baseline-data.json";

const MODULES = [
  ["Health OS", "身体重建"],
  ["Wealth OS", "财务地基"],
  ["Experience OS", "生活体验"],
  ["Career OS", "职业成长"],
  ["Inner OS", "内在秩序"],
];

const STORE_KEY = "life-os-weekly-planner-v1";
const BUILD_KEY = "life-os-build-v1";
let currentView = "planner";
let statsRange = "day";

function loadBuild() {
  try {
    const v = JSON.parse(localStorage.getItem(BUILD_KEY));
    if (Array.isArray(v)) return v;
  } catch {}
  return [];
}
function saveBuild(items) {
  localStorage.setItem(BUILD_KEY, JSON.stringify(items));
}
let buildItems = loadBuild();
const BASE_WEEK_START = "2026-09-07";
const todayISO = "2026-09-09"; // v1 baseline snapshot

function id() {
  return (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
}
function seed() {
  return baseline.map(t => ({...t, id:id(), done:false}));
}
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    if (v && Array.isArray(v.tasks)) return v;
  } catch {}
  const v = { weekStart: BASE_WEEK_START, tasks: seed() };
  save(v);
  return v;
}
function save(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}
let state = load();

function d(iso) { return new Date(`${iso}T00:00:00`); }
function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function addDays(isoDate, n) {
  const x=d(isoDate); x.setDate(x.getDate()+n); return iso(x);
}
function weekDates(start) { return [2,3,4,5,6].map(x=>addDays(start,x)); } // Wed-Sun baseline
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
    state.tasks=state.tasks.filter(x=>x.id!==task.id); save(state); modal.remove(); render();
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
    save(state); modal.remove(); render();
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
function renderBuild() {
  const filtered = buildItems.filter(x=>inRange(x, statsRange)).sort((a,b)=>new Date(b.at)-new Date(a.at));
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
        <div class="view-tabs">
          <button class="view-tab" id="toPlanner">Weekly</button>
          <button class="view-tab active">Build</button>
        </div>
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
          <div class="range-tabs">
            ${[["day","日"],["week","周"],["month","月"],["year","年"]].map(([k,l])=>`<button class="range-tab ${statsRange===k?"active":""}" data-range="${k}">${l}</button>`).join("")}
          </div>
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
            </div>
            <button class="edit" data-delete-build="${x.id}">删除</button>
          </article>
        `).join("") : `<div class="build-empty">这个时间范围还没有记录。先写下第一条。</div>`}
      </section>
    </main>
  `;
  document.querySelector("#toPlanner").onclick=()=>{currentView="planner"; render();};
  document.querySelector("#buildForm").onsubmit=(e)=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    buildItems.unshift({id:id(), content:fd.get("content").trim(), at:fd.get("at"), duration:Number(fd.get("duration"))});
    saveBuild(buildItems); renderBuild();
  };
  document.querySelectorAll("[data-range]").forEach(el=>el.onclick=()=>{statsRange=el.dataset.range; renderBuild();});
  document.querySelectorAll("[data-delete-build]").forEach(el=>el.onclick=()=>{
    buildItems=buildItems.filter(x=>x.id!==el.dataset.deleteBuild);
    saveBuild(buildItems); renderBuild();
  });
}

function render() {
  const dates=weekDates(state.weekStart);
  const visible=state.tasks.filter(t=>dates.includes(t.date));
  const done=visible.filter(t=>t.done).length;
  const pct=visible.length?Math.round(done/visible.length*100):0;

  document.querySelector("#app").innerHTML = `
    <main class="shell">
      <header class="topbar">
        <div><div class="brand-kicker">L ↗ Life OS</div><h1>我的人生操作系统</h1></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div class="view-tabs">
            <button class="view-tab active">Weekly</button>
            <button class="view-tab" id="toBuild">Build</button>
          </div>
          <div class="local-note">进度保存在此浏览器</div>
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
        <span>出去体验一次 · 把负债盘清楚</span>
        <span class="muted">一步一步，把生活过好</span>
      </section>

      <section class="planner">
        <div class="planner-head">
          <div class="planner-title">
            <h3>本周计划　${fmtRange(state.weekStart)}</h3>
            <p>从今天到周末，专注眼前这一件事。 · ${visible.filter(t=>!t.done).length} 项待完成</p>
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
  document.querySelectorAll("[data-check]").forEach(el=>el.onclick=()=>{
    state.tasks=state.tasks.map(t=>t.id===el.dataset.check?{...t,done:!t.done}:t); save(state); render();
  });
  document.querySelectorAll("[data-edit]").forEach(el=>el.onclick=()=>openEditor(state.tasks.find(t=>t.id===el.dataset.edit)));
  document.querySelectorAll("[data-add]").forEach(el=>el.onclick=()=>openEditor({}, el.dataset.add));
  document.querySelector("#addTop").onclick=()=>openEditor({}, dates[0]);
  document.querySelector("#prevWeek").onclick=()=>{state.weekStart=addDays(state.weekStart,-7); save(state); render();};
  document.querySelector("#nextWeek").onclick=()=>{state.weekStart=addDays(state.weekStart,7); save(state); render();};
  document.querySelector("#thisWeek").onclick=()=>{state.weekStart=BASE_WEEK_START; save(state); render();};
  document.querySelector("#toBuild").onclick=()=>{currentView="build"; renderBuild();};
}
render();
