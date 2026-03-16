#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def assert_true(cond: bool, msg: str):
    if not cond:
        raise AssertionError(msg)


def main():
    deploy = read("scripts/deploy.sh")
    worker = read("agent_api/scheduler_worker.py")
    legacy_runner = read("app/run_report_oneshot.py")
    api = read("agent_api/main.py")
    legacy_service = read("systemd/sennet-agent.service")
    cron_file = read("cron/sennet-agent.cron")
    streamlit_app = read("app/app.py")
    legacy_oneshot = read("app/run_report_oneshot.py")
    worker_service = read("systemd/sennet-scheduler-worker.service")

    assert_true("sennet-agent-api.service" in deploy, "deploy must install sennet-agent-api.service")
    assert_true("sennet-scheduler-worker.timer" in deploy, "deploy must install scheduler worker timer")
    assert_true("disable --now sennet-agent.service" in deploy, "deploy must disable legacy streamlit service")
    assert_true("rm -f /etc/cron.d/sennet-agent" in deploy, "deploy must remove legacy cron file")

    assert_true("scheduler_run_due" in worker, "scheduler worker must execute FastAPI due-run path")
    assert_true("agent_api.scheduler_worker" in worker_service, "systemd worker must execute agent_api.scheduler_worker")
    assert_true("EmailSender" not in worker, "scheduler worker must not send emails directly")
    assert_true("DEPRECATED" in legacy_runner, "legacy app/run_report_oneshot.py must be disabled")
    assert_true("SystemExit(2)" in legacy_runner, "legacy app/run_report_oneshot.py must hard-fail when executed")

    assert_true("_build_scheduler_email_html" in api, "FastAPI scheduler must own professional HTML email template")
    assert_true("sender.send_email" in api, "FastAPI scheduler must send email")
    assert_true("sender_path" in api, "FastAPI scheduler response must identify sender path")

    assert_true("DEPRECATED" in legacy_service and "ExecStart=/bin/false" in legacy_service, "legacy streamlit service must be disabled")
    assert_true("DEPRECATED" in cron_file, "legacy cron file must be deprecated")
    assert_true("st.stop()" in streamlit_app, "legacy streamlit UI must be hard-disabled")
    assert_true("run_analysis_discovery" not in streamlit_app, "streamlit file must not contain report runtime code")
    assert_true("EmailSender" not in streamlit_app, "streamlit file must not contain smtp runtime code")
    assert_true("run_analysis_discovery" not in legacy_oneshot, "legacy oneshot must not run report generation")
    assert_true("EmailSender" not in legacy_oneshot, "legacy oneshot must not send emails")
    assert_true("SchedulerLogic" not in legacy_oneshot, "legacy oneshot must not orchestrate scheduler tasks")
    assert_true("compute_report_range" not in legacy_oneshot, "legacy oneshot must not resolve report ranges")
    assert_true("run_report_oneshot.py" not in worker_service, "systemd worker must not execute legacy oneshot")
    assert_true("agent_api/scheduler_worker.py" in cron_file, "cron file must point to FastAPI worker deprecation note only")



    # Ensure single active email emitter path (FastAPI scheduler/main)
    active_call_sites = []
    for file in ROOT.rglob("*.py"):
        rel = file.relative_to(ROOT).as_posix()
        if any(part in rel for part in [".git", "portal/node_modules"]) or rel.endswith('.old'):
            continue
        if rel in {"app/modules/email_sender.py", "scripts/validate_fastapi_only_architecture.py"}:
            continue
        if rel.startswith("scripts/") and rel != "scripts/validate_fastapi_only_architecture.py":
            continue
        text = file.read_text(encoding="utf-8", errors="ignore")
        if "send_email(" in text:
            active_call_sites.append(rel)

    assert_true(active_call_sites == ["agent_api/main.py"], f"unexpected active send_email call sites: {active_call_sites}")

    # Python 3.9 compatibility: backend/worker code must not use PEP604 `| None` annotations.
    forbidden_union_hits = []
    for rel in ["agent_api/main.py", "agent_api/scheduler_worker.py", "agent_api/scheduler_store.py"]:
        text = read(rel)
        if "| None" in text:
            forbidden_union_hits.append(rel)
    assert_true(not forbidden_union_hits, f"python3.9 incompatible `| None` found in: {forbidden_union_hits}")

    # Critical import smoke for worker runtime.
    import importlib
    importlib.import_module("agent_api.scheduler_store")
    importlib.import_module("agent_api.main")
    importlib.import_module("agent_api.scheduler_worker")

    print("FastAPI-only architecture validation passed")


if __name__ == "__main__":
    main()
