import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1] / "app"))

import asyncio
import tempfile
import unittest
from unittest.mock import patch

from agent_api import scheduler_executor as se


class SchedulerExecutorTests(unittest.TestCase):
    def test_execute_scheduled_task_applies_serial_price_and_debug(self):
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
                "extra_devices": ["dev-extra"],
                "emails": ["ops@example.com"],
                "report_range_mode": "last_7_days",
            }

            def fake_safe(path: str):
                if path.endswith(".scheduler.debug.json"):
                    return Path(td) / path
                return out_pdf

            with patch.object(se, "get_tenant_auth", return_value={"x": 1}), \
                patch.object(se, "resolve_default_price", return_value=(0.014568, "serial", "DL200sn23065100")), \
                patch.object(se, "generate_report_pdf", return_value=(str(out_pdf), {"seed": 1})), \
                patch.object(se, "safe_output_path", side_effect=fake_safe), \
                patch.object(se, "smtp_store") as smtp_store, \
                patch.object(se, "EmailSender") as sender:
                smtp_store.return_value.read.return_value = {"server": "smtp", "port": 587, "user": "u", "password": "p"}
                sender.return_value.send_email.return_value = (True, "ok")
                result = asyncio.run(se.execute_scheduled_task(task, trigger_source="scheduler", debug=True, send_email=True))

            self.assertEqual(result["effective_price"], 0.014568)
            self.assertEqual(result["price_source"], "serial")
            self.assertEqual(result["debug"]["price_scope_matched_key"], "DL200sn23065100")
            self.assertEqual(result["debug"]["resolved_devices"], ["dev-main", "dev-extra"])
            self.assertTrue(Path(result["debug_path"]).exists())

    def test_is_due_daily_window(self):
        now = se.datetime(2025, 1, 15, 8, 5, 0)
        task = {"enabled": True, "frequency": "daily", "time": "08:00", "last_run": None}
        self.assertTrue(se._is_due(task, now))


if __name__ == "__main__":
    unittest.main()
