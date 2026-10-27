import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as results from '../src/agent-results.js';
function appHarness(overrides = {}) {
  const values = new Map();
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {innerHTML:'',value:'',dataset:{},querySelector:element,querySelectorAll:()=>[],addEventListener(){},remove(){},focus(){}});
    return elements.get(selector);
  };
  const context = {console,Date,crypto:crypto.webcrypto,JSON,Math,Map,Set,Number,String,Object,Boolean,
    localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},
    document:{querySelector:element,querySelectorAll:()=>[],body:{insertAdjacentHTML(){},append(){}}},
    window:{addEventListener(){},dispatchEvent(){}},setTimeout:()=>0,clearTimeout(){},
    cloudConfigured:false,getCloudSession:()=>null,getCloudMeta:()=>({}),
    signIn(){},signUp(){},signOut(){},pullCloudSnapshot(){},pushCloudSnapshot(){},
    ...results, ...overrides};
  context.readAgentResults = () => results.readAgentResults(context.localStorage);
  for (const [name,path] of [['baseline','baseline-data.json'],['currentWeekPlan','current-week-data.json'],['sepOctPlan','sep-oct-plan.json'],['monthPlan','month-plan.json'],['resumeSprint','sprint-01-resume-plan.json']]) context[name]=JSON.parse(fs.readFileSync(new URL('../src/'+path,import.meta.url),'utf8'));
  const source = fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
  vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.api={snapshot,mergeSnapshot,applySnapshot,renderAgents,openEditor,syncNow,toggleTodayFocus,carryTask,renderDay};',context);
  return {context,element,values,api:context.api};
}
const sample=()=>({schema:'life-os-agent-result-v1',version:'1.0.0',task_id:'ui-import',fingerprint:'a'.repeat(64),objective:'<img src=x onerror=alert(1)>',module:'Career OS',status:'awaiting_acceptance',mode:'paid',summary:'<script>alert(1)</script>',next_actions:['检查来源'],calls_attempted:3,updated_at:'2026-10-13T03:00:00Z',accepted_by_user:false,duration_minutes:null});
test('preview requires explicit confirmation, preserves planner and Build',async()=>{
 const h=appHarness(); const before=h.api.snapshot(); h.api.renderAgents();
 await h.element('#importAgentResult').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(sample())}]}});
 assert.equal(h.api.snapshot().agentResults.length,0);
 assert.match(h.element('#app').innerHTML,/导入预览/);
 assert.match(h.element('#app').innerHTML,/&lt;script&gt;/);
 assert.ok(!h.element('#app').innerHTML.includes('<img src=x'));
 h.element('#confirmAgentImport').onclick();
 const after=h.api.snapshot();
 assert.equal(after.agentResults.length,1);
 assert.equal(JSON.stringify(after.planner),JSON.stringify(before.planner));
 assert.equal(JSON.stringify(after.buildItems),JSON.stringify(before.buildItems));
});
test('cancel preview does not write results',async()=>{
 const h=appHarness();h.api.renderAgents();
 await h.element('#importAgentResult').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(sample())}]}});
 h.element('#cancelAgentImport').onclick();
 assert.equal(h.api.snapshot().agentResults.length,0);
});
test('oversized input presents error and no preview',async()=>{
 const h=appHarness();h.api.renderAgents();
 await h.element('#importAgentResult').onchange({target:{files:[{size:1000001}]}});
 assert.match(h.element('#app').innerHTML,/不能超过 1MB/);
 assert.equal(h.api.snapshot().agentResults.length,0);
});
test('reimport is idempotent and backup preserves results',async()=>{
 const h=appHarness();h.api.renderAgents();
 for(let i=0;i<2;i++){
 await h.element('#importAgentResult').onchange({target:{files:[{size:100,text:async()=>JSON.stringify(sample())}]}});
 h.element('#confirmAgentImport').onclick();
 }
 assert.equal(h.api.snapshot().agentResults.length,1);
 const merged=h.api.mergeSnapshot({agentResults:[{...sample(),status:'accepted',accepted_by_user:true,updated_at:'2026-10-13T05:00:00Z'}]});
 h.api.applySnapshot(merged);
 assert.equal(h.api.snapshot().agentResults[0].status,'accepted');
 assert.ok(h.values.get(results.AGENT_RESULT_KEY));
});

test('deleted task tombstone overrides older cloud record and survives snapshot', () => {
 const h=appHarness();
 const old={id:'deleted-1',date:'2026-10-26',module:'Career OS',title:'待删除任务',done:true,updatedAt:'2026-10-26T08:00:00Z'};
 const cloud={planner:{tasks:[old]}};
 const local={...h.api.snapshot(),planner:{tasks:[],deletedTasks:[{key:'2026-10-26|Career OS|待删除任务',deletedAt:'2026-10-27T08:00:00Z'}]}};
 const merged=h.api.mergeSnapshot(cloud,local);
 assert.equal(merged.planner.tasks.find(t=>t.id==='deleted-1'),undefined);
 assert.equal(merged.planner.deletedTasks.length,1);
 h.api.applySnapshot(merged);
 assert.equal(h.api.snapshot().planner.deletedTasks.length,1);
});
test('newer task edit wins over old deletion marker',()=>{
 const h=appHarness();
 const task={id:'recreated',date:'2026-10-26',module:'Career OS',title:'新版本任务',done:false,updatedAt:'2026-10-27T10:00:00Z'};
 const local={...h.api.snapshot(),planner:{tasks:[task]}};
 const cloud={planner:{deletedTasks:[{key:'2026-10-26|Career OS|新版本任务',deletedAt:'2026-10-27T09:00:00Z'}],tasks:[]}};
 const merged=h.api.mergeSnapshot(cloud,local);
 assert.equal(merged.planner.tasks.find(t=>t.id==='recreated')?.done,false);
});


test('today focus selections remain attached to dates in snapshot merging',()=>{
 const h=appHarness();
 const merged=h.api.mergeSnapshot({planner:{todayFocus:{'2026-10-26':['cloud-task']},tasks:[]}},
   {...h.api.snapshot(),planner:{todayFocus:{'2026-10-27':['local-task']},tasks:[]}});
 assert.deepEqual(Array.from(merged.planner.todayFocus['2026-10-26']),['cloud-task']);
 assert.deepEqual(Array.from(merged.planner.todayFocus['2026-10-27']),['local-task']);
});
test('renaming a task suppresses stale copies with another device UUID', () => {
 const h=appHarness({FormData:class {get(key){return {date:'2026-10-27',module:'Career OS',title:'新名称',note:''}[key];}}});
 const task={id:'edit',date:'2026-10-27',module:'Career OS',title:'旧名称',done:false};
 h.api.applySnapshot({planner:{tasks:[task]}});
 h.api.openEditor(task);
 h.element('#taskForm').onsubmit({preventDefault(){},currentTarget:{}});
 const merged=h.api.mergeSnapshot({planner:{tasks:[{...task,id:'other-device'}]}});
 assert.equal(merged.planner.tasks.length,1);
 assert.equal(merged.planner.tasks[0].title,'新名称');
});

test('explicit user changes survive historical progress correction', () => {
 const h=appHarness();
 const task={id:'explicit',date:'2026-10-11',module:'Career OS',title:'核对并修正两版简历工作时间',done:false,updatedAt:'2026-10-27T10:00:00Z'};
 const merged=h.api.mergeSnapshot({planner:{tasks:[task]}},{planner:{tasks:[]}});
 assert.equal(merged.planner.tasks.length,1);
 assert.equal(merged.planner.tasks[0].done,false);
});

test('tombstones compare instants instead of timezone strings', () => {
 const h=appHarness();
 const key='2026-10-26|Career OS|时区';
 const merged=h.api.mergeSnapshot({planner:{deletedTasks:[{key,deletedAt:'2026-10-27T09:00:00Z'}]}},{planner:{deletedTasks:[{key,deletedAt:'2026-10-27T16:00:00+08:00'}]}});
 assert.equal(merged.planner.deletedTasks[0].deletedAt,'2026-10-27T09:00:00Z');
});

test('cloud conflict retries against latest snapshot without discarding local work',async()=>{
 let pulls=0, pushes=0;
 const h=appHarness();
 h.context.cloudConfigured=true;
 h.context.getCloudSession=()=>({access_token:'test'});
 h.context.pullCloudSnapshot=async()=>({updated_at:`revision-${++pulls}`,payload:{planner:{tasks:[{id:'remote',date:'2026-10-27',title:'remote',module:'Career OS'}]}}});
 h.context.pushCloudSnapshot=async(payload,revision)=>{
   pushes++;
   assert.equal(revision,`revision-${pulls}`);
   if(pushes===1) throw Object.assign(new Error('conflict'),{code:'SYNC_CONFLICT'});
   assert.ok(payload.planner.tasks.some(t=>t.id==='local'));
   assert.ok(payload.planner.tasks.some(t=>t.id==='remote'));
   return true;
 };
 h.api.applySnapshot({planner:{tasks:[{id:'local',date:'2026-10-27',title:'local',module:'Career OS'}]}});
 assert.equal(await h.api.syncNow(),true);
 assert.equal(pushes,2);
});

test('top three ignores deleted references, enforces limit and never completes tasks',()=>{
 const h=appHarness(); const day='2026-10-27';
 const tasks=[1,2,3,4].map(n=>({id:String(n),date:day,title:'任务'+n,module:'Career OS',done:false}));
 h.api.applySnapshot({planner:{tasks,todayFocus:{[day]:['deleted']}}});
 for(const n of [1,2,3]) assert.equal(h.api.toggleTodayFocus(String(n),day),true);
 assert.equal(h.api.toggleTodayFocus('4',day),false);
 assert.equal(h.api.toggleTodayFocus('2',day),true);
 assert.equal(h.api.toggleTodayFocus('4',day),true);
 assert.ok(h.api.snapshot().planner.tasks.every(t=>!t.done));
});
test('newer focus removal and note clearing survive stale devices',()=>{
 const h=appHarness(); const day='2026-10-27';
 const old={planner:{tasks:[],todayFocus:{[day]:['one']},focusUpdatedAt:{[day]:'2026-10-27T08:00:00Z'},dailyNotes:{[day]:'old'},noteUpdatedAt:{[day]:'2026-10-27T08:00:00Z'}}};
 const fresh={planner:{tasks:[],todayFocus:{[day]:[]},focusUpdatedAt:{[day]:'2026-10-27T09:00:00Z'},dailyNotes:{[day]:''},noteUpdatedAt:{[day]:'2026-10-27T09:00:00Z'}}};
 for(const merged of [h.api.mergeSnapshot(old,fresh),h.api.mergeSnapshot(fresh,old)]) {
   assert.equal(merged.planner.todayFocus[day].length,0);
   assert.equal(merged.planner.dailyNotes[day],'');
 }
});
test('seeded task focus follows deduplicated UUID',()=>{
 const h=appHarness();const task={date:'2026-10-27',title:'seeded',module:'Career OS',done:false};
 const merged=h.api.mergeSnapshot({planner:{tasks:[{...task,id:'a'}],todayFocus:{'2026-10-27':['a']}}},{planner:{tasks:[{...task,id:'b',updatedAt:'2026-10-27T10:00:00Z'}]}});
 assert.equal(merged.planner.tasks.length,1);
 assert.equal(merged.planner.todayFocus['2026-10-27'][0],merged.planner.tasks[0].id);
});
test('carryover is explicit and idempotent, preserving original history and Build',()=>{
 const h=appHarness();const task={id:'old',date:'2026-10-26',title:'unfinished',module:'Career OS',done:false,note:'keep'};
 h.api.applySnapshot({planner:{tasks:[task,{...task,id:'done',title:'finished',done:true}]}});
 const before=JSON.stringify(h.api.snapshot().buildItems);
 assert.equal(h.api.carryTask('done','2026-10-27'),false);
 assert.equal(h.api.carryTask('old','2026-10-27'),true);
 assert.equal(h.api.carryTask('old','2026-10-27'),false);
 const after=h.api.snapshot();
 assert.equal(after.planner.tasks.length,3);
 assert.equal(after.planner.tasks.find(t=>t.id==='old').date,'2026-10-26');
 assert.equal(after.planner.tasks.find(t=>t.carriedFrom==='old').note,'keep');
 assert.equal(JSON.stringify(after.buildItems),before);
});
test('review form stores only user text, roundtrips backup and chooses newer review',()=>{
 const h=appHarness({FormData:class {get(key){return {summary:'今天推进了一步',nextStep:'明天继续'}[key];}}});
 h.api.renderDay();h.element('#dailyReviewForm').onsubmit({preventDefault(){},currentTarget:{}});
 const backup=JSON.parse(JSON.stringify(h.api.snapshot()));
 const day=Object.keys(backup.planner.dailyReviews)[0];
 assert.equal(backup.planner.dailyReviews[day].summary,'今天推进了一步');
 assert.equal(backup.planner.dailyReviews[day].duration,undefined);
 const stale={planner:{tasks:[],dailyReviews:{[day]:{summary:'旧',updatedAt:'2000-01-01T00:00:00Z'}}}};
 const merged=h.api.mergeSnapshot(backup,stale);
 h.api.applySnapshot(merged);
 assert.equal(h.api.snapshot().planner.dailyReviews[day].nextStep,'明天继续');
});
test('daily note persists immediately before navigation',()=>{
 const h=appHarness();h.api.renderDay();
 h.element('#dailyNote').value='即时保存';h.element('#dailyNote').oninput();
 assert.ok(Object.values(h.api.snapshot().planner.dailyNotes).includes('即时保存'));
});
