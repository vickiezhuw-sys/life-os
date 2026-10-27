import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(response) {
 const values=new Map([['life-os-cloud-session-v1',JSON.stringify({access_token:'test',user:{id:'test-user'}})]]);
 const calls=[];
 const context={Date,JSON,Boolean,Error,Array,encodeURIComponent,
  localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},
  window:{dispatchEvent(){}},CustomEvent:class{},
  fetch:async(url,options)=>{calls.push({url,...options});return {ok:response.status<400,status:response.status,text:async()=>JSON.stringify(response.body)};}};
 let source=fs.readFileSync(new URL('../src/sync.js',import.meta.url),'utf8')
  .replaceAll('import.meta.env.','env.').replace(/^export /gm,'');
 context.env={};vm.createContext(context);
 vm.runInContext(source+'\nglobalThis.push=pushCloudSnapshot;',context);
 return {context,calls,values};
}
test('existing snapshot upload uses conditional PATCH and encoded exact revision',async()=>{
 const h=harness({status:200,body:[{}]});
 const revision='2026-10-27T10:00:00.123456+00:00';
 assert.equal(await h.context.push({planner:{tasks:[]}},revision),true);
 assert.equal(h.calls[0].method,'PATCH');
 assert.ok(h.calls[0].url.includes('updated_at=eq.'+encodeURIComponent(revision)));
 assert.ok(!h.calls[0].headers.Prefer.includes('merge-duplicates'));
});
test('zero matching rows is a conflict and keeps error status',async()=>{
 const h=harness({status:200,body:[]});
 await assert.rejects(h.context.push({},'2026-10-27T10:00:00Z'),e=>e.code==='SYNC_CONFLICT');
 assert.equal(JSON.parse(h.values.get('life-os-cloud-meta-v1')).status,'error');
});
test('first upload inserts and treats competing insert as conflict',async()=>{
 const h=harness({status:409,body:{message:'duplicate key'}});
 await assert.rejects(h.context.push({},null),e=>e.code==='SYNC_CONFLICT');
 assert.equal(h.calls[0].method,'POST');
});
test('network errors are not treated as version conflicts',async()=>{
 const h=harness({status:503,body:{message:'unavailable'}});
 await assert.rejects(h.context.push({},null),e=>e.status===503 && !e.code);
});
