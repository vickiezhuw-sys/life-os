"""Life OS Agent Pool v0.1: multi-provider orchestration, explicit paid execution."""
import argparse
import os
from datetime import datetime
from pathlib import Path
from openai import OpenAI

PROVIDERS = {
    "deepseek": ("DEEPSEEK_API_KEY", "https://api.deepseek.com", "DEEPSEEK_MODEL", "deepseek-flash"),
    "zhipu": ("ZHIPU_API_KEY", "https://open.bigmodel.cn/api/paas/v4", "ZHIPU_MODEL", "glm-4-flash"),
}
STEPS = (
    ("Research", "zhipu", "列出潜在客户群体、关键痛点、验证渠道与需要搜集的外部证据。所有未核实陈述标注为假设。"),
    ("Analyst", "deepseek", "基于上一阶段提出一个可操作的7天验证计划，包含成本、验收指标、失败标准。"),
    ("Reviewer", "zhipu", "检查证据缺口、事实与猜测混淆、可执行性和隐私/费用风险，给出最终建议。"),
)
DEFAULT_TOPIC = "验证中小App或跨境电商对广告投放数据自动化服务的实际付费需求"

def call_model(provider, system, message):
    key_env, base_url, model_env, default_model = PROVIDERS[provider]
    key = os.getenv(key_env)
    if not key:
        raise RuntimeError(f"缺少 {key_env}，请仅在本机配置。")
    client = OpenAI(api_key=key, base_url=base_url, timeout=35.0, max_retries=0)
    response = client.chat.completions.create(
        model=os.getenv(model_env, default_model),
        messages=[{"role": "system", "content": system}, {"role": "user", "content": message}],
    )
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError(f"{provider} 返回空文本，请检查模型配置。")
    return content

def run(topic, execute):
    output = ["# Agent Pool v0.1 任务报告", f"时间：{datetime.now().isoformat(timespec='minutes')}",
              f"目标：{topic}", "> 未配置互联网检索工具，不能将模型生成的内容视为已验证的市场证据。"]
    prior = ""
    for name, provider, instructions in STEPS:
        output.append(f"\n## {name} · {provider}")
        if not execute:
            output.append(f"DRY RUN：将调用 {provider}；要求：{instructions}")
            continue
        print(f"正在运行 {name} ({provider})...")
        prior = call_model(provider,
            f"你是{name} Agent。{instructions} 不得编造事实、来源或客户访谈记录。",
            f"用户目标：{topic}\n\n之前Agent的结果：\n{prior[-12000:]}")
        output.append(prior)
    result = Path(__file__).with_name("report.md")
    result.write_text("\n\n".join(output) + "\n", encoding="utf-8")
    print(f"{'执行完成' if execute else '预演完成（无API请求）'}：{result}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--topic", default=DEFAULT_TOPIC)
    parser.add_argument("--execute", action="store_true", help="明确批准调用付费模型API；默认仅预演")
    args = parser.parse_args()
    run(args.topic, args.execute)
