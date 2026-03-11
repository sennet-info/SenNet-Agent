import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1] / "app"))

from datetime import datetime
from types import SimpleNamespace
import unittest

from agent_api.report_time import resolve_report_time


class ReportTimeTests(unittest.TestCase):
    def test_last_30_days_alias_resolves_30_days(self):
        now = datetime(2025, 1, 31, 12, 0, 0).astimezone()
        payload = SimpleNamespace(range_mode="last_30_days", last_days=None, range_flux=None, start_dt=None, end_dt=None, range_label=None)
        resolved = resolve_report_time(payload, now=now)
        self.assertEqual(resolved.range_mode, "last_n_days")
        self.assertEqual((resolved.end_dt - resolved.start_dt).days, 30)

    def test_previous_full_month_handles_leap_year(self):
        now = datetime(2024, 3, 15, 8, 0, 0).astimezone()
        payload = SimpleNamespace(range_mode="previous_full_month", last_days=None, range_flux=None, start_dt=None, end_dt=None, range_label=None)
        resolved = resolve_report_time(payload, now=now)
        self.assertEqual(resolved.start_dt.day, 1)
        self.assertEqual(resolved.start_dt.month, 2)
        self.assertEqual(resolved.end_dt.month, 2)
        self.assertEqual(resolved.end_dt.day, 29)
        self.assertEqual((resolved.end_dt - resolved.start_dt).days, 28)
        self.assertEqual(resolved.end_dt.hour, 23)
        self.assertEqual(resolved.end_dt.minute, 59)
        self.assertEqual(resolved.end_dt.second, 59)


if __name__ == "__main__":
    unittest.main()
