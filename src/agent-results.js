// Agent results are an inbox, never automatic planner completion or Build time.
export const AGENT_RESULT_KEY = 'life-os-agent-results-v1';
export const RESULT_STATUSES = {
  ready: '待执行', running: '执行中', blocked: '阻塞', needs_review: '需修订',
  awaiting_acceptance: '待人工验收', accepted: '已人工验收'
};
const modules = new Set(['Health OS', 'Wealth OS', 'Experience OS', 'Career OS', 'Inner OS']);
function required(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`结果文件的 ${name} 无效`);
  return value;
}
export function validateAgentResult(raw) {
  if (!raw || typeof raw !== 'object' || raw.schema !== 'life-os-agent-result-v1' || raw.version !== '1.0.0') throw new Error('请选择 V1.0 的 life-os-result.json');
  const taskId = required(raw.task_id, '任务 ID', 60);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(taskId)) throw new Error('任务 ID 无效');
  const fingerprint = required(raw.fingerprint, '指纹', 64);
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('指纹无效');
  if (!modules.has(raw.module) || !Object.hasOwn(RESULT_STATUSES, raw.status) || !['paid', 'demo'].includes(raw.mode)) throw new Error('结果状态或分类无效');
  if (typeof raw.accepted_by_user !== 'boolean' || raw.accepted_by_user !== (raw.status === 'accepted') || (raw.mode === 'demo' && raw.accepted_by_user)) throw new Error('结果验收状态不一致');
  if (!Number.isInteger(raw.calls_attempted) || raw.calls_attempted < 0 || raw.calls_attempted > 6) throw new Error('调用次数无效');
  const updatedAt = required(raw.updated_at, '更新时间', 40);
  if (!Number.isFinite(Date.parse(updatedAt)) || !/Z$|[+-]\d\d:\d\d$/.test(updatedAt)) throw new Error('更新时间无效');
  if (typeof raw.summary !== 'string' || raw.summary.length > 6000) throw new Error('总结无效');
  if (!Array.isArray(raw.next_actions) || raw.next_actions.length > 20 || raw.next_actions.some(x => typeof x !== 'string' || !x.trim() || x.length > 2000)) throw new Error('后续行动无效');
  if (raw.duration_minutes !== null) throw new Error('Agent 结果不能填写用户实际投入时间');
  return {schema: raw.schema, version: raw.version, task_id: taskId, fingerprint,
    objective: required(raw.objective, '目标', 10000), module: raw.module, status: raw.status,
    mode: raw.mode, summary: raw.summary, next_actions: [...raw.next_actions],
    calls_attempted: raw.calls_attempted, updated_at: updatedAt,
    accepted_by_user: raw.accepted_by_user, duration_minutes: null};
}
export function mergeAgentResults(...groups) {
  const entries = new Map();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const raw of group) {
      let item;
      try { item = validateAgentResult(raw); } catch { continue; }
      const key = `${item.task_id}|${item.fingerprint}|${item.mode}`;
      const prior = entries.get(key);
      if (!prior || Date.parse(item.updated_at) > Date.parse(prior.updated_at)) entries.set(key, item);
    }
  }
  return [...entries.values()].sort((a,b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}
export function readAgentResults(storage = localStorage) {
  try { return mergeAgentResults(JSON.parse(storage.getItem(AGENT_RESULT_KEY))); } catch { return []; }
}
