import json
import os
from typing import Any, Dict, Optional, Tuple

DEFAULT_ENERGY_PRICE = 0.14
DEFAULT_PRICE_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "energy_prices.json")


def _safe_price(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def load_pricing_config(path: Optional[str] = None) -> Dict[str, Any]:
    config_path = path or os.getenv("ENERGY_PRICING_CONFIG_PATH") or DEFAULT_PRICE_FILE
    if not os.path.exists(config_path):
        return {}
    try:
        with open(config_path, "r", encoding="utf-8") as file_handle:
            data = json.load(file_handle)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def resolve_energy_price(
    *,
    tenant: Optional[str],
    client: Optional[str],
    site: Optional[str],
    serial: Optional[str],
    override_price: Optional[float] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Tuple[float, Dict[str, Any]]:
    if override_price is not None:
        valid_override = _safe_price(override_price)
        if valid_override is not None:
            return valid_override, {
                "price_effective": valid_override,
                "price_source": "manual_override",
                "price_override": True,
                "resolved_scope": {
                    "tenant": tenant,
                    "client": client,
                    "site": site,
                    "serial": serial,
                },
            }

    cfg = config if config is not None else load_pricing_config()
    fallback_price = _safe_price(cfg.get("fallback")) or DEFAULT_ENERGY_PRICE
    scopes = cfg.get("scopes") if isinstance(cfg.get("scopes"), dict) else {}

    candidates = [
        ("serial", serial),
        ("site", site),
        ("client", client),
        ("tenant", tenant),
    ]

    for scope_name, scope_key in candidates:
        scope_values = scopes.get(scope_name) if isinstance(scopes.get(scope_name), dict) else {}
        if scope_key and scope_key in scope_values:
            scoped_price = _safe_price(scope_values.get(scope_key))
            if scoped_price is not None:
                return scoped_price, {
                    "price_effective": scoped_price,
                    "price_source": scope_name,
                    "price_override": False,
                    "resolved_scope": {
                        "tenant": tenant,
                        "client": client,
                        "site": site,
                        "serial": serial,
                    },
                }

    return fallback_price, {
        "price_effective": fallback_price,
        "price_source": "fallback",
        "price_override": False,
        "resolved_scope": {
            "tenant": tenant,
            "client": client,
            "site": site,
            "serial": serial,
        },
    }
