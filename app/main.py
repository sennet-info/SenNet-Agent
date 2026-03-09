import json
import time

import streamlit as st

from core.discovery import list_clients, list_devices, list_serials, list_sites
from core.report import generate_report_pdf
from modules.energy_pricing import resolve_energy_price

_FALLBACK_RUNTIME_STATE = {}


def _runtime_state():
    try:
        return st.session_state
    except Exception:
        return _FALLBACK_RUNTIME_STATE


@st.cache_data(ttl=600, show_spinner=False)
def _get_discovery_options_cached(url, token, org, bucket, level, parent, site, serial):
    auth_config = {
        "url": url,
        "token": token,
        "org": org,
        "bucket": bucket,
    }
    if level == "clients":
        return list_clients(auth_config)
    if level == "sites":
        return list_sites(auth_config, parent)
    if level == "serials":
        return list_serials(auth_config, parent, site)
    if level == "devices":
        return list_devices(auth_config, parent, site, serial=serial)
    return []


def get_discovery_options(auth_config, level, parent=None, site=None, serial=None):
    return _get_discovery_options_cached(
        auth_config["url"],
        auth_config["token"],
        auth_config["org"],
        auth_config["bucket"],
        level,
        parent,
        site,
        serial,
    )


def run_analysis_discovery(
    auth_config,
    client,
    site,
    devices,
    range_flux="7d",
    default_price=None,
    callback_status=None,
    serial=None,
    debug_mode=False,
    start_dt=None,
    end_dt=None,
    max_workers=4,
    force_recalculate=False,
):
    effective_price, _pricing_meta = resolve_energy_price(
        tenant=auth_config.get("tenant_alias") or auth_config.get("org"),
        client=client,
        site=site,
        serial=serial,
        override_price=default_price,
    )

    cache_key = json.dumps(
        {
            "tenant": auth_config.get("org"),
            "bucket": auth_config.get("bucket"),
            "client": client,
            "site": site,
            "serial": serial,
            "range_flux": range_flux,
            "devices": list(devices),
            "price": effective_price,
            "start_dt": start_dt,
            "end_dt": end_dt,
        },
        sort_keys=True,
        default=str,
    )

    state = _runtime_state()
    analysis_cache = state.setdefault("analysis_cache", {})
    if not force_recalculate and cache_key in analysis_cache:
        cached = analysis_cache[cache_key]
        if callback_status:
            callback_status("Usando resultado en caché...", 1.0)
        return cached.get("pdf")

    started_at = time.perf_counter()
    pdf_path = generate_report_pdf(
        auth_config=auth_config,
        client=client,
        site=site,
        devices=devices,
        range_flux=range_flux,
        price=effective_price,
        serial=serial,
        start_dt=start_dt,
        end_dt=end_dt,
        debug_mode=debug_mode,
        callback_status=callback_status,
        max_workers=max_workers,
    )

    timings = {
        "discovery_init": time.perf_counter() - started_at,
        "cached": False,
    }
    state["last_analysis_timings"] = timings
    analysis_cache[cache_key] = {"pdf": pdf_path, "timings": timings, "cached_at": time.time()}
    return pdf_path
