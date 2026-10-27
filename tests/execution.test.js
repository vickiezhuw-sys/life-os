import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecution,taskEffort} from '../src/execution.js';
import {periodStats} from '../src/lifecycle.js';
const task={id:'task',date:'2026-10-27',title:'真实任务',done:false,module:'Career OS',projectId:'project',planId:'plan'};
test('recording multiple sessions inherits links and never mutates task completion',()=>{
 const before=JSON.stringify(task);let count=0;
 const a=createExecution({taskId:'task',duration:'30',at:'2026-10-27T09:00'},[task],()=>`entry-${++count}`);
 const b=createExecution({taskId:'task',duration:'45',at:'2026-10-27T10:00',content:'第二次推进'},[task],()=>`entry-${++count}`);
 assert.notEqual(a.id,b.id);assert.equal(a.projectId,'project');assert.equal(a.module,'Career OS');assert.equal(a.content,task.title);
 assert.equal(JSON.stringify(task),before);assert.equal(a.done,undefined);
 assert.deepEqual(taskEffort([a,b],'task','2026-10-27'),{today:75,total:75,sessions:2});
});
test('cross-day task totals stay separate from daily and monthly statistics',()=>{
 const entries=[createExecution({taskId:'task',duration:30,at:'2026-09-30T23:50'},[task],()=> 'a'),createExecution({taskId:'task',duration:45,at:'2026-10-27T10:00'},[task],()=> 'b')];
 assert.deepEqual(taskEffort(entries,'task','2026-10-27'),{today:45,total:75,sessions:2});
 assert.equal(periodStats({tasks:[task]},entries,'month','2026-10-27').minutes,45);
 assert.equal(periodStats({tasks:[task]},entries,'month','2026-09-30').minutes,30);
});
test('unplanned effort records have no task association and do not invent tasks',()=>{
 const tasks=[{...task}];const entry=createExecution({content:'临时事项',duration:12.5,at:'2026-10-27T11:00',module:'Inner OS'},tasks,()=> 'unplanned');
 assert.equal(entry.taskId,'');assert.equal(entry.duration,12.5);assert.equal(tasks.length,1);
});
test('invalid durations, dates and missing task references fail before creating IDs',()=>{
 let ids=0;const base={taskId:'task',duration:30,at:'2026-10-27T09:00'};
 for(const duration of ['',0,-1,Infinity,NaN,1441,'not a number']) assert.throws(()=>createExecution({...base,duration},[task],()=>++ids));
 for(const at of ['2026-02-30T09:00','2026-10-27T24:00','2026-10-27T09:61','bad']) assert.throws(()=>createExecution({...base,at},[task],()=>++ids));
 assert.throws(()=>createExecution({...base,taskId:'missing'},[task],()=>++ids));
 assert.equal(ids,0);
});
