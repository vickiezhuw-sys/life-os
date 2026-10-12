"""Life OS Agent Pool v0.1: DeepSeek + Zhipu, staged and auditable.

Default is a no-cost dry run. --execute explicitly starts API requests.
"""
import argparse
import os
from datetime import datetime
from pathlib import Path

from openai import OpenAI

HERE = Path(__file__).resolve().parent
PROVIDERS = {
    "zhipu": {
        "key_env": "ZHIPU_API_KEY",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "model_env": "ZHIPU_MODEL",
        "model": "glm-5.3-flash",
        "max_tokens": 2400,
    },
    "deepseek": {
        "key_env": "DEEPSEEK_API_KEY",
        "base_url": "https://api.deepseek.com",
        "model_env": "DEEPSEEK_MODEL",
        "model": "deepseek-flash",
        "max_tokens": 1300,
    },
}
STEPS = (
    ("Research", "zhipu", "提出3类潜在付费客户、核心痛点和需要的实际证据；不得杜撰需求已被验证。"),
    ("Analyst", "deepseek", "根据Research信息提出7天低成本验证方案，给出行动、指标、成本与停止条件。"),
    ("Reviewer", "zhipu", "交叉审查前两步：指出未经证实之处、潜在偏差、成本风险，并提出下一个可核实动作。"),
)
DEFAULT_TOPIC = "验证中小App和跨境电商是否愿意为广告投放数据自动化分析服务付费"


def call_model(provider, role, instructions, topic, prior):
    conf = PROVIDERS[provider]
    key = os.getenv(conf["key_env"])
    if not key:
        raise RuntimeError("缺少 " + conf["key_env"] + "；不要将密钥发给他人。")
    client = OpenAI(
        api_key=key,
        base_url=conf["base_url"],
        timeout=float(os.getenv("AGENT_TIMEOUT_SEC", "120")),
        max_retries=0,
    )
    request = dict(
        model=os.getenv(conf["model_env"]) or conf["model"],
        messages=[
            {"role": "system", "content": (
                "你是" + role + " Agent。" + instructions
                + " 以中文输出精简结构化结论，不超过500字。"
                + " 未联网检索，不得编造链接、数据、访谈或已证实的付费意愿。"
            )},
            {"role": "user", "content": "用户目标：" + topic + "\n\n已完成的Agent输出：\n" + prior[-12000:]},
        ],
        max_tokens=conf["max_tokens"],
        stream=False,
    )
    if provider == "deepseek":
        request["extra_body"] = {"thinking": {"type": "disabled"}}
    result = client.chat.completions.create(**request)
    if not result.choices:
        raise RuntimeError(provider + " 未返回choices")
    choice = result.choices[0]
    content = choice.message.content or ""
    if not content.strip():
        raise RuntimeError(provider + " 输出为空；结束原因：" + str(choice.finish_reason))
    return content.strip(), choice.finish_reason


def render_header(topic, status):
    return (
        "# Agent Pool v0.1 多模型任务报告\n\n"
        + "状态：" + status + "\n\n"
        + "生成时间：" + datetime.now().isoformat(timespec="minutes") + "\n\n"
        + "目标：" + topic + "\n\n"
        + "> 研究草案：未接入实时搜索、未访问客户、未验证真实付费意愿。\n"
    )


def run(topic, execute):
    if not execute:
        preview = render_header(topic, "预演（未调用任何API）")
        for role, provider, instructions in STEPS:
            preview += "\n## " + role + " · " + provider + "\n\n" + instructions + "\n"
        path = HERE / "report.preview.md"
        path.write_text(preview, encoding="utf-8")
        print("预演完成（无API请求）：" + str(path))
        return

    missing = [v["key_env"] for v in PROVIDERS.values() if not os.getenv(v["key_env"])]
    if missing:
        raise SystemExit("尚未配置API密钥：" + ", ".join(missing))
    print("将执行3次API模型调用（智谱→DeepSeek→智谱）；可能产生费用。")
    prior = ""
    sections = []
    partial = HERE / "report.partial.md"
    for role, provider, instructions in STEPS:
        print("正在运行 " + role + " (" + provider + ")...", flush=True)
        try:
            content, reason = call_model(provider, role, instructions, topic, prior)
        except Exception as exc:
            partial.write_text(render_header(topic, "部分完成，后续调用失败") + "\n\n".join(sections), encoding="utf-8")
            print("执行中断。已保存完成的步骤：" + str(partial))
            print("错误类型：" + type(exc).__name__ + "；" + str(exc)[:500])
            raise SystemExit(1) from None
        section = "## " + role + " · " + provider + "（结束原因：" + str(reason) + "）\n\n" + content
        sections.append(section)
        prior += "\n\n" + section
        partial.write_text(render_header(topic, "进行中") + "\n\n".join(sections) + "\n", encoding="utf-8")
        print(role + " 完成。", flush=True)
    final = HERE / "report.md"
    final.write_text(render_header(topic, "全部3步完成") + "\n\n".join(sections) + "\n", encoding="utf-8")
    print("执行完成：" + str(final))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--topic", default=DEFAULT_TOPIC)
    parser.add_argument("--execute", action="store_true", help="调用真实API并产生可能的费用，默认关闭")
    args = parser.parse_args()
    run(args.topic, args.execute)
