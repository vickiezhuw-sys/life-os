"""Sequential Agent Pool MVP. Requires an explicit local API run."""
import os
from datetime import datetime
from pathlib import Path
from openai import OpenAI

MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
TOPIC = "中小型App/跨境电商是否愿意为广告投放数据自动化分析服务付费？"
OUTPUT = Path(__file__).with_name("report.md")

def ask(client, role, instructions, context):
    response = client.responses.create(
        model=MODEL,
        instructions=f"你是{role}。{instructions} 不得编造来源、访谈或已验证的客户需求。",
        input=context,
    )
    return response.output_text

def main():
    if not os.getenv("OPENAI_API_KEY"):
        raise SystemExit("请先设置 OPENAI_API_KEY；未发起任何API请求。")
    client = OpenAI()
    research = ask(client, "Research Agent",
        "提出五种可能的目标客户及痛点、验证渠道和访谈问题。没有证据时必须标为待验证假设。",
        f"研究问题：{TOPIC}。请以Markdown输出。")
    analyst = ask(client, "Analyst Agent",
        "设计可行性评价和7天低成本市场验证计划，不得把假设说成市场事实。",
        f"研究问题：{TOPIC}\nResearch输出：\n{research}")
    reviewer = ask(client, "Reviewer Agent",
        "审查缺失证据、过度推断、未经证实的付费意愿和隐私风险，推荐一个下一步验证动作。",
        f"Research输出：\n{research}\nAnalyst输出：\n{analyst}")
    report = (f"# Agent Pool 需求验证草案\n\n生成时间：{datetime.now().isoformat(timespec='minutes')}"
              f"\n\n> 仅供市场验证规划：未进行实际联网研究或客户访谈。\n"
              f"\n## Research\n{research}\n\n## Analyst\n{analyst}\n\n## Reviewer\n{reviewer}\n")
    OUTPUT.write_text(report, encoding="utf-8")
    print(f"已生成 {OUTPUT}")

if __name__ == "__main__":
    main()
