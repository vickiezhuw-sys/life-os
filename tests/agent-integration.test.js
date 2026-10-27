import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as results from '../src/agent-results.js';
function appHarness() {
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
    ...results};
  context.readAgentResults = () => results.readAgentResults(context.localStorage);
  for (const [name,path] of [['baseline','baseline-data.json'],['currentWeekPlan','current-week-data.json'],['sepOctPlan','sep-oct-plan.json'],['monthPlan','month-plan.json'],['resumeSprint','sprint-01-resume-plan.json']]) context[name]=JSON.parse(fs.readFileSync(new URL('../src/'+path,import.meta.url),'utf8'));
  const source = fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.api={snapshot,mergeSnapshot,applySnapshot,renderAgents};',context);
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
