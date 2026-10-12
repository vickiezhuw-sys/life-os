# AI Agent Pool · MVP 01

这是**隔离在 examples/ 下**的顺序Agent原型，不改变Life OS网页。

## 架构
Orchestrator顺序调用Research → Analyst → Reviewer，最后将Markdown保存至 report.md。
研究主题：中小App及跨境电商的广告数据自动化需求验证。

## 本机运行
需要 Python 3.10+、网络、OpenAI API账户及密钥。**正式执行API调用会计费**；由用户确认费用后自行运行。ChatGPT订阅与API用量是分开的。密钥不可提交到GitHub。

```bash
python -m pip install openai
# macOS/Linux
export OPENAI_API_KEY="你的密钥"
# Windows PowerShell则使用：$env:OPENAI_API_KEY="你的密钥"
python main.py
```

可通过环境变量 `OPENAI_MODEL` 更换支持Responses API的模型，默认 `gpt-4.1-mini`。

## 当前边界
- 三个顺序的独立LLM角色，并非后台自主调度或多个供应商模型。
- 没有实时搜索/检索及来源引用，Research只能**提出假设**，不能证明付费需求。
- 真实客户验证是下一步：可靠来源+客户访谈+最小销售试验。
