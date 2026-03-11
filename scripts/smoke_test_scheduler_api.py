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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--admin-token", required=True)
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--client", required=True)
    parser.add_argument("--site", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--serial", default=None)
    parser.add_argument("--expected-price", type=float, default=None)
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    task = call(
        "POST",
        f"{base}/v1/scheduler/tasks",
        token=args.admin_token,
        json={
            "tenant": args.tenant,
            "client": args.client,
            "site": args.site,
            "serial": args.serial,
            "device": args.device,
            "frequency": "daily",
            "time": "08:15",
            "report_range_mode": "last_7_days",
            "emails": [args.email],
        },
    )["task"]

    task_id = task["id"]
    try:
        listing = call("GET", f"{base}/v1/scheduler/tasks", token=args.admin_token)
        listed = next(item for item in listing["items"] if item["id"] == task_id)
        print("Expected pricing:", listed.get("expected_pricing"))
        run_resp = call("POST", f"{base}/v1/scheduler/tasks/{task_id}/run", token=args.admin_token, json={"debug": True})
        debug = run_resp.get("debug") or {}
        pricing_fields = ["price_effective", "price_source", "price_scope", "price_scope_matched_key"]
        for field in pricing_fields:
            if field not in debug:
                raise AssertionError(f"debug no incluye {field}")
        if args.serial and debug.get("serial") != args.serial:
            raise AssertionError(f"serial debug={debug.get('serial')} != esperado={args.serial}")
        if args.expected_price is not None:
            used = float(debug.get("price_effective"))
            if abs(used - args.expected_price) > 1e-9:
                raise AssertionError(f"price_effective={used} != expected={args.expected_price}")
        call("POST", f"{base}/v1/scheduler/run-due", token=args.admin_token, json={})
    finally:
        call("DELETE", f"{base}/v1/scheduler/tasks/{task_id}", token=args.admin_token)

    print(f"Smoke scheduler OK at {datetime.now().isoformat(timespec='seconds')}")


if __name__ == "__main__":
    main()
