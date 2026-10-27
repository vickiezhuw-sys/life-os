export function usageGuideHtml(active) {
  const steps=[
    ['goals','先定目标与项目','首次使用或方向变化时：写清目标、衡量标准和项目，再拆成月、周成果。'],
    ['planner','Weekly 安排到每天','每周开始：检查本周任务，确定日期；有项目来源的任务可从「目标与计划」拆分。'],
    ['day','Day 安排与记录执行','每天选 Top 3；执行后在任务里记录实际分钟数，可多次累计。完成状态另行勾选。'],
    ['month','Month 看统计和历史','按日、周、月、年及分类查看投入，调整日期查询历史；旧投入记录也在这里编辑。'],
    ['review','复盘后安排下一步','每天结束在 Day 写日终复盘；每周、每月到这里复盘，再把下一步加入收集箱。'],
    ['sync','Sync 检查同步与备份','确认云同步已连接。换设备登录同一账号；重要调整前先导出备份。'],
  ];
  return `<section class="usage-guide" aria-label="Life OS 使用顺序"><div class="usage-guide-heading"><div><span class="brand-kicker">使用顺序 · 始终放在页面上方</span><h2>先规划，再执行，最后复盘。</h2></div><p><strong>每天在 Day 完成：安排任务 → 记录投入 → 日终复盘</strong><br />目标和计划按周调整，统计到 Month 查看。</p></div><ol class="usage-guide-steps">${steps.map(([view,title,copy],index)=>`<li class="${active===view?'current':''}"><button data-nav="${view}" ${active===view?'aria-current="page"':''}><span>${index+1}</span>${title}</button><p>${copy}</p></li>`).join('')}</ol><p class="usage-guide-extra"><strong>其他入口：</strong>Agents 用来接收和验收 Agent 成果，有需要再使用。上述步骤标题可以直接点击跳转。</p></section>`;
}
