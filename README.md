# Life OS

这是从现有线上 **Life OS Weekly Planner v1** 恢复出的工程化基线。

## 恢复原则

- 不重新设计产品；
- 先恢复 Weekly Planner 的结构、文案和主要交互；
- 浏览器本地持久化继续使用 `localStorage`；
- 基线稳定后，再开发 `Build = 内容 + 日期 + 时间`；
- Build 后续增加日 / 周 / 月 / 年统计。

## 当前已恢复

- Weekly Overview
- 本周完成度
- Health / Wealth / Experience / Career / Inner 五个模块
- 09.07–09.13 基线周的 16 条任务
- 任务完成 / 取消完成
- 新增任务
- 编辑 / 删除任务
- 上一周 / 本周 / 下一周
- 浏览器本地持久化
- 移动端响应式布局

## 本地运行

```bash
npm install
npm run dev
```

## 工程阶段

- `v0.1.0`: recovered Weekly Planner baseline
- 下一阶段：Build capture + 日/周/月/年统计

## 原线上站点

https://life-os-week-planner.d5vdwygrnn.chatgpt.site

> 说明：原 Site projection 无法导出原始源代码，因此本仓库是依据现有可运行页面及保存的投影内容做的工程恢复，不声称是原始源码的逐字复制。
