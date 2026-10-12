# Life OS · Agent Pool v0.1（双模型联动版）

此版本调用 **智谱 GLM → DeepSeek → 智谱 GLM**。使用在Windows已验证成功的模型ID `glm-5.3-flash` 和 `deepseek-flash`，并修复早期版的35秒超时问题。

## Windows更新

将新版 `main.py` 覆盖到你之前的 `agent-pool-mvp` 目录，**保留 `.venv` 和你的其他文件**。密钥仍在你当前PowerShell会话的环境变量中，无需重装Python或SDK。不要把任何密钥上传GitHub或发给聊天机器人。

首次先预演（不产生API费用）：

```powershell
.\.venv\Scripts\python.exe main.py
```

如果预演成功，而且DeepSeek与智谱API额度已经确认、你同意进行三个可能计费的模型调用，再手动执行：

```powershell
$env:DEEPSEEK_MODEL = 'deepseek-flash'
$env:ZHIPU_MODEL = 'glm-5.3-flash'
.\.venv\Scripts\python.exe main.py --execute --topic "为中小App设计广告数据自动化服务的7天付费需求验证计划"
```

结果：完成全部三步后生成 `report.md`；运行期间已完成步骤保存到 `report.partial.md`。默认不自动重试，避免意外重复花费。可设置 `AGENT_TIMEOUT_SEC` 修改单次超时，默认120秒。

## 注意

- “模型调用成功”不等于已经做过真实市场调研；这版没有实时搜索、客户访谈或事实核验。
- 本脚本暂时由Windows手动触发，还没有直接连接ChatGPT会话、Life OS页面或后台自动化。
- API使用可能计费，请在两家平台查看计费和用量。
- 如果出现超时，请记录失败步骤和错误类型；不要盲目反复重跑整个流程。
- 如果密钥此前被发到聊天或公开位置，应立即撤销并更换。

## Windows PowerShell 5.1：推荐的直接 REST 运行方式

由于已有本机结果显示 PowerShell 的 Invoke-RestMethod 能成功连接智谱和DeepSeek，而 Python SDK的网络层持续 ReadTimeout，优先使用同目录下的 [run-agents.ps1](run-agents.ps1)，不需要Python或 .venv。

在 PowerShell 打开项目目录后：

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/vickiezhuw-sys/life-os/main/examples/agent-pool-v01/run-agents.ps1" -OutFile ".\run-agents.ps1"
Unblock-File .\run-agents.ps1
.\run-agents.ps1
```

预演成功会生成 `report.preview.md`，不调用API。

两个密钥 `ZHIPU_API_KEY` 和 `DEEPSEEK_API_KEY` 必须仍在**当前 PowerShell 会话**中。确认账户有可用额度、同意发起三次可能计费的模型调用后，再执行：

```powershell
.\run-agents.ps1 -Execute
```

成功时生成 `report.md`；过程中逐步写入 `report.partial.md`。禁止上传这两个文件里的敏感业务数据到公开仓库。不要上传密钥。此脚本并未在用户电脑上运行验证，需以本地结果为准。

## 智谱暂不可用时：DeepSeek单模型、三角色模式

保留 Research → Analyst → Reviewer 的协作结构，但三个角色均使用 DeepSeek。这是**单厂商多角色流程验证**，不是已完成多厂商联动。

先从GitHub更新 `run-agents.ps1`。在原Windows PowerShell目录执行：

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/vickiezhuw-sys/life-os/main/examples/agent-pool-v01/run-agents.ps1" -OutFile ".\run-agents.ps1"
Unblock-File .\run-agents.ps1
.\run-agents.ps1 -DeepSeekOnly
```

上述仅模拟运行、**不产生API费用**。确认 DeepSeek API Key 在当前终端、已有可用额度并批准运行后才执行 ` .\run-agents.ps1 -DeepSeekOnly -Execute `，会产生最多三次模型API调用。报告在当前目录。脚本已提交，但尚未通过用户Windows实际验收。

智谱GLM账户可用额度尚不明，用户决定暂时停止智谱相关充值与排障；以后恢复时再切换双厂商模式。
