"""Agent Pool v0.2: private GitHub Actions job runner (Python standard library).

The orchestrator in ChatGPT plans tasks; this worker executes fixed bounded steps.
No network calls unless --execute is explicitly specified.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

STAGES = (
    ("Research", "zhipu", "提出最多3种客户假设和应当寻找的证据。严禁编造网址、访谈或已验证付费意愿。"),
    ("Analyst", "deepseek", "利用Research结果设计7天低成本验证计划，包含实际验证步骤和停止条件。"),
    ("Reviewer", "zhipu", "质检Research及Analyst的推断、验证条件、费用与数据风险，给出唯一优先行动。"),
)
PROVIDERS = {
    "zhipu": ("ZHIPU_API_KEY", "https://open.bigmodel.cn/api/paas/v4/chat/completions", "ZHIPU_MODEL", "glm-5.3-flash", 2400),
    "deepseek": ("DEEPSEEK_API_KEY", "https://api.deepseek.com/chat/completions", "DEEPSEEK_MODEL", "deepseek-flash", 1200),
}
DEFAULT_TOPIC = "验证中小App是否愿意为广告投放数据自动化分析服务付费"


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def safe_id(value):
    result = re.sub(r"[^A-Za-z0-9_-]", "-", str(value))[:50].strip("-")
    if not result:
        raise ValueError("task id cannot be empty")
    return result


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_report(path, state):
    parts = [
        "# Agent Pool v0.2 · 工作报告",
        "",
        f"任务ID：{state['id']}",
        f"状态：{state['status']}",
        f"目标：{state['objective']}",
        "",
        "> 这是AI生成的验证方案；此版本没有联网检索或真实客户访谈，所有商业结论都必须另行查证。",
        "",
    ]
    for stage in state["stages"]:
        parts += [f"## {stage['role']} · {stage['provider']}", "", stage.get("output", "未执行"), ""]
    path.write_text("\n".join(parts), encoding="utf-8")


def call_provider(provider, role, instruction, objective, previous, max_chars=12000):
    key_name, url, model_env, default_model, max_tokens = PROVIDERS[provider]
    key = os.getenv(key_name)
    if not key:
        raise RuntimeError(f"missing {key_name}; configure in private GitHub Actions secrets")
    payload = {
        "model": os.getenv(model_env) or default_model,
        "messages": [
            {"role": "system", "content": (
                f"你是{role} Agent。{instruction} 请用中文输出简洁结构化内容，不超过450字。"
                "严格区分已证实事实和未经验证的假设。不得要求或展示API密钥。"
            )},
            {"role": "user", "content": f"目标：{objective}\n\n已完成阶段的成果：\n{previous[-max_chars:]}"},
        ],
        "max_tokens": max_tokens,
        "stream": False,
    }
    if provider == "deepseek":
        payload["thinking"] = {"type": "disabled"}
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8", "Authorization": "Bearer " + key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"{provider} API HTTP {exc.code}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{provider} network error: {type(exc.reason).__name__}") from None
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"{provider}: empty choices")
    choice = choices[0]
    output = (choice.get("message") or {}).get("content") or ""
    if not output.strip():
        raise RuntimeError(f"{provider}: empty content; finish_reason={choice.get('finish_reason')}")
    if choice.get("finish_reason") == "length":
        raise RuntimeError(f"{provider}: output truncated by max_tokens")
    return output.strip(), payload["model"]


def run(objective, task_id, output_dir, execute=False):
    if not objective.strip():
        raise ValueError("objective must not be empty")
    if len(objective) > 10000:
        raise ValueError("objective too long (max 10000 characters)")
    out = Path(output_dir) / safe_id(task_id)
    out.mkdir(parents=True, exist_ok=True)
    state = {
        "id": safe_id(task_id), "objective": objective,
        "status": "pending" if execute else "dry_run",
        "created_at_utc": utc_now(), "stages": [],
    }
    state_file, report_file = out / "state.json", out / "report.md"
    write_json(state_file, state)
    if not execute:
        for role, provider, instruction in STAGES:
            state["stages"].append({"role": role, "provider": provider, "status": "planned",
                                    "output": instruction})
        write_json(state_file, state)
        write_report(report_file, state)
        print(f"DRY RUN: {out} (no model calls)")
        return state
    missing = [config[0] for config in PROVIDERS.values() if not os.getenv(config[0])]
    if missing:
        state["status"] = "blocked"
        state["error"] = "missing required environment secrets: " + ", ".join(missing)
        write_json(state_file, state)
        write_report(report_file, state)
        raise RuntimeError(state["error"])
    state["status"] = "running"
    write_json(state_file, state)
    context = ""
    for role, provider, instruction in STAGES:
        print(f"Starting {role} ({provider})...", flush=True)
        try:
            content, model = call_provider(provider, role, instruction, objective, context)
        except Exception as exc:
            state["status"] = "failed"
            state["failed_stage"] = role
            state["error"] = f"{type(exc).__name__}: {str(exc)[:180]}"
            write_json(state_file, state)
            write_report(report_file, state)
            raise RuntimeError(f"failed at {role}: {type(exc).__name__}") from None
        stage = {"role": role, "provider": provider, "model": model,
                 "status": "completed", "output": content, "completed_at_utc": utc_now()}
        state["stages"].append(stage)
        context += f"\n\n## {role} ({provider})\n{content}"
        write_json(state_file, state)
        write_report(report_file, state)
        print(f"Completed {role}", flush=True)
    state["status"] = "completed"
    state["completed_at_utc"] = utc_now()
    write_json(state_file, state)
    write_report(report_file, state)
    print(f"COMPLETED: {out}")
    return state


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", default=os.getenv("AGENT_TASK_ID", "demo"))
    parser.add_argument("--objective", default=os.getenv("AGENT_TASK_TEXT", DEFAULT_TOPIC))
    parser.add_argument("--output-dir", default="output")
    parser.add_argument("--execute", action="store_true", help="issue paid model calls; default dry-run")
    args = parser.parse_args()
    try:
        run(args.objective, args.task_id, args.output_dir, args.execute)
    except (RuntimeError, ValueError) as error:
        print(f"Agent run stopped: {error}", file=sys.stderr)
        sys.exit(1)
