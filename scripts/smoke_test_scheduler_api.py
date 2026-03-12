#!/usr/bin/env python3
import argparse
import copy
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
    parser.add_argument("--serial-price", type=float, default=None, help="If provided, set this serial price during test and verify it is applied")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")

    original_pricing = None
    if args.serial and args.serial_price is not None:
        original_pricing = call("GET", f"{base}/v1/pricing/defaults", token=args.admin_token).get("item") or {}
        patched = copy.deepcopy(original_pricing)
        patched.setdefault("scopes", {})
        patched["scopes"].setdefault("serial", {})
        patched["scopes"]["serial"][args.serial] = args.serial_price
        call("POST", f"{base}/v1/pricing/defaults", token=args.admin_token, json=patched)

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
        device_debug = audit.get("device_debug") or {}

        assert_true(run_resp.get("ok") is True, "run: expected ok=true")
        assert_true(bool(run_resp.get("debug_path")), "run: expected debug_path")
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
        assert_true("price_used_in_pdf" in audit, "audit.price_used_in_pdf missing")
        assert_true(isinstance(device_debug, dict), "audit.device_debug must be dict")
        assert_true(audit.get("price_matches_report") in {True, None}, "audit.price_matches_report should be true when available")

        if args.extra_device:
            expected = {args.device, *args.extra_device}
            requested = set(device_scope.get("requested_devices_all") or [])
            assert_true(expected.issubset(requested), "expected requested_devices_all to include primary + extras")
            processed = set(audit.get("devices_processed_in_report") or [])
            resolved = set(device_scope.get("resolved_devices") or [])
            assert_true(processed.issubset(resolved), "processed devices must be subset of resolved_devices")
            for dev in expected:
                assert_true(dev in device_debug, f"device_debug missing for {dev}")
                info = device_debug.get(dev) or {}
                assert_true("daily_rows" in info and "raw_rows" in info, f"device_debug rows missing for {dev}")
                assert_true("generated_kpis" in info, f"device_debug generated_kpis missing for {dev}")

        if args.serial and args.serial_price is not None:
            assert_true(pricing.get("price_source") == "serial", "pricing.price_source should be serial")
            assert_true(pricing.get("price_scope_matched_key") == args.serial, "pricing.price_scope_matched_key should match serial")
            assert_true(abs(float(pricing.get("price_effective")) - args.serial_price) < 1e-9, "pricing.price_effective mismatch")
            report_price = audit.get("price_applied_in_report")
            pdf_price = audit.get("price_used_in_pdf")
            assert_true(isinstance(report_price, (int, float)), "audit.price_applied_in_report should be numeric")
            assert_true(isinstance(pdf_price, (int, float)), "audit.price_used_in_pdf should be numeric")
            assert_true(abs(float(report_price) - args.serial_price) < 1e-9, "audit.price_applied_in_report mismatch")
            assert_true(abs(float(pdf_price) - args.serial_price) < 1e-9, "audit.price_used_in_pdf mismatch")


        debug_only = call("POST", f"{base}/v1/scheduler/tasks/{task_id}/debug", token=args.admin_token, json={"debug": True})
        assert_true(debug_only.get("ok") is True, "debug-only: expected ok=true")
        assert_true(debug_only.get("email_sent") is False, "debug-only: email must be disabled")
        assert_true(debug_only.get("email_detail") == "email_disabled_for_debug", "debug-only: email detail mismatch")
        assert_true(bool(debug_only.get("debug_path")), "debug-only: expected debug_path")

        print("Scheduler smoke assertions OK")
    finally:
        call("DELETE", f"{base}/v1/scheduler/tasks/{task_id}", token=args.admin_token)
        if original_pricing is not None:
            call("POST", f"{base}/v1/pricing/defaults", token=args.admin_token, json=original_pricing)

    print(f"Smoke scheduler OK at {datetime.now().isoformat(timespec='seconds')}")


if __name__ == "__main__":
    main()
