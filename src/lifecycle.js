// Additive V1 data model. Existing tasks, notes and Build records stay intact.
export const COLLECTIONS = ['goals', 'projects', 'plans', 'captures', 'periodReviews'];
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(+date) && localDay(date) === value;
}
export function periodBounds(kind, day = localDay()) {
  if (!validDay(day) || !['week','month'].includes(kind)) throw new Error('请选择有效的周期日期');
  const start = new Date(`${day}T12:00:00`), end = new Date(start);
  if (kind === 'week') {
    start.setDate(start.getDate() - (start.getDay()+6)%7);
    end.setTime(+start); end.setDate(end.getDate()+6);
  } else {
    start.setDate(1); end.setMonth(end.getMonth()+1,0);
  }
  return {start:localDay(start),end:localDay(end)};
}
const stamp = item => Date.parse(item?.updatedAt || '') || 0;
export function mergeRecords(a = [], b = [], conflicts = []) {
  const map = new Map();
  for (const item of [...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])]) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    const previous = map.get(item.id);
    if (!previous) { map.set(item.id,{...item}); continue; }
    const winner = stamp(item) > stamp(previous) || (stamp(item) === stamp(previous) && JSON.stringify(item) > JSON.stringify(previous)) ? item : previous;
    const loser = winner === item ? previous : item;
    if (JSON.stringify(previous) !== JSON.stringify(item)) conflicts.push({id:item.id, winner:{...winner}, alternative:{...loser}});
    map.set(item.id,{...winner});
  }
  return [...map.values()];
}
export function normalizeLifecycle(planner = {}) {
  const next = {...planner, lifecycleVersion:1};
  for (const name of COLLECTIONS) next[name] = mergeRecords(planner[name]);
  return next;
}
export function mergeLifecycle(cloud = {}, local = {}) {
  const next = {};
  for (const name of COLLECTIONS) next[name] = mergeRecords(cloud[name],local[name]);
  const policies=[cloud.carryoverPolicy,local.carryoverPolicy].filter(p=>p && validDay(p.fromDate)).map(p=>({...p,id:'carryover'}));
  if(policies.length) next.carryoverPolicy=mergeRecords(policies)[0];
  return next;
}
export function canCarryTask(task,day,policy) {
  return Boolean(task && !task.done && validDay(task.date) && validDay(day) && task.date<day && (!validDay(policy?.fromDate) || task.date>=policy.fromDate));
}
function text(value, max=280) { return String(value || '').trim().slice(0,max); }
function required(value, label) {
  const result = text(value);
  if (!result) throw new Error(`请填写${label}`);
  return result;
}
function exists(items, id) { return items.find(item => item.id === id && !item.archived); }
export function upsertEntity(planner, kind, input, makeId, now = new Date().toISOString()) {
  if (!COLLECTIONS.includes(kind)) throw new Error('未知记录类型');
  const state = normalizeLifecycle(planner), items = state[kind];
  const reviewKey = kind === 'periodReviews' ? `review:${input.kind}:${periodBounds(input.kind,input.period).start}` : '';
  const previous = items.find(item=>item.id === (input.id || reviewKey));
  if (input.id && !previous) throw new Error('记录不存在，请刷新');
  const updatedAt = new Date(Math.max(Date.parse(now),stamp(previous)+1)).toISOString();
  let item = {...previous,id:previous?.id || makeId(),updatedAt};
  if (['goals','projects','captures'].includes(kind)) item.title = required(input.title,'名称');
  if (kind === 'goals') {
    if (input.deadline && !validDay(input.deadline)) throw new Error('目标日期无效');
    item = {...item,metric:required(input.metric,'成果衡量标准'),deadline:input.deadline || '',archived:input.archived === undefined ? Boolean(previous?.archived) : Boolean(input.archived)};
  }
  if (kind === 'projects') {
    if (!exists(state.goals,input.goalId) && previous?.goalId !== input.goalId) throw new Error('请选择有效的长期目标');
    item = {...item,goalId:input.goalId,milestone:text(input.milestone),archived:input.archived === undefined ? Boolean(previous?.archived) : Boolean(input.archived)};
  }
  if (kind === 'plans') {
    if (!exists(state.projects,input.projectId) && previous?.projectId !== input.projectId) throw new Error('请选择有效的项目');
    const bounds = periodBounds(input.kind,input.period);
    const parent = input.parentId ? state.plans.find(p=>p.id === input.parentId && p.kind === 'month' && p.projectId === input.projectId && p.period <= bounds.end && p.end >= bounds.start) : null;
    if (input.parentId && (input.kind !== 'week' || !parent)) throw new Error('周计划请选择同项目、相交月份的月计划');
    item = {...item,kind:input.kind,period:bounds.start,end:bounds.end,projectId:input.projectId,parentId:parent?.id || '',outcome:required(input.outcome,'预期成果')};
  }
  if (kind === 'captures') item = {...item,note:text(input.note,1000),scheduledTaskId:previous?.scheduledTaskId || ''};
  if (kind === 'periodReviews') {
    const bounds = periodBounds(input.kind,input.period);
    // One review per period, even when two offline devices create it independently.
    item = {...item,id:`review:${input.kind}:${bounds.start}`,kind:input.kind,period:bounds.start,end:bounds.end,
      summary:text(input.summary,2000),blockers:text(input.blockers,2000),nextStep:text(input.nextStep,1000)};
  }
  state[kind] = mergeRecords(items,[item]);
  return state;
}
export function scheduleCapture(planner, captureId, date, projectId, makeId, now = new Date().toISOString()) {
  if (!validDay(date)) throw new Error('请选择有效的安排日期');
  const state = normalizeLifecycle(planner), capture = state.captures.find(c=>c.id===captureId);
  if (!capture) throw new Error('待办不存在');
  if (capture.scheduledTaskId) return state;
  if (projectId && !exists(state.projects,projectId)) throw new Error('项目不存在');
  const taskId = `capture:${capture.id}`;
  const task = {id:taskId,title:capture.title,note:capture.note || '',date,module:'Career OS',done:false,projectId:projectId || '',updatedAt:now,captureId:capture.id};
  state.tasks = [...(state.tasks || []),task];
  state.captures = state.captures.map(c=>c.id===captureId?{...c,scheduledTaskId:taskId,updatedAt:now}:c);
  return state;
}
export function periodStats(planner, builds, kind, day, projectId = '') {
  const bounds = periodBounds(kind,day);
  const tasks = (planner.tasks || []).filter(t=>t.date>=bounds.start && t.date<=bounds.end && (!projectId || t.projectId===projectId));
  const entries = (builds || []).filter(b=>String(b.at || '').slice(0,10)>=bounds.start && String(b.at || '').slice(0,10)<=bounds.end && (!projectId || b.projectId===projectId || tasks.some(t=>t.id===b.taskId)));
  const minutes = entries.reduce((sum,b)=>sum+(Number.isFinite(Number(b.duration)) && Number(b.duration)>0?Number(b.duration):0),0);
  const done = tasks.filter(t=>t.done).length;
  const plans = (planner.plans || []).filter(p=>p.kind===kind && p.period===bounds.start && (!projectId || p.projectId===projectId));
  return {...bounds,tasks,done,total:tasks.length,rate:tasks.length?Math.round(done/tasks.length*100):0,minutes,entries,plans};
}
export function linkedTask(planner, projectId, planId) {
  const state = normalizeLifecycle(planner);
  if (projectId && !state.projects.some(p=>p.id===projectId)) throw new Error('关联项目不存在');
  const plan = planId ? state.plans.find(p=>p.id===planId) : null;
  if (planId && (!plan || plan.projectId !== projectId)) throw new Error('计划与项目不一致');
  return {projectId:projectId || '',planId:planId || ''};
}
export function tasksForPlan(planner, planId) {
  const ids=new Set([planId,...(planner.plans || []).filter(p=>p.parentId===planId).map(p=>p.id)]);
  return (planner.tasks || []).filter(task=>ids.has(task.planId));
}
