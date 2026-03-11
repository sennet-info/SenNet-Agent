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
    parser.add_argument("--extra-device", action="append", default=[])
    parser.add_argument("--range-mode", default="last_30_days")
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
            "extra_devices": args.extra_device,
            "frequency": "daily",
            "time": "08:15",
            "report_range_mode": args.range_mode,
            "emails": [args.email],
        },
    )["task"]

    task_id = task["id"]
    try:
        listing = call("GET", f"{base}/v1/scheduler/tasks", token=args.admin_token)
        listed = next(item for item in listing["items"] if item["id"] == task_id)
        print("Expected pricing:", listed.get("expected_pricing"))

        run_resp = call("POST", f"{base}/v1/scheduler/tasks/{task_id}/run", token=args.admin_token, json={"debug": True})
        if run_resp.get("email_sent") is not True:
            raise AssertionError(f"email_sent esperado True y llegó {run_resp.get('email_sent')}")

        debug = run_resp.get("debug") or {}
        required = [
            "price_effective",
            "price_source",
            "price_scope",
            "price_scope_matched_key",
            "resolved_devices",
            "discarded_devices",
            "start_dt",
            "end_dt",
            "range_mode",
        ]
        for field in required:
            if field not in debug:
                raise AssertionError(f"debug no incluye {field}")

        if args.serial and debug.get("serial") != args.serial:
            raise AssertionError(f"serial debug={debug.get('serial')} != esperado={args.serial}")

        if args.range_mode == "last_30_days":
            start_dt = datetime.fromisoformat(debug["start_dt"])
            end_dt = datetime.fromisoformat(debug["end_dt"])
            if (end_dt - start_dt).days != 30:
                raise AssertionError(f"rango incorrecto para last_30_days: {(end_dt - start_dt).days} días")

        if args.range_mode == "previous_full_month":
            start_dt = datetime.fromisoformat(debug["start_dt"])
            end_dt = datetime.fromisoformat(debug["end_dt"])
            if start_dt.day != 1 or start_dt.hour != 0 or start_dt.minute != 0 or start_dt.second != 0:
                raise AssertionError(f"inicio previous_full_month inválido: {start_dt.isoformat()}")
            if end_dt.day < 28 or end_dt.hour != 23 or end_dt.minute != 59 or end_dt.second != 59:
                raise AssertionError(f"fin previous_full_month inválido: {end_dt.isoformat()}")

        if args.extra_device:
            resolved = set(debug.get("resolved_devices") or [])
            discarded = {item.get("device") for item in (debug.get("discarded_devices") or []) if isinstance(item, dict)}
            for extra in args.extra_device:
                if extra not in resolved and extra not in discarded:
                    raise AssertionError(f"extra_device sin traza ni resuelto ni descartado: {extra}")

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
