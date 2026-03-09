from typing import Any, Optional

from agent_api.config import load_energy_prices_config

DEFAULT_PRICE = 0.14
SCOPE_PRIORITY = ("serial", "site", "client", "tenant")


def _as_price(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def resolve_default_price(*, tenant: Optional[str], client: Optional[str], site: Optional[str], serial: Optional[str]) -> tuple[float, str, Optional[str]]:
    config = load_energy_prices_config()
    fallback = _as_price(config.get("fallback"))
    scopes = config.get("scopes") if isinstance(config.get("scopes"), dict) else {}

    values = {
        "tenant": tenant,
        "client": client,
        "site": site,
        "serial": serial,
    }

    for scope in SCOPE_PRIORITY:
        scope_map = scopes.get(scope) if isinstance(scopes.get(scope), dict) else {}
        scope_key = values.get(scope)
        if scope_key and scope_key in scope_map:
            scoped_price = _as_price(scope_map.get(scope_key))
            if scoped_price is not None:
                return scoped_price, scope, scope_key

    if fallback is not None:
        return fallback, "fallback", None
    return DEFAULT_PRICE, "fallback", None


def get_pricing_config() -> dict[str, Any]:
    config = load_energy_prices_config()
    normalized_scopes: dict[str, dict[str, float]] = {}
    raw_scopes = config.get("scopes") if isinstance(config.get("scopes"), dict) else {}
    for scope in SCOPE_PRIORITY:
        entries = raw_scopes.get(scope) if isinstance(raw_scopes.get(scope), dict) else {}
        normalized_scopes[scope] = {
            str(key): value
            for key, value in ((key, _as_price(raw_value)) for key, raw_value in entries.items())
            if value is not None
        }

    fallback = _as_price(config.get("fallback"))
    return {
        "fallback": fallback if fallback is not None else DEFAULT_PRICE,
        "scopes": normalized_scopes,
    }
