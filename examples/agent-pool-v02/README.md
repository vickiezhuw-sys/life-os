# Life OS Agent Pool V0.2 · 私有云端任务执行

目标：用户在ChatGPT提出任务 → 主控明确范围、验收标准、执行费用 → GitHub私有Issue记录任务 → 得到授权后打上 `agent-run-approved` 标签 → GitHub Actions 自动运行 Zhipu/DeepSeek/Zhipu 三阶段 → 报告和状态写回私有Issue，主控复核报告。

## 已实现与尚未完成

- 已提交：`runner.py` 任务执行引擎；`agent-task.workflow.yml` **私有仓库工作流模板**。
- 已实现：默认dry-run、不调用模型；明确 `--execute` 才会调用两个API，3阶段最多3次调用；UTF-8编码，写出JSON状态和Markdown报告；出错保留之前完成的阶段。
- **尚未实现/验证**：独立私有运行仓库、密钥设置、云端工作流首次真实执行、ChatGPT创建Issue并触发批准动作、Life OS页面集成与永久任务数据库。
- 没有外部网页搜索或客户访谈，所以输出只属于模型提出的待验证分析。

## 为什么要用单独私有仓库？

`vickiezhuw-sys/life-os` 是**公开**的 GitHub Pages 网页仓库。真实的任务文本、报告甚至未来的商业客户资料不宜放在这里。

创建一个空白的**Private**仓库，例如 `vickiezhuw-sys/life-os-agent-runtime`：
1. 不要开启GitHub Pages。
2. 把本目录 `runner.py` 复制为私有仓库根目录的 `agent_runner.py`。
3. 把 `agent-task.workflow.yml` 复制到私有仓库路径 `.github/workflows/agent-task.yml`。
4. 在 **Settings → Secrets and variables → Actions → New repository secret** 添加 `DEEPSEEK_API_KEY`、`ZHIPU_API_KEY`。**不要复制密钥到Issue、代码或ChatGPT对话中**。
5. 创建一个GitHub Issue标签 `agent-run-approved`，仅在明确授权产生最多三次计费调用后使用。
6. 如GitHub插件对新私有仓库没有访问权限，在GitHub连接设置中授权后才能在聊天中发起任务。

此阶段需要用户手动创建私有仓库和添加Secrets一次；其余文件提交与任务创建可以在连接权限支持时通过ChatGPT完成。

## 任务执行与成果回传

在私有仓库创建标题以 `[AGENT]` 开始的Issue，在正文用自然语言说明任务和验收标准。此时**不会自动花钱**。经用户确认后为此Issue添加 `agent-run-approved` 标签，触发工作流。此仓库必须保持私有，否则workflow的保护条件阻止执行。

工作流中Python执行三个阶段（Zhipu Research、DeepSeek Analyst、Zhipu Reviewer），把每个阶段的输出保存到 `output/issue-N/state.json` 和 `report.md`。成功后自动将报告评论到同一个私有Issue，并保存Actions artifact（默认保留14天）。

恢复与重试：单次执行失败时，已经生成的步骤保留在该次Action artifact里，但**跨工作流运行的断点恢复尚未实现**。请勿反复取消/重打批准标签，否则可能重复计费；先排障再设计恢复逻辑。

## 本地无费用检查

```bash
python runner.py --task-id demo --objective "评估App投放数据自动化市场需求"
```

产出 `output/demo/state.json`、`output/demo/report.md`，不需要API Key，不会产生模型费用。

## 权限与安全

- workflow **只在私有仓库**、Issue标题含 `[AGENT]` 前缀且添加 `agent-run-approved` 标签时允许执行。
- Secrets只放私有GitHub Actions，工作流代码由仓库所有者维护；不从不可信Issue文本执行Shell命令，文字只作为模型输入。
- 任务文本会发给智谱、DeepSeek第三方API，避免上传身份证、账号密码、医疗记录或客户个人数据等敏感信息。
- 行动涉及发邮件、提交申请、付款、修改客户数据等需要单独审批，V0.2并未赋予这些能力。
- 运行会消耗对应模型API额度，也可能消耗GitHub Actions配额。
- 本模板未在私有仓库真实运行验收，需依次完成Dry Run、额度确认和单个授权测试。
