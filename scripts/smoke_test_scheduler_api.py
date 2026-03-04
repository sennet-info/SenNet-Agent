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
            "device": args.device,
            "frequency": "daily",
            "time": "08:15",
            "report_range_mode": "last_7_days",
            "emails": [args.email],
        },
    )["task"]

    task_id = task["id"]
    call("GET", f"{base}/v1/scheduler/tasks", token=args.admin_token)
    call("PUT", f"{base}/v1/scheduler/tasks/{task_id}", token=args.admin_token, json={"enabled": False})
    call("PUT", f"{base}/v1/scheduler/tasks/{task_id}", token=args.admin_token, json={"enabled": True})

    try:
        run_resp = call("POST", f"{base}/v1/scheduler/tasks/{task_id}/run", token=args.admin_token, json={"debug": True})
        print(f"Run filename: {run_resp.get('filename')}")
    except Exception as exc:
        print(f"Run task warning: {exc}")

    call("DELETE", f"{base}/v1/scheduler/tasks/{task_id}", token=args.admin_token)
    print(f"Smoke scheduler OK at {datetime.now().isoformat(timespec='seconds')}")


if __name__ == "__main__":
    main()
