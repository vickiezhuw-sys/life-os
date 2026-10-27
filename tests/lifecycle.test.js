import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLifecycle,mergeLifecycle,mergeRecords,upsertEntity,scheduleCapture,periodBounds,periodStats,linkedTask,validDay,tasksForPlan} from '../src/lifecycle.js';
const now='2026-10-27T10:00:00Z';
function graph() {
 let state={tasks:[],dailyNotes:{'2026-10-26':'历史笔记'}};
 state=upsertEntity(state,'goals',{title:'测试目标',metric:'交付可验收成果',deadline:'2026-12-31'},()=> 'goal',now);
 state=upsertEntity(state,'projects',{title:'测试项目',goalId:'goal',milestone:'交付第一版'},()=> 'project',now);
 state=upsertEntity(state,'plans',{projectId:'project',kind:'month',period:'2026-10-27',outcome:'月成果'},()=> 'month',now);
 state=upsertEntity(state,'plans',{projectId:'project',parentId:'month',kind:'week',period:'2026-10-27',outcome:'周成果'},()=> 'week',now);
 return state;
}
test('additive migration is idempotent and leaves historical tasks and notes untouched',()=>{
 const old={tasks:[{id:'old',date:'2026-10-01',title:'历史',done:true}],dailyNotes:{x:'keep'},unknown:{v:1}};
 const before=JSON.stringify(old), next=normalizeLifecycle(old);
 assert.equal(JSON.stringify(old),before);
 assert.deepEqual(next.tasks,old.tasks);assert.deepEqual(next.unknown,old.unknown);
 assert.deepEqual(normalizeLifecycle(next),next);
});
test('goal-project-month-week links validate and never complete tasks',()=>{
 const state=graph();assert.equal(state.projects[0].goalId,'goal');assert.equal(state.plans[1].parentId,'month');
 assert.equal(state.tasks.length,0);assert.equal(state.dailyNotes['2026-10-26'],'历史笔记');
 assert.deepEqual(linkedTask(state,'project','week'),{projectId:'project',planId:'week'});
 assert.throws(()=>linkedTask(state,'','week'),/不一致/);
 assert.throws(()=>upsertEntity(state,'projects',{title:'bad',goalId:'missing'},()=> 'bad',now),/目标/);
 assert.throws(()=>upsertEntity(state,'plans',{projectId:'project',kind:'week',period:'2026-12-01',parentId:'month',outcome:'bad'},()=> 'bad',now),/月计划/);
});
test('invalid dates, empty outcomes and dangling project associations fail before mutation',()=>{
 const state=graph(), before=JSON.stringify(state);
 assert.equal(validDay('2026-02-30'),false);assert.equal(validDay('2028-02-29'),true);
 assert.throws(()=>upsertEntity(state,'plans',{projectId:'project',kind:'day',period:'2026-10-27',outcome:'bad'},()=> 'bad',now));
 assert.throws(()=>upsertEntity(state,'plans',{projectId:'project',kind:'month',period:'2026-10-27',outcome:' '},()=> 'bad',now));
 assert.equal(JSON.stringify(state),before);
});
test('period calculations handle year boundaries and leap months in local dates',()=>{
 assert.deepEqual(periodBounds('week','2027-01-01'),{start:'2026-12-28',end:'2027-01-03'});
 assert.deepEqual(periodBounds('month','2028-02-20'),{start:'2028-02-01',end:'2028-02-29'});
 assert.deepEqual(periodBounds('week','2026-10-26'),{start:'2026-10-26',end:'2026-11-01'});
});
test('capture scheduling is idempotent and uses a stable ID across offline devices',()=>{
 let state=upsertEntity(graph(),'captures',{title:'下一步',note:'上下文'},()=> 'capture',now);
 const a=scheduleCapture(state,'capture','2026-10-28','project',()=> 'a',now);
 const b=scheduleCapture(state,'capture','2026-10-28','project',()=> 'b',now);
 assert.equal(a.tasks[0].id,b.tasks[0].id);assert.equal(a.tasks[0].done,false);
 assert.equal(a.tasks[0].note,'上下文');assert.equal(a.tasks[0].duration,undefined);
 assert.equal(scheduleCapture(a,'capture','2026-10-29','project',()=> 'c',now).tasks.length,1);
 assert.equal(state.tasks.length,0);
});
test('archiving preserves associations, allows historic edits and prevents new attachment',()=>{
 let state=graph();state.goals[0].archived=true;state.projects[0].archived=true;
 state=upsertEntity(state,'projects',{...state.projects[0],title:'修改历史项目'},()=> 'x',now);
 assert.equal(state.projects[0].archived,true);assert.equal(state.projects[0].goalId,'goal');
 assert.throws(()=>upsertEntity(state,'projects',{title:'新项目',goalId:'goal'},()=> 'x',now),/目标/);
 assert.equal(state.plans.length,2);
});
test('offline independent entities union and newer archive wins in either merge order',()=>{
 const a={goals:[{id:'g',title:'old',updatedAt:now}],projects:[{id:'a'}]};
 const b={goals:[{id:'g',title:'new',archived:true,updatedAt:'2026-10-27T11:00:00Z'}],projects:[{id:'b'}]};
 for(const next of [mergeLifecycle(a,b),mergeLifecycle(b,a)]) {
  assert.equal(next.goals[0].title,'new');assert.equal(next.goals[0].archived,true);assert.equal(next.projects.length,2);
 }
});
test('explicit clearing and rapid repeated edits do not resurrect text',()=>{
 let state=graph();state=upsertEntity(state,'projects',{id:'project',title:'测试项目',goalId:'goal',milestone:''},()=> 'unused',now);
 assert.equal(state.projects[0].milestone,'');assert.ok(Date.parse(state.projects[0].updatedAt)>Date.parse(now));
 const merged=mergeLifecycle(state,graph());assert.equal(merged.projects[0].milestone,'');
});
test('review has one stable key per cycle and stores no fabricated completion or duration',()=>{
 const input={kind:'week',period:'2026-10-27',summary:'实际成果',blockers:'原因',nextStep:'下一步'};
 const a=upsertEntity(graph(),'periodReviews',input,()=> 'a',now);
 const b=upsertEntity(graph(),'periodReviews',input,()=> 'b',now);
 assert.equal(a.periodReviews[0].id,b.periodReviews[0].id);
 assert.equal(mergeLifecycle(a,b).periodReviews.length,1);
 assert.equal(a.periodReviews[0].duration,undefined);assert.equal(a.periodReviews[0].done,undefined);
 const next=upsertEntity(a,'periodReviews',{...input,nextStep:''},()=> 'c',now);
 assert.equal(next.periodReviews.length,1);assert.equal(next.periodReviews[0].nextStep,'');
});
test('period statistics use real logs, include boundary dates and do not mutate records',()=>{
 const state=graph();state.tasks=[{id:'t',date:'2026-10-26',done:true,projectId:'project'},{id:'u',date:'2026-11-01',done:false,projectId:'project'},{id:'outside',date:'2026-11-02',done:true}];
 const builds=[{id:'1',at:'2026-10-26T23:59',duration:25,taskId:'t'},{id:'2',at:'2026-11-01T00:00',duration:35,projectId:'project'},{id:'3',at:'2026-11-02T00:00',duration:999},{id:'4',at:'2026-10-28',duration:-20},{id:'5',at:'2026-10-28',duration:'invalid'}];
 const before=JSON.stringify({state,builds}),stats=periodStats(state,builds,'week','2026-10-27','project');
 assert.equal(stats.minutes,60);assert.equal(stats.done,1);assert.equal(stats.total,2);assert.equal(stats.rate,50);assert.equal(stats.plans.length,1);
 assert.equal(JSON.stringify({state,builds}),before);
 const empty=periodStats({tasks:[]},[],'month','2026-12-15');assert.equal(empty.rate,0);assert.equal(empty.minutes,0);
});
test('same timestamp merges converge deterministically',()=>{
 const a={id:'same',title:'a',updatedAt:now},b={id:'same',title:'b',updatedAt:now};
 assert.deepEqual(mergeRecords([a],[b]),mergeRecords([b],[a]));
});
test('monthly outcomes roll up child weekly tasks without duplicate counting',()=>{
 const state=graph();state.tasks=[{id:'direct',planId:'month'},{id:'child',planId:'week',done:true},{id:'unrelated',planId:'other'}];
 assert.equal(tasksForPlan(state,'month').length,2);assert.equal(tasksForPlan(state,'week').length,1);
});
