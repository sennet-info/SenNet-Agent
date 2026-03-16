#!/usr/bin/env python3
import os
import sys
import tempfile
from pathlib import Path
from datetime import datetime, timedelta

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent_api.scheduler_store import (
    claim_task_execution,
    compute_task_slot,
    finish_task_execution,
    list_due_task_ids,
    save_tasks,
)


def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)


def _task(task_id="t1"):
    return {
        "id": task_id,
        "tenant_alias": "ten",
        "client": "cli",
        "site": "site",
        "device": "General",
        "frequency": "daily",
        "time": "08:00",
        "emails": ["ops@example.com"],
        "enabled": True,
    }


def test_daily_once_per_slot():
    now = datetime(2026, 1, 10, 8, 1, 0)
    save_tasks([_task()])
    due = list_due_task_ids(now=now)
    assert_true(due == ["t1"], "task should be due initially")

    claim = claim_task_execution("t1", source="timer", now=now)
    assert_true(claim.get("ok"), "claim should succeed")
    run_id = claim.get("run_id")
    finish_task_execution("t1", run_id, status="ok", sent_ok=True, duration_ms=123)

    due_again = list_due_task_ids(now=now + timedelta(minutes=4))
    assert_true(due_again == [], "task must not run again in same slot")


def test_no_duplicate_while_in_progress_longer_than_minute():
    now = datetime(2026, 1, 10, 8, 1, 0)
    save_tasks([_task()])

    claim = claim_task_execution("t1", source="timer", now=now)
    assert_true(claim.get("ok"), "first claim should succeed")

    due_later = list_due_task_ids(now=now + timedelta(minutes=2))
    assert_true(due_later == [], "in-progress slot should not be due again")


def test_no_duplicate_when_worker_relaunched_in_progress():
    now = datetime(2026, 1, 10, 8, 1, 0)
    save_tasks([_task()])
    first = claim_task_execution("t1", source="timer", now=now)
    second = claim_task_execution("t1", source="timer", now=now + timedelta(minutes=1))
    assert_true(first.get("ok") is True, "first claim should pass")
    assert_true(second.get("ok") is False and second.get("reason") == "in_progress", "second claim should be blocked")


def test_manual_debug_does_not_create_timer_duplicate():
    now = datetime(2026, 1, 10, 8, 1, 0)
    save_tasks([_task()])

    manual = claim_task_execution("t1", source="debug", now=now)
    assert_true(manual.get("ok"), "manual/debug claim should pass")
    finish_task_execution("t1", manual.get("run_id"), status="ok", sent_ok=False, duration_ms=10)

    due_after_manual = list_due_task_ids(now=now)
    assert_true(due_after_manual == ["t1"], "manual/debug should not mark timer slot completed")


def test_slot_shape_daily_weekly_monthly():
    base = _task()
    now = datetime(2026, 1, 10, 8, 1, 0)
    assert_true(compute_task_slot(base, now=now) == "daily:2026-01-10:08:00", "daily slot mismatch")
    weekly = dict(base)
    weekly["frequency"] = "weekly"
    weekly["weekday"] = now.weekday()
    assert_true(compute_task_slot(weekly, now=now).startswith("weekly:2026-01-10:08:00"), "weekly slot mismatch")
    monthly = dict(base)
    monthly["frequency"] = "monthly"
    assert_true(compute_task_slot(monthly, now=now) == "monthly:2026-01:08:00", "monthly slot mismatch")


def main():
    with tempfile.TemporaryDirectory() as td:
        os.environ["SCHEDULED_TASKS_PATH"] = os.path.join(td, "scheduled_tasks.json")
        test_daily_once_per_slot()
        test_no_duplicate_while_in_progress_longer_than_minute()
        test_no_duplicate_when_worker_relaunched_in_progress()
        test_manual_debug_does_not_create_timer_duplicate()
        test_slot_shape_daily_weekly_monthly()
    print("scheduler slot idempotency tests passed")


if __name__ == "__main__":
    main()
