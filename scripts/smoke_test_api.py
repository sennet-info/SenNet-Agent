#!/usr/bin/env python3
import argparse
import os
import sys

import requests


def _get(url, **kwargs):
    response = requests.get(url, timeout=30, **kwargs)
    response.raise_for_status()
    return response.json()


def _request(method, url, **kwargs):
    response = requests.request(method, url, timeout=60, **kwargs)
    response.raise_for_status()
    return response.json() if response.content else {"ok": True}


def main():
    parser = argparse.ArgumentParser(description="Smoke test para SenNet Agent API")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Base URL de la API")
    parser.add_argument("--tenant", default=None, help="Tenant a usar")
    parser.add_argument("--admin-token", default=os.getenv("AGENT_ADMIN_TOKEN"), help="Token admin para CRUD")
    args = parser.parse_args()

    base = args.base_url.rstrip("/")

    health = _get(f"{base}/v1/health")
    print("health:", health)

    if not args.tenant:
        print("ERROR: Debes indicar --tenant para ejecutar discovery/report.")
        return 2

    clients = _get(f"{base}/v1/discovery/clients", params={"tenant": args.tenant}).get("items", [])
    if not clients:
        print("ERROR: No hay clients para el tenant indicado")
        return 3
    client = clients[0]

    sites = _get(f"{base}/v1/discovery/sites", params={"tenant": args.tenant, "client": client}).get("items", [])
    if not sites:
        print("ERROR: No hay sites para el client seleccionado")
        return 4
    site = sites[0]

    serials = _get(
        f"{base}/v1/discovery/serials",
        params={"tenant": args.tenant, "client": client, "site": site},
    ).get("items", [])
    print("serials:", len(serials))

    devices = _get(
        f"{base}/v1/discovery/devices",
        params={"tenant": args.tenant, "client": client, "site": site},
    ).get("items", [])
    if not devices:
        print("ERROR: No hay devices para el site seleccionado")
        return 5

    payload = {
        "tenant": args.tenant,
        "client": client,
        "site": site,
        "devices": [devices[0]],
        "range_flux": "7d",
        "price": 0.14,
    }
    report_resp = requests.post(f"{base}/v1/reports", json=payload, timeout=240)
    report_resp.raise_for_status()
    report_data = report_resp.json()
    print("report:", report_data)

    pdf_path = report_data.get("pdf_path")
    if not pdf_path or not os.path.exists(pdf_path):
        print("ERROR: El PDF no existe en disco")
        return 6

    download = requests.get(f"{base}/v1/reports/download", params={"path": pdf_path}, timeout=60)
    download.raise_for_status()
    print("download bytes:", len(download.content))

    if args.admin_token:
        headers = {"Authorization": f"Bearer {args.admin_token}"}
        tenants_before = _get(f"{base}/v1/admin/tenants", headers=headers)
        print("admin tenants:", len(tenants_before.get("items", {})))

        dummy_alias = "smoke_dummy"
        _request(
            "PUT",
            f"{base}/v1/admin/tenants/{dummy_alias}",
            headers=headers,
            json={
                "url": "http://localhost:8086",
                "token": "dummy",
                "org": "dummy",
                "bucket": "dummy",
            },
        )
        tenants_after = _get(f"{base}/v1/admin/tenants", headers=headers)
        print("dummy tenant exists:", dummy_alias in tenants_after.get("items", {}))
        _request("DELETE", f"{base}/v1/admin/tenants/{dummy_alias}", headers=headers)

        roles_before = _get(f"{base}/v1/admin/roles", headers=headers)
        print("admin roles:", len(roles_before.get("items", {})))
        _request("PUT", f"{base}/v1/admin/roles/SMOKE_DEVICE", headers=headers, json={"role": "consumption"})
        roles_after = _get(f"{base}/v1/admin/roles", headers=headers)
        print("smoke role:", roles_after.get("items", {}).get("SMOKE_DEVICE"))
        _request("DELETE", f"{base}/v1/admin/roles/SMOKE_DEVICE", headers=headers)
    else:
        print("WARN: --admin-token no configurado, se omiten pruebas admin")

    print("OK: smoke test completado")
    return 0


if __name__ == "__main__":
    sys.exit(main())
