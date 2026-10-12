# Life OS · Agent Pool v0.1（DeepSeek + 智谱）

**目标**：用户输入一句目标，系统按 Research（智谱）→ Analyst（DeepSeek）→ Reviewer（智谱）顺序协调两个模型，并输出报告。这个编排器是独立Python程序，还不能直接从当前ChatGPT聊天中自动触发。

## Windows使用

本地Python 3.10+。在此目录启动PowerShell：

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install openai
.\.venv\Scripts\python.exe main.py
```

默认只是**dry run**：打印步骤并生成报告，不联网、不扣模型费用。

实际调用前，到[DeepSeek开放平台](https://platform.deepseek.com/)与[智谱开放平台](https://open.bigmodel.cn/)分别开通API密钥，确认资费并设置预算。**不要把密钥发送给ChatGPT或提交到GitHub**。

只在当前终端临时设置密钥（输入隐藏）：

```powershell
$env:DEEPSEEK_API_KEY = Read-Host "DeepSeek API Key" -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:ZHIPU_API_KEY = Read-Host "Zhipu API Key" -AsSecureString | ConvertFrom-SecureString -AsPlainText
```

完成后需**明确执行**（会产生API请求及可能的费用）：

```powershell
.\.venv\Scripts\python.exe main.py --execute
```

支持 `--topic "你的任务"` 自定义目标。也可设置 `DEEPSEEK_MODEL`、`ZHIPU_MODEL` 环境变量来切换账户可用的模型。当前示例默认是 DeepSeek `deepseek-v4-flash`、智谱 `glm-4-flash`，具体模型ID/权限以厂商控制台为准。

## 系统边界
- 不修改Life OS线上网页和个人任务数据。
- 不调用OpenAI API，保留OpenAI兼容Python SDK作为两家模型的HTTP客户端。
- 先固定3个角色、2家提供商；暂无动态任务拆分、实时网页检索、联网来源核验、长期状态、自动后台执行或ChatGPT对话直连。
- 只在完整成功后覆盖本地report.md；API报错不会捏造报告完成。
- 密钥为临时PowerShell环境变量；关闭窗口即清除。严禁在Git仓库保存密钥。
- 请求调用会产生模型费用，厂商提供的预算通知不一定是严格限额。
