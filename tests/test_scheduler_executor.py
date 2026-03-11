import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1] / "app"))

import asyncio
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from agent_api import scheduler_executor as se


class SchedulerExecutorTests(unittest.TestCase):
    def test_execute_scheduled_task_applies_serial_price_range_devices_and_email(self):
        with tempfile.TemporaryDirectory() as td:
            out_pdf = Path(td) / "report.pdf"
            out_pdf.write_bytes(b"pdf")

            task = {
                "id": "task-1",
                "tenant_alias": "t1",
                "client": "c1",
                "site": "s1",
                "serial": "DL200sn23065100",
                "device": "dev-main",
                "extra_devices": ["dev-extra", "dev-missing"],
                "emails": ["ops@example.com"],
                "report_range_mode": "last_30_days",
            }

            now = datetime(2025, 1, 31, 10, 0, 0).astimezone()

            def fake_safe(path: str):
                if path.endswith(".scheduler.debug.json"):
                    return Path(td) / path
                return out_pdf

            with patch.object(se, "get_tenant_auth", return_value={"x": 1}), \
                patch.object(se, "resolve_default_price", return_value=(0.014568, "serial", "DL200sn23065100")), \
                patch.object(se, "list_devices", return_value=["dev-main", "dev-extra"]), \
                patch.object(se, "generate_report_pdf", return_value=(str(out_pdf), {"seed": 1})), \
                patch.object(se, "safe_output_path", side_effect=fake_safe), \
                patch.object(se, "smtp_store") as smtp_store, \
                patch.object(se, "EmailSender") as sender, \
                patch.object(se, "_now", return_value=now):
                smtp_store.return_value.read.return_value = {"server": "smtp", "port": 587, "user": "u", "password": "p"}
                sender.return_value.send_email.return_value = (True, "ok")
                result = asyncio.run(se.execute_scheduled_task(task, trigger_source="manual", debug=True, send_email=True))

            self.assertEqual(result["effective_price"], 0.014568)
            self.assertEqual(result["price_source"], "serial")
            self.assertEqual(result["email_sent"], True)
            self.assertEqual(result["email_recipients"], ["ops@example.com"])
            self.assertEqual(result["resolved_devices"], ["dev-main", "dev-extra"])
            self.assertEqual(result["discarded_devices"], [{"device": "dev-missing", "reason": "not_available_in_scope"}])
            self.assertEqual(result["range_mode"], "last_n_days")

            start_dt = datetime.fromisoformat(result["start_dt"])
            end_dt = datetime.fromisoformat(result["end_dt"])
            self.assertEqual((end_dt - start_dt).days, 30)

            self.assertEqual(result["debug"]["price_scope_matched_key"], "DL200sn23065100")
            self.assertEqual(result["debug"]["requested_extra_devices"], ["dev-extra", "dev-missing"])
            self.assertTrue(Path(result["debug_path"]).exists())


    def test_execute_previous_full_month_range_is_closed_month(self):
        with tempfile.TemporaryDirectory() as td:
            out_pdf = Path(td) / "report.pdf"
            out_pdf.write_bytes(b"pdf")

            task = {
                "id": "task-2",
                "tenant_alias": "t1",
                "client": "c1",
                "site": "s1",
                "serial": None,
                "device": "dev-main",
                "extra_devices": [],
                "emails": ["ops@example.com"],
                "report_range_mode": "previous_full_month",
            }

            now = datetime(2024, 3, 15, 10, 0, 0).astimezone()

            def fake_safe(path: str):
                if path.endswith(".scheduler.debug.json"):
                    return Path(td) / path
                return out_pdf

            with patch.object(se, "get_tenant_auth", return_value={"x": 1}), \
                patch.object(se, "resolve_default_price", return_value=(0.14, "fallback", None)), \
                patch.object(se, "list_devices", return_value=["dev-main"]), \
                patch.object(se, "generate_report_pdf", return_value=(str(out_pdf), {})), \
                patch.object(se, "safe_output_path", side_effect=fake_safe), \
                patch.object(se, "smtp_store") as smtp_store, \
                patch.object(se, "EmailSender") as sender, \
                patch.object(se, "_now", return_value=now):
                smtp_store.return_value.read.return_value = {"server": "smtp", "port": 587, "user": "u", "password": "p"}
                sender.return_value.send_email.return_value = (True, "ok")
                result = asyncio.run(se.execute_scheduled_task(task, trigger_source="manual", debug=True, send_email=True))

            start_dt = datetime.fromisoformat(result["start_dt"])
            end_dt = datetime.fromisoformat(result["end_dt"])
            self.assertEqual(start_dt.month, 2)
            self.assertEqual(start_dt.day, 1)
            self.assertEqual(start_dt.hour, 0)
            self.assertEqual(end_dt.month, 2)
            self.assertEqual(end_dt.day, 29)
            self.assertEqual(end_dt.hour, 23)
            self.assertEqual(end_dt.minute, 59)
            self.assertEqual(end_dt.second, 59)

    def test_is_due_daily_window(self):
        now = se.datetime(2025, 1, 15, 8, 5, 0)
        task = {"enabled": True, "frequency": "daily", "time": "08:00", "last_run": None}
        self.assertTrue(se._is_due(task, now))


if __name__ == "__main__":
    unittest.main()
