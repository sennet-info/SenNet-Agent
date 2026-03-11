#!/usr/bin/env python3
import argparse
import json
from datetime import datetime

import requests


def call(method, url, token=None, **kwargs):
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = requests.request(method, url, headers=headers, timeout=30, **kwargs)
    print(f"{method} {url} -> {response.status_code}")
    data = response.json() if response.content else {}
    print(json.dumps(data, indent=2, ensure_ascii=False))
    response.raise_for_status()
    return data


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--admin-token", required=True)
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--client", required=True)
    parser.add_argument("--site", required=True)
    parser.add_argument("--serial", default="")
    parser.add_argument("--device", required=True)
    parser.add_argument("--extra-device", action="append", default=[])
    parser.add_argument("--email", required=True)
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    payload = {
        "tenant": args.tenant,
        "client": args.client,
        "site": args.site,
        "serial": args.serial or None,
        "device": args.device,
        "extra_devices": args.extra_device,
        "frequency": "daily",
        "time": "08:15",
        "report_range_mode": "last_30_days",
        "emails": [args.email],
    }
    task = call("POST", f"{base}/v1/scheduler/tasks", token=args.admin_token, json=payload)["task"]

    task_id = task["id"]
    try:
        run_resp = call("POST", f"{base}/v1/scheduler/tasks/{task_id}/run", token=args.admin_token, json={"debug": True})
        debug = run_resp.get("debug") or {}
        resolved_range = debug.get("resolved_range") or {}
        device_scope = debug.get("device_scope") or {}
        pricing = debug.get("pricing") or {}
        audit = debug.get("audit") or {}

        assert_true(run_resp.get("ok") is True, "run: expected ok=true")
        assert_true(run_resp.get("email_sent") is True, "run: expected email_sent=true")
        assert_true(bool(run_resp.get("email_recipients")), "run: expected email_recipients")
        assert_true(resolved_range.get("range_mode") == "last_n_days", "resolved_range.range_mode must be last_n_days")
        assert_true((resolved_range.get("criteria") or {}).get("days") == 30, "resolved_range.criteria.days must be 30")
        assert_true(device_scope.get("requested_device") == args.device, "device_scope.requested_device mismatch")
        assert_true(isinstance(device_scope.get("requested_devices_all"), list), "device_scope.requested_devices_all must be list")
        assert_true(isinstance(device_scope.get("resolved_devices"), list), "device_scope.resolved_devices must be list")
        assert_true("price_effective" in pricing, "pricing.price_effective missing")
        assert_true("price_source" in pricing, "pricing.price_source missing")
        assert_true("price_scope" in pricing, "pricing.price_scope missing")
        assert_true("price_scope_matched_key" in pricing, "pricing.price_scope_matched_key missing")
        assert_true("price_applied_in_report" in audit, "audit.price_applied_in_report missing")
        assert_true(audit.get("price_matches_report") in {True, None}, "audit.price_matches_report should be true when available")
        print("Scheduler smoke assertions OK")
    finally:
        call("DELETE", f"{base}/v1/scheduler/tasks/{task_id}", token=args.admin_token)

    print(f"Smoke scheduler OK at {datetime.now().isoformat(timespec='seconds')}")


if __name__ == "__main__":
    main()
