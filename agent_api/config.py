import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
APP_DIR = BASE_DIR / "app"
TENANTS_PATH = APP_DIR / "config_tenants.json"
OUTPUT_DIR = (APP_DIR / "output").resolve()


class TenantNotFoundError(ValueError):
    pass


def _normalize_tenants(raw_data):
    if isinstance(raw_data, dict) and "tenants" in raw_data and isinstance(raw_data["tenants"], list):
        normalized = {}
        for item in raw_data["tenants"]:
            alias = item.get("name") or item.get("client")
            if not alias:
                continue
            normalized[alias] = {
                "url": item.get("url") or item.get("influx_url"),
                "token": item.get("token"),
                "org": item.get("org"),
                "bucket": item.get("bucket"),
            }
        return normalized

    if isinstance(raw_data, dict):
        return raw_data

    return {}


def load_tenants_config():
    if not TENANTS_PATH.exists():
        return {}
    with TENANTS_PATH.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return _normalize_tenants(data)


def get_tenant_auth(tenant: str):
    tenants = load_tenants_config()
    auth_config = tenants.get(tenant)
    if not auth_config:
        raise TenantNotFoundError(f"Tenant '{tenant}' no existe")

    required = ["url", "token", "org", "bucket"]
    missing = [key for key in required if not auth_config.get(key)]
    if missing:
        raise TenantNotFoundError(f"Tenant '{tenant}' incompleto: faltan {', '.join(missing)}")
    return auth_config


def safe_output_path(path_value: str):
    candidate = Path(path_value)
    if not candidate.is_absolute():
        candidate = (OUTPUT_DIR / candidate).resolve()
    else:
        candidate = candidate.resolve()

    if OUTPUT_DIR not in candidate.parents and candidate != OUTPUT_DIR:
        raise ValueError("Ruta no permitida")
    return candidate
