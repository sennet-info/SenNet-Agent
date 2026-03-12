import os
import time
import hashlib
import re
from datetime import timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd

from modules.analyzer import Analyzer
from modules.pdf_generator import PDFComposer
from modules.report_range import split_range_by_month, to_flux_range
from modules.visualizer import Visualizer

from core.discovery import _get_data_fetcher

MONTH_NAMES_ES = {
    1: "ENERO",
    2: "FEBRERO",
    3: "MARZO",
    4: "ABRIL",
    5: "MAYO",
    6: "JUNIO",
    7: "JULIO",
    8: "AGOSTO",
    9: "SEPTIEMBRE",
    10: "OCTUBRE",
    11: "NOVIEMBRE",
    12: "DICIEMBRE",
}


def _month_section_title(site, period_start, period_end, global_end):
    title = f"{MONTH_NAMES_ES.get(period_start.month, period_start.strftime('%B').upper())} {period_start.year}"
    if period_end == global_end:
        month_days = period_start.days_in_month
        full_month_end = period_start.replace(day=month_days, hour=23, minute=59, second=59, microsecond=999999)
        if period_end <= full_month_end:
            title = f"{title} (hasta hoy)"
    return f"{site} - {title}"


def generate_report_pdf(
    auth_config,
    client,
    site,
    devices,
    range_flux,
    price,
    serial=None,
    start_dt=None,
    end_dt=None,
    debug_mode=False,
    callback_status=None,
    max_workers=4,
    collect_debug=False,
    debug_sample_n=10,
    force_recalculate=False,
    range_mode=None,
    range_label=None,
):
    total_started = time.perf_counter()
    discovery_started = time.perf_counter()
    fetcher = _get_data_fetcher(auth_config["url"], auth_config["token"], auth_config["org"])

    debug_queries = []
    if collect_debug:
        fetcher.set_debug_query_recorder(lambda query, metadata: debug_queries.append({"query": query, "metadata": metadata}))

    if start_dt and end_dt:
        range_flux = to_flux_range(start_dt, end_dt)

    resolved_start = pd.Timestamp(start_dt).isoformat() if start_dt else None
    resolved_end = pd.Timestamp(end_dt).isoformat() if end_dt else None
    if start_dt and end_dt:
        tz_value = pd.Timestamp(start_dt).tzinfo
    else:
        tz_value = timezone.utc

    discovery_elapsed = time.perf_counter() - discovery_started

    output_dir = os.path.abspath("output")
    os.makedirs(output_dir, exist_ok=True)

    section_title = f"{site} - {range_label}" if range_label else f"{site} (V51)"
    periods = [{"range_flux": range_flux, "section": section_title}]
    if start_dt and end_dt:
        monthly_periods = split_range_by_month(start_dt, end_dt)
        if len(monthly_periods) > 1:
            periods = []
            global_end = pd.Timestamp(end_dt)
            for period in monthly_periods:
                p_start = pd.Timestamp(period["start"])
                p_end = pd.Timestamp(period["end"])
                periods.append(
                    {
                        "range_flux": to_flux_range(period["start"], period["end"]),
                        "section": _month_section_title(site, p_start, p_end, global_end),
                    }
                )

    final_report_data = {period["section"]: {} for period in periods}
    timings = {
        "discovery": discovery_elapsed,
        "fetch": 0.0,
        "charts": 0.0,
        "pdf": 0.0,
        "total": 0.0,
    }
    stats_by_series = {}
    sample_rows = {}
    warnings = []
    processed_devices = []
    devices_with_kpis = set()
    devices_without_data = set()
    device_debug = {}


    def _new_device_debug(device_name):
        return {
            "device": device_name,
            "daily_queried": False,
            "raw_queried": False,
            "daily_rows": 0,
            "raw_rows": 0,
            "periods": [],
            "generated_kpis": 0,
            "generated_kpis_count": 0,
            "generated_kpis_keys": [],
            "used_in_pdf": False,
            "discard_reason": None,
            "energy_columns_detected": [],
            "energy_column_selected": None,
            "total_energy_computed": None,
            "price_input": None,
            "price_input_to_analyzer": None,
            "price_used_in_analyzer": None,
            "cost_computed": None,
            "computed_cost": None,
            "kpi_secondary_value": None,
        }

    def _to_df(frame):
        if isinstance(frame, list):
            if not frame:
                return pd.DataFrame()
            return pd.concat(frame, ignore_index=True)
        return frame if isinstance(frame, pd.DataFrame) else pd.DataFrame()

    def _safe_iso(value):
        if value is None or pd.isna(value):
            return None
        ts = pd.Timestamp(value)
        return ts.isoformat()

    def _series_name(device_name, column_name):
        return f"{device_name}:{column_name}"

    def _collect_series_stats(device_name, df):
        clean_df = _to_df(df)
        if clean_df.empty:
            return
        time_col = "_time" if "_time" in clean_df.columns else None
        if not time_col:
            return
        for column in clean_df.columns:
            if column.startswith("result") or column.startswith("table") or column in {"_time", "_start", "_stop", "_measurement", "device", "client", "site_name", "SerialNumber"}:
                continue
            numeric_series = pd.to_numeric(clean_df[column], errors="coerce").dropna()
            if numeric_series.empty:
                continue
            mask = pd.to_numeric(clean_df[column], errors="coerce").notna()
            filtered = clean_df.loc[mask, [time_col, column]].copy()
            if filtered.empty:
                continue
            key = _series_name(device_name, column)
            points = int(len(filtered))
            first_ts = _safe_iso(filtered[time_col].min())
            last_ts = _safe_iso(filtered[time_col].max())
            previous = stats_by_series.get(key)
            if previous:
                points += previous["points"]
                first_ts = min(v for v in [first_ts, previous["first_ts"]] if v)
                last_ts = max(v for v in [last_ts, previous["last_ts"]] if v)
            stats_by_series[key] = {
                "device": device_name,
                "series": column,
                "points": points,
                "first_ts": first_ts,
                "last_ts": last_ts,
            }
            if key not in sample_rows:
                sample_rows[key] = [
                    {"ts": _safe_iso(row[time_col]), "value": float(row[column])}
                    for _, row in filtered.head(max(1, debug_sample_n)).iterrows()
                ]

    def _process_device_period(dev_name, period):
        section_name = period["section"]
        period_start = time.perf_counter()
        df_daily = _to_df(fetcher.get_data_daily(
            auth_config["bucket"], dev_name, period["range_flux"], client=client, site=site, serial=serial
        ))
        df_raw = _to_df(fetcher.get_data_raw(
            auth_config["bucket"], dev_name, period["range_flux"], client=client, site=site, serial=serial
        ))
        fetch_elapsed = time.perf_counter() - period_start

        analysis_elapsed = 0.0
        kpis = []
        energy_columns_detected = [
            c for c in df_daily.columns
            if isinstance(c, str) and any(k in c for k in ['ENEact', 'active_energy', 'm3', 'pulse', 'volumen'])
        ]
        energy_column_selected = Analyzer.select_primary_energy_column(energy_columns_detected)
        has_data = not df_daily.empty or not df_raw.empty
        if has_data:
            analysis_start = time.perf_counter()
            kpis = Analyzer.analyze_device_dual(df_daily, df_raw, dev_name, price) or []
            analysis_elapsed = time.perf_counter() - analysis_start

        computed_cost = None
        total_energy_computed = None
        kpi_secondary_value = None
        price_used_in_analyzer = None
        cost_computed = None
        price_input = price
        energy_kpi = next((item for item in kpis if item.get("type") == "energy"), None)
        if energy_kpi:
            kpi_secondary_value = energy_kpi.get("secondary_value")
            if isinstance(energy_kpi.get("energy_columns_detected"), list):
                energy_columns_detected = energy_kpi.get("energy_columns_detected")
            energy_column_selected = energy_kpi.get("energy_column_selected", energy_column_selected)
            total_energy_computed = energy_kpi.get("total_energy_computed")
            price_input = energy_kpi.get("price_input", price)
            cost_computed = energy_kpi.get("cost_computed")
            numeric_cost = re.findall(r"[-+]?\d*\.?\d+", str(kpi_secondary_value or ""))
            if numeric_cost:
                try:
                    computed_cost = float(numeric_cost[0])
                except ValueError:
                    computed_cost = None
            main_val = str(energy_kpi.get("main_value", ""))
            main_num = re.findall(r"[-+]?\d*\.?\d+", main_val)
            if main_num:
                try:
                    total_energy = float(main_num[0])
                    if total_energy > 0 and computed_cost is not None:
                        price_used_in_analyzer = computed_cost / total_energy
                except ValueError:
                    price_used_in_analyzer = None

        return {
            "device": dev_name,
            "section": section_name,
            "kpis": kpis,
            "has_data": has_data,
            "fetch_elapsed": fetch_elapsed,
            "analysis_elapsed": analysis_elapsed,
            "df_daily": df_daily,
            "df_raw": df_raw,
            "daily_rows": int(len(df_daily.index)),
            "raw_rows": int(len(df_raw.index)),
            "computed_cost": computed_cost,
            "cost_computed": cost_computed,
            "kpi_secondary_value": kpi_secondary_value,
            "energy_columns_detected": energy_columns_detected,
            "energy_column_selected": energy_column_selected,
            "total_energy_computed": total_energy_computed,
            "price_input": price_input,
            "price_input_to_analyzer": price,
            "price_used_in_analyzer": price_used_in_analyzer,
        }

    def _register_result(result, dev_name):
        timings["fetch"] += result["fetch_elapsed"]
        if result["device"] not in processed_devices:
            processed_devices.append(result["device"])

        device_entry = device_debug.setdefault(result["device"], _new_device_debug(result["device"]))
        device_entry["daily_queried"] = True
        device_entry["raw_queried"] = True
        device_entry["daily_rows"] += result["daily_rows"]
        device_entry["raw_rows"] += result["raw_rows"]
        device_entry["price_input_to_analyzer"] = result["price_input_to_analyzer"]
        device_entry["price_input"] = result["price_input"]
        device_entry["price_used_in_analyzer"] = result["price_used_in_analyzer"]
        device_entry["cost_computed"] = result["cost_computed"]
        device_entry["computed_cost"] = result["computed_cost"]
        device_entry["kpi_secondary_value"] = result["kpi_secondary_value"]
        device_entry["energy_columns_detected"] = result["energy_columns_detected"]
        device_entry["energy_column_selected"] = result["energy_column_selected"]
        device_entry["total_energy_computed"] = result["total_energy_computed"]
        device_entry["periods"].append({
            "section": result["section"],
            "daily_rows": result["daily_rows"],
            "raw_rows": result["raw_rows"],
            "generated_kpis": len(result["kpis"]),
        })

        _collect_series_stats(result["device"], result["df_daily"])
        _collect_series_stats(result["device"], result["df_raw"])

        if result["kpis"]:
            devices_with_kpis.add(dev_name)
            device_entry["generated_kpis"] += len(result["kpis"])
            device_entry["generated_kpis_count"] = device_entry["generated_kpis"]
            device_entry["used_in_pdf"] = True
            for kpi in result["kpis"]:
                key = f"{dev_name} {kpi.get('suffix_name', '')}".strip()
                if key not in device_entry["generated_kpis_keys"]:
                    device_entry["generated_kpis_keys"].append(key)
                final_report_data[result["section"]][key] = kpi
        else:
            if not result.get("has_data"):
                devices_without_data.add(dev_name)
                device_entry["discard_reason"] = "no_data_for_filters"
        if not result["kpis"] and len(periods) > 1:
            final_report_data[result["section"]][f"{dev_name} (Resumen)"] = {
                "main_value": "Sin datos para este periodo",
                "secondary_value": "",
                "label_main": "Estado",
                "label_sec": "",
            }

    work = [(dev_name, period) for dev_name in devices for period in periods]
    total = max(len(work), 1)
    processed = 0

    if debug_mode:
        for dev_name, period in work:
            processed += 1
            if callback_status:
                callback_status(f"Analizando: {dev_name}", processed / total)
            try:
                result = _process_device_period(dev_name, period)
                _register_result(result, dev_name)
            except Exception as exc:
                device_entry = device_debug.setdefault(dev_name, _new_device_debug(dev_name))
                device_entry["discard_reason"] = f"processing_error: {exc}"
                warnings.append(f"Error analizando {dev_name}: {exc}")
                print(f"Error analizando {dev_name}: {exc}")
    else:
        worker_count = max(1, min(int(max_workers), len(work))) if work else 1
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {executor.submit(_process_device_period, dev_name, period): (dev_name, period) for dev_name, period in work}
            for future in as_completed(futures):
                dev_name, period = futures[future]
                processed += 1
                if callback_status:
                    callback_status(f"Analizando: {dev_name}", processed / total)
                try:
                    result = future.result()
                    _register_result(result, dev_name)
                except Exception as exc:
                    device_entry = device_debug.setdefault(dev_name, _new_device_debug(dev_name))
                    device_entry["discard_reason"] = f"processing_error: {exc}"
                    warnings.append(f"Error analizando {dev_name}: {exc}")
                    print(f"Error analizando {dev_name}: {exc}")

    for dev_name in devices:
        device_entry = device_debug.setdefault(dev_name, _new_device_debug(dev_name))
        if not device_entry.get("used_in_pdf") and not device_entry.get("discard_reason"):
            if device_entry.get("daily_rows", 0) == 0 and device_entry.get("raw_rows", 0) == 0:
                device_entry["discard_reason"] = "no_data_for_filters"
            else:
                device_entry["discard_reason"] = "no_kpis_generated"

    if callback_status:
        callback_status("Generando PDF...", 1.0)

    charts_started = time.perf_counter()
    for section_data in final_report_data.values():
        for kpi_data in section_data.values():
            if "chart_data" in kpi_data and kpi_data["chart_data"]:
                chart_type = kpi_data.get("chart_type", "bar")
                color = kpi_data.get("chart_color", "#D32F2F")
                title = kpi_data.get("title_chart", "")
                img = (
                    Visualizer.create_line_chart(kpi_data["chart_data"], color, title)
                    if chart_type == "line"
                    else Visualizer.create_bar_chart(kpi_data["chart_data"], color, title)
                )
                if img:
                    kpi_data["chart_img_1"] = img

            if "chart_profile" in kpi_data and kpi_data["chart_profile"]:
                img_prof = Visualizer.create_hourly_profile(kpi_data["chart_profile"])
                if img_prof:
                    kpi_data["chart_img_2"] = img_prof
    timings["charts"] = time.perf_counter() - charts_started

    if not any(section for section in final_report_data.values()):
        fetcher.set_debug_query_recorder(None)
        return (None, {}) if collect_debug else None

    try:
        pdf_started = time.perf_counter()
        pdf_path = PDFComposer.build_report(f"{client}_{site}", final_report_data, output_dir)
        timings["pdf"] = time.perf_counter() - pdf_started
        timings["total"] = time.perf_counter() - total_started

        debug_payload = {}
        if collect_debug:
            query_text = "\n\n".join(item["query"].strip() for item in debug_queries)
            snippet_lines = query_text.splitlines()[:30]
            snippet = "\n".join(snippet_lines)
            snippet = snippet.encode("utf-8")[:2048].decode("utf-8", errors="ignore")
            total_points = sum(item["points"] for item in stats_by_series.values())
            all_first = [item.get("first_ts") for item in stats_by_series.values() if item.get("first_ts")]
            all_last = [item.get("last_ts") for item in stats_by_series.values() if item.get("last_ts")]
            coverage_start = min(all_first) if all_first else None
            coverage_end = max(all_last) if all_last else None
            if resolved_start and coverage_start and coverage_start > resolved_start:
                warnings.append("La cobertura real empieza después del inicio solicitado")
            if resolved_end and coverage_end and coverage_end < resolved_end:
                warnings.append("La cobertura real termina antes del fin solicitado")
            final_report_data_summary = {
                "sections": list(final_report_data.keys()),
                "kpis_count_by_section": {section: len(items) for section, items in final_report_data.items()},
                "keys_by_section": {section: list(items.keys()) for section, items in final_report_data.items()},
            }

            debug_payload = {
                "inputs": {
                    "client": client,
                    "site": site,
                    "serial": serial,
                    "devices": devices,
                    "devices_processed": processed_devices,
                    "devices_with_kpis": sorted(devices_with_kpis),
                    "devices_without_data": sorted(devices_without_data),
                    "range_flux": range_flux,
                    "price": price,
                    "price_applied_kwh": price,
                    "price_used_in_pdf": price,
                    "max_workers": max_workers,
                    "force_recalculate": force_recalculate,
                },
                "resolved_range": {
                    "range_mode": range_mode,
                    "range_label": range_label,
                    "start": resolved_start,
                    "stop": resolved_end,
                    "range_flux": range_flux,
                    "timezone": str(tz_value) if tz_value else "UTC",
                },
                "coverage": {
                    "data_start": coverage_start,
                    "data_end": coverage_end,
                    "matches_request": bool(coverage_start and coverage_end and resolved_start and resolved_end and coverage_start <= resolved_start and coverage_end >= resolved_end),
                },
                "query_proof": {
                    "sha256": hashlib.sha256(query_text.encode("utf-8")).hexdigest() if query_text else None,
                    "snippet": snippet,
                },
                "data_sources": {
                    "engine": "influxdb",
                    "url": auth_config.get("url"),
                    "org": auth_config.get("org"),
                    "bucket": auth_config.get("bucket"),
                    "query_trace": query_trace,
                },
                "stats": {
                    "total_series": len(stats_by_series),
                    "total_points": total_points,
                    "series": list(stats_by_series.values()),
                },
                "sample_rows": sample_rows,
                "final_report_data_summary": final_report_data_summary,
                "timings_ms": {key: int(value * 1000) for key, value in timings.items()},
                "device_debug": device_debug,
                "warnings": warnings,
            }

        fetcher.set_debug_query_recorder(None)
        return (pdf_path, debug_payload) if collect_debug else pdf_path
    except Exception as exc:
        print(f"Error PDF: {exc}")
        fetcher.set_debug_query_recorder(None)
        return (None, {}) if collect_debug else None
