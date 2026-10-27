import { normalizeLifecycle, upsertEntity, scheduleCapture, periodStats, periodBounds, localDay, tasksForPlan } from './lifecycle.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const options = (items,label,selected='') => `<option value="">${esc(label)}</option>` + items.map(item=>`<option value="${esc(item.id)}" ${item.id===selected?'selected':''}>${esc(item.title || item.outcome)}</option>`).join('');
const field = (label,content) => `<label>${label}${content}</label>`;
const input = (name,placeholder='',required=false,type='text') => `<input name="${name}" type="${type}" placeholder="${placeholder}" ${required?'required':''} maxlength="280" />`;
let reviewKind='week', reviewDay=localDay();

export function renderLifecycle(host, mode='goals') {
  const planner=normalizeLifecycle(host.getState()), builds=host.getBuilds();
  const goals=planner.goals, projects=planner.projects, plans=planner.plans;
  const activeGoals=goals.filter(g=>!g.archived), activeProjects=projects.filter(p=>!p.archived);
  const stats=periodStats(planner,builds,reviewKind,reviewDay);
  const reviewId=`review:${reviewKind}:${stats.start}`;
  const review=planner.periodReviews.find(r=>r.id===reviewId) || {};
  const goalName=id=>goals.find(g=>g.id===id)?.title || '未关联目标';
  const projectName=id=>projects.find(p=>p.id===id)?.title || '未关联项目';
  const error='<p id="lifecycleError" class="sync-error" role="alert" hidden></p>';
  const goalForm=`<form id="goalForm" class="cycle-form"><h3>长期目标</h3><input name="id" type="hidden" />${field('目标名称',input('title','例如：获得适合的 AI 数据岗位',true))}${field('衡量标准',input('metric','可验证的成果，而不是投入小时数',true))}${field('目标日期（可选）',input('deadline','',false,'date'))}<button class="btn primary">保存目标</button></form>`;
  const projectForm=`<form id="projectForm" class="cycle-form"><h3>项目与里程碑</h3><input name="id" type="hidden" />${field('项目名称',input('title','为目标推进的一项具体工作',true))}${field('所属目标',`<select name="goalId" required>${options(activeGoals,'选择目标')}</select>`)}${field('下一个里程碑',input('milestone','下一项可交付成果'))}<button class="btn primary" ${activeGoals.length?'':'disabled'}>保存项目</button></form>`;
  const planForm=`<form id="planForm" class="cycle-form"><h3>月计划 → 周计划</h3><input name="id" type="hidden" />${field('所属项目',`<select name="projectId" required>${options(activeProjects,'选择项目')}</select>`)}${field('计划周期','<select name="kind"><option value="month">月计划</option><option value="week">周计划</option></select>')}${field('周期内任一日期',`<input name="period" type="date" value="${localDay()}" required />`)}${field('关联月计划（周计划可选）',`<select name="parentId">${options(plans.filter(p=>p.kind==='month'),'不关联月计划')}</select>`)}${field('本周期要交付的成果',input('outcome','明确做到什么程度',true))}<button class="btn primary" ${activeProjects.length?'':'disabled'}>保存计划</button></form>`;
  const cards=goals.map(goal=>`<article class="cycle-card"><div class="cycle-heading"><h3>${esc(goal.title)}</h3><span class="badge">${goal.archived?'已归档':'长期目标'}</span></div><p>成果标准：${esc(goal.metric)}</p><p>${goal.deadline?`目标日期：${esc(goal.deadline)}`:'未设截止日期'}</p><div class="actions"><button class="btn" data-entity-edit="goals" data-id="${esc(goal.id)}">编辑目标</button><button class="btn" data-archive="goals" data-id="${esc(goal.id)}">${goal.archived?'恢复':'归档'}</button></div>${projects.filter(p=>p.goalId===goal.id).map(project=>{
    const tasks=planner.tasks.filter(t=>t.projectId===project.id), done=tasks.filter(t=>t.done).length;
    const minutes=builds.filter(b=>b.projectId===project.id || tasks.some(t=>t.id===b.taskId)).reduce((sum,b)=>sum+(Number.isFinite(Number(b.duration))&&Number(b.duration)>0?Number(b.duration):0),0);
    return `<div class="cycle-project"><h4>${esc(project.title)} ${project.archived?'<span class="badge">已归档</span>':''}</h4><p>下一里程碑：${esc(project.milestone || '待填写')}</p><p>任务 ${done}/${tasks.length} · 记录投入 ${minutes} 分钟</p><div class="actions"><button class="btn" data-entity-edit="projects" data-id="${esc(project.id)}">编辑项目</button><button class="btn" data-project-task="${esc(project.id)}">添加任务</button><button class="btn" data-archive="projects" data-id="${esc(project.id)}">${project.archived?'恢复':'归档'}</button></div>${tasks.map(t=>`<button class="cycle-task" data-linked-task="${esc(t.id)}">${t.done?'✓':'○'} ${esc(t.date)} · ${esc(t.title)}</button>`).join('')}</div>`;
  }).join('')}</article>`).join('');
  const planCards=plans.map(plan=>{
    const tasks=tasksForPlan(planner,plan.id), done=tasks.filter(t=>t.done).length;
    return `<article class="cycle-card"><span class="brand-kicker">${plan.kind==='month'?'月计划':'周计划'} · ${esc(plan.period)} — ${esc(plan.end)}</span><h3>${esc(plan.outcome)}</h3><p>${esc(goalName(projects.find(p=>p.id===plan.projectId)?.goalId))} → ${esc(projectName(plan.projectId))}</p>${plan.parentId?`<p>月计划：${esc(plans.find(p=>p.id===plan.parentId)?.outcome || '关联记录待同步')}</p>`:''}<p>关联任务：${done}/${tasks.length} 已完成</p><div class="actions"><button class="btn" data-entity-edit="plans" data-id="${esc(plan.id)}">编辑计划</button><button class="btn" data-plan-task="${esc(plan.id)}">拆成每日任务</button></div>${tasks.map(t=>`<button class="cycle-task" data-linked-task="${esc(t.id)}">${t.done?'✓':'○'} ${esc(t.date)} · ${esc(t.title)}</button>`).join('')}</article>`;
  }).join('');
  const inbox=`<section class="cycle-card"><h3>快速捕获</h3><p>先记下来，再选择项目和日期。</p><form id="captureForm" class="cycle-inline">${input('title','记下一件要做的事',true)}<button class="btn primary">加入收集箱</button></form>${planner.captures.filter(c=>!c.scheduledTaskId).map(c=>`<form class="capture-schedule cycle-form" data-capture="${esc(c.id)}"><strong>${esc(c.title)}</strong>${field('安排日期',`<input name="date" type="date" value="${localDay()}" required />`)}${field('关联项目',`<select name="projectId">${options(activeProjects,'暂不关联')}</select>`)}<button class="btn">安排为任务</button></form>`).join('') || '<p>收集箱已清空。</p>'}</section>`;
  const reviews=`<section class="cycle-card"><h2>周月复盘</h2><form id="reviewFilter" class="cycle-inline">${field('周期',`<select name="kind"><option value="week" ${reviewKind==='week'?'selected':''}>周复盘</option><option value="month" ${reviewKind==='month'?'selected':''}>月复盘</option></select>`)}${field('周期内任一日期',`<input name="day" type="date" value="${reviewDay}" required />`)}<button class="btn">查看周期</button></form><p>${stats.start} — ${stats.end} · 数据随实际记录更新</p><div class="cycle-metrics"><div><strong>${stats.done}/${stats.total}</strong><span>任务完成 · ${stats.rate}%</span></div><div><strong>${stats.minutes}</strong><span>记录投入（分钟）</span></div><div><strong>${stats.plans.length}</strong><span>本周期成果计划</span></div></div><p>投入按记录的开始日期归属统计；未记录的时间不补计。</p><h4>计划与执行</h4>${stats.plans.map(p=>`<p>${esc(projectName(p.projectId))} · ${esc(p.outcome)}</p>`).join('') || '<p>本周期尚无成果计划。</p>'}<details><summary>未完成任务 · ${stats.total-stats.done} 件</summary>${stats.tasks.filter(t=>!t.done).map(t=>`<button class="cycle-task" data-linked-task="${esc(t.id)}">${esc(t.date)} · ${esc(t.title)}</button>`).join('')}</details><form id="periodReviewForm" class="cycle-form">${field('本周期实际成果',`<textarea name="summary" maxlength="2000">${esc(review.summary || '')}</textarea>`)}${field('未完成原因与阻塞',`<textarea name="blockers" maxlength="2000">${esc(review.blockers || '')}</textarea>`)}${field('下一周期行动',`<textarea name="nextStep" maxlength="1000">${esc(review.nextStep || '')}</textarea>`)}<button class="btn primary">保存复盘</button><span role="status">${review.updatedAt?'已保存 · '+esc(review.updatedAt):'尚未保存'}</span></form>${review.nextStep?`<button class="btn" id="reviewNextAction">将下一步加入收集箱</button>`:''}</section>`;
  document.querySelector('#app').innerHTML=`<main class="shell cycle-shell"><header class="topbar"><div><div class="brand-kicker">L ↗ Life OS · V1.0</div><h1>${mode==='review'?'复盘，让下一步更明确':'从目标，到今天的一步'}</h1></div>${host.nav(mode)}</header><p class="cycle-intro">长期目标 → 项目 → 月计划 → 周计划 → 每日任务 → 执行记录 → 周月复盘</p>${error}${mode==='review'?reviews+inbox:`${inbox}<section class="cycle-grid">${goalForm}${projectForm}${planForm}</section><section class="cycle-stack">${cards || '<article class="cycle-card"><h3>从一个目标开始</h3><p>先写下目标和衡量标准，再建立项目、计划与每日任务。旧任务仍在 Day 和 Weekly。</p></article>'}</section><section class="cycle-stack"><h2>月周成果计划</h2>${planCards || '<p>建立项目后，在上方添加月计划和周计划。</p>'}</section>`}</main>`;
  host.bindNavigation();
  const commit=next=>{host.setState(next);renderLifecycle(host,mode);};
  const attempt=fn=>e=>{e?.preventDefault();try{fn(e);}catch(error){const el=document.querySelector('#lifecycleError');el.hidden=false;el.textContent=error.message;el.scrollIntoView?.({block:'center'});}};
  for(const [selector,kind] of [['#goalForm','goals'],['#projectForm','projects'],['#planForm','plans'],['#captureForm','captures']]) {
    const form=document.querySelector(selector);
    if(form) form.onsubmit=attempt(e=>commit(upsertEntity(host.getState(),kind,Object.fromEntries(new FormData(e.currentTarget)),host.makeId)));
  }
  document.querySelectorAll('[data-entity-edit]').forEach(button=>button.onclick=()=>{
    const kind=button.dataset.entityEdit, item=planner[kind].find(i=>i.id===button.dataset.id);
    const form=document.querySelector({goals:'#goalForm',projects:'#projectForm',plans:'#planForm'}[kind]);
    for(const [key,value] of Object.entries(item)) if(form.elements.namedItem(key)) form.elements.namedItem(key).value=String(value);
    // Retain archived parent references when editing a historical project.
    for(const key of ['goalId','projectId','parentId']) if(item[key] && form.elements.namedItem(key)?.value!==item[key]) {
      const option=document.createElement('option');option.value=item[key];option.textContent=key==='goalId'?goalName(item[key]):key==='projectId'?projectName(item[key]):plans.find(p=>p.id===item[key])?.outcome || item[key];
      form.elements.namedItem(key).append(option);form.elements.namedItem(key).value=item[key];
    }
    form.scrollIntoView({block:'center'});form.elements.namedItem('title')?.focus();
  });
  document.querySelectorAll('[data-archive]').forEach(button=>button.onclick=attempt(()=>{
    const kind=button.dataset.archive, next=normalizeLifecycle(host.getState());
    next[kind]=next[kind].map(item=>item.id===button.dataset.id?{...item,archived:!item.archived,updatedAt:new Date().toISOString()}:item);commit(next);
  }));
  document.querySelectorAll('[data-project-task]').forEach(button=>button.onclick=()=>host.openTask({projectId:button.dataset.projectTask},localDay()));
  document.querySelectorAll('[data-plan-task]').forEach(button=>button.onclick=()=>{
    const plan=plans.find(p=>p.id===button.dataset.planTask);host.openTask({projectId:plan.projectId,planId:plan.id},plan.period);
  });
  document.querySelectorAll('[data-linked-task]').forEach(button=>button.onclick=()=>host.openTask(planner.tasks.find(t=>t.id===button.dataset.linkedTask)));
  document.querySelectorAll('[data-capture]').forEach(form=>form.onsubmit=attempt(e=>{
    const fd=new FormData(e.currentTarget);commit(scheduleCapture(host.getState(),form.dataset.capture,fd.get('date'),fd.get('projectId'),host.makeId));
  }));
  const filter=document.querySelector('#reviewFilter');
  if(filter) filter.onsubmit=attempt(e=>{const fd=new FormData(e.currentTarget);periodBounds(fd.get('kind'),fd.get('day'));reviewKind=fd.get('kind');reviewDay=fd.get('day');renderLifecycle(host,mode);});
  const reviewForm=document.querySelector('#periodReviewForm');
  if(reviewForm) reviewForm.onsubmit=attempt(e=>commit(upsertEntity(host.getState(),'periodReviews',{...Object.fromEntries(new FormData(e.currentTarget)),kind:reviewKind,period:reviewDay},host.makeId)));
  const nextButton=document.querySelector('#reviewNextAction');
  if(nextButton) nextButton.onclick=attempt(()=>{
    const next=normalizeLifecycle(host.getState()), captureId=`review-next:${reviewId}`;
    if(!next.captures.some(c=>c.id===captureId)) commit(upsertEntity(next,'captures',{title:review.nextStep,note:`来自 ${stats.start} ${reviewKind==='week'?'周':'月'}复盘`},()=>captureId));
    else {nextButton.textContent='已在收集箱中';nextButton.disabled=true;}
  });
}
