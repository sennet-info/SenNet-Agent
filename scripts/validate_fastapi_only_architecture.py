#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


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

    assert_true("_build_scheduler_email_html" in api, "FastAPI scheduler must own professional HTML email template")
    assert_true("sender.send_email" in api, "FastAPI scheduler must send email")

    assert_true("DEPRECATED" in legacy_service and "ExecStart=/bin/false" in legacy_service, "legacy streamlit service must be disabled")
    assert_true("DEPRECATED" in cron_file, "legacy cron file must be deprecated")
    assert_true("st.stop()" in streamlit_app, "legacy streamlit UI must be hard-disabled")
    assert_true("run_analysis_discovery" not in streamlit_app, "streamlit file must not contain report runtime code")
    assert_true("EmailSender" not in streamlit_app, "streamlit file must not contain smtp runtime code")
    assert_true("run_analysis_discovery" not in legacy_oneshot, "legacy oneshot must not run report generation")
    assert_true("EmailSender" not in legacy_oneshot, "legacy oneshot must not send emails")

    print("FastAPI-only architecture validation passed")


if __name__ == "__main__":
    main()
