import {validDay} from './lifecycle.js';

export function createExecution(input, tasks, makeId, now=new Date().toISOString()) {
  const task=input.taskId ? tasks.find(t=>t.id===input.taskId) : null;
  if(input.taskId && !task) throw new Error('关联任务不存在，请重新选择');
  const content=String(input.content || task?.title || '').trim();
  const duration=Number(input.duration), at=String(input.at || '');
  if(!content) throw new Error('请填写本次做了什么');
  if(!Number.isFinite(duration) || duration<=0 || duration>1440) throw new Error('请输入大于 0 且不超过 1440 的实际分钟数');
  if(!validDay(at.slice(0,10)) || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new Error('请选择有效的开始日期和时间');
  if(!task && !input.module) throw new Error('请选择事项分类');
  return {id:makeId(),content:content.slice(0,1000),at,duration,module:task?.module || input.module,
    taskId:task?.id || '',projectId:task?.projectId || input.projectId || '',updatedAt:now};
}
export function taskEffort(items,taskId,day) {
  const records=items.filter(item=>item.taskId===taskId);
  const minutes=record=>Number.isFinite(Number(record.duration)) && Number(record.duration)>0 ? Number(record.duration) : 0;
  return {total:records.reduce((sum,r)=>sum+minutes(r),0),today:records.filter(r=>String(r.at).slice(0,10)===day).reduce((sum,r)=>sum+minutes(r),0),sessions:records.length};
}
