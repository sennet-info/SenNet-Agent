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
    1: "ENERO", 2: "FEBRERO", 3: "MARZO", 4: "ABRIL",
    5: "MAYO", 6: "JUNIO", 7: "JULIO", 8: "AGOSTO",
    9: "SEPTIEMBRE", 10: "OCTUBRE", 11: "NOVIEMBRE", 12: "DICIEMBRE",
}


def _month_section_title(site, period_start, period_end, global_end):
    title = f"{MONTH_NAMES_ES.get(period_start.month, period_start.strftime('%B').upper())} {period_start.year}"
    if period_end >= global_end:
        title = f"{title} (hasta hoy)"
    return f"{site} - {title}"


def _compute_prev_range(start_dt, end_dt, range_mode=None):
    """Calcula el rango anterior.
    - Para modos mensuales: devuelve el mes anterior completo.
    - Para N dias: mismo numero de dias justo antes.
    """
    from calendar import monthrange
    if range_mode in ("month_to_date", "previous_full_month"):
        # Mes anterior completo
        prev_month = start_dt.month - 1 if start_dt.month > 1 else 12
        prev_year  = start_dt.year if start_dt.month > 1 else start_dt.year - 1
        last_day   = monthrange(prev_year, prev_month)[1]
        import pytz
        tz = start_dt.tzinfo or pytz.UTC
        prev_start = start_dt.replace(year=prev_year, month=prev_month, day=1, hour=0, minute=0, second=0)
        prev_end   = start_dt.replace(year=prev_year, month=prev_month, day=last_day, hour=23, minute=59, second=59)
        return prev_start, prev_end
    # Default: mismo numero de dias justo antes
    delta = end_dt - start_dt
    return start_dt - delta, start_dt


def _fetch_prev_data(fetcher, auth_config, dev_name, prev_start, prev_end,
                     client, site, serial):
    """
    Consulta datos del período anterior para un dispositivo.
    Solo se llama si el usuario activó show_prev.
    Devuelve (df_daily_prev, df_raw_prev, prev_label, has_data).
    """
    try:
        prev_flux  = to_flux_range(prev_start, prev_end)
        prev_label = (
            f"{prev_start.strftime('%d/%m/%Y')} – {prev_end.strftime('%d/%m/%Y')}"
        )
        df_daily_prev = pd.DataFrame()
        df_raw_prev   = pd.DataFrame()

        try:
            r = fetcher.get_data_daily(
                auth_config["bucket"], dev_name, prev_flux,
                client=client, site=site, serial=serial,
            )
            df_daily_prev = pd.concat(r, ignore_index=True) if isinstance(r, list) and r \
                else (r if isinstance(r, pd.DataFrame) else pd.DataFrame())
        except Exception:
            pass

        try:
            r = fetcher.get_data_raw(
                auth_config["bucket"], dev_name, prev_flux,
                client=client, site=site, serial=serial,
            )
            df_raw_prev = pd.concat(r, ignore_index=True) if isinstance(r, list) and r \
                else (r if isinstance(r, pd.DataFrame) else pd.DataFrame())
        except Exception:
            pass

        has_data = not df_daily_prev.empty or not df_raw_prev.empty
        return df_daily_prev, df_raw_prev, prev_label, has_data
    except Exception:
        return pd.DataFrame(), pd.DataFrame(), "", False


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
    report_options=None,
):
    if report_options is None:
        report_options = {}
    show_prev = report_options.get("show_prev", False)

    total_started     = time.perf_counter()
    discovery_started = time.perf_counter()
    fetcher = _get_data_fetcher(
        auth_config["url"], auth_config["token"], auth_config["org"]
    )

    debug_queries = []
    if collect_debug:
        fetcher.set_debug_query_recorder(
            lambda query, metadata: debug_queries.append(
                {"query": query, "metadata": metadata}
            )
        )

    if start_dt and end_dt:
        range_flux = to_flux_range(start_dt, end_dt)

    resolved_start = pd.Timestamp(start_dt).isoformat() if start_dt else None
    resolved_end   = pd.Timestamp(end_dt).isoformat()   if end_dt   else None
    tz_value = pd.Timestamp(start_dt).tzinfo if start_dt and end_dt else timezone.utc

    discovery_elapsed = time.perf_counter() - discovery_started

    output_dir = os.path.abspath("output")
    os.makedirs(output_dir, exist_ok=True)

    section_title = f"{site} - {range_label}" if range_label else f"{site} (V51)"
    periods = [{"range_flux": range_flux, "section": section_title,
                "start": start_dt, "end": end_dt}]

    if start_dt and end_dt:
        monthly_periods = split_range_by_month(start_dt, end_dt)
        if len(monthly_periods) > 1:
            periods = []
            global_end = pd.Timestamp(end_dt)
            for period in monthly_periods:
                p_start = pd.Timestamp(period["start"])
                p_end   = pd.Timestamp(period["end"])
                periods.append({
                    "range_flux": to_flux_range(period["start"], period["end"]),
                    "section":    _month_section_title(site, p_start, p_end, global_end),
                    "start":      period["start"],
                    "end":        period["end"],
                })

    # Período anterior — solo si el usuario lo pidió
    prev_start_dt, prev_end_dt = None, None
    if show_prev and start_dt and end_dt:
        prev_start_dt, prev_end_dt = _compute_prev_range(
            pd.Timestamp(start_dt).to_pydatetime(),
            pd.Timestamp(end_dt).to_pydatetime(),
            range_mode=range_mode,
        )

    final_report_data = {period["section"]: {} for period in periods}
    timings = {"discovery": discovery_elapsed, "fetch": 0.0,
               "charts": 0.0, "pdf": 0.0, "total": 0.0}
    stats_by_series      = {}
    sample_rows          = {}
    warnings             = []
    processed_devices    = []
    devices_with_kpis    = set()
    devices_without_data = set()
    device_debug         = {}

    def _new_device_debug(device_name):
        return {
            "device": device_name,
            "daily_queried": False, "raw_queried": False,
            "daily_rows": 0, "raw_rows": 0, "periods": [],
            "generated_kpis": 0, "generated_kpis_count": 0,
            "generated_kpis_keys": [], "used_in_pdf": False,
            "discard_reason": None, "energy_columns_detected": [],
            "energy_column_selected": None, "daily_columns_detected": [],
            "raw_columns_detected": [], "total_energy_computed": None,
            "price_input": None, "price_input_to_analyzer": None,
            "price_used_in_analyzer": None, "cost_computed": None,
            "computed_cost": None, "kpi_secondary_value": None,
            "generated_kpis_detail": [], "selected_by_rule": None,
            "rejected_columns": [], "warning": None,
            "daily_points_used": 0, "first_daily_ts": None, "last_daily_ts": None,
            "prev_queried": False, "prev_has_data": False, "prev_label": None,
        }

    def _to_df(frame):
        if isinstance(frame, list):
            return pd.concat(frame, ignore_index=True) if frame else pd.DataFrame()
        return frame if isinstance(frame, pd.DataFrame) else pd.DataFrame()

    def _safe_iso(value):
        if value is None or pd.isna(value): return None
        return pd.Timestamp(value).isoformat()

    def _series_name(device_name, column_name):
        return f"{device_name}:{column_name}"

    def _collect_series_stats(device_name, df):
        clean_df = _to_df(df)
        if clean_df.empty: return
        time_col = "_time" if "_time" in clean_df.columns else None
        if not time_col: return
        for column in clean_df.columns:
            if column.startswith(("result", "table")) or column in {
                "_time", "_start", "_stop", "_measurement",
                "device", "client", "site_name", "SerialNumber",
            }:
                continue
            numeric_series = pd.to_numeric(clean_df[column], errors="coerce").dropna()
            if numeric_series.empty: continue
            mask     = pd.to_numeric(clean_df[column], errors="coerce").notna()
            filtered = clean_df.loc[mask, [time_col, column]].copy()
            if filtered.empty: continue
            key      = _series_name(device_name, column)
            points   = int(len(filtered))
            first_ts = _safe_iso(filtered[time_col].min())
            last_ts  = _safe_iso(filtered[time_col].max())
            previous = stats_by_series.get(key)
            if previous:
                points   += previous["points"]
                first_ts  = min(v for v in [first_ts, previous["first_ts"]] if v)
                last_ts   = max(v for v in [last_ts,  previous["last_ts"]]  if v)
            stats_by_series[key] = {
                "device": device_name, "series": column,
                "points": points, "first_ts": first_ts, "last_ts": last_ts,
            }
            if key not in sample_rows:
                sample_rows[key] = [
                    {"ts": _safe_iso(row[time_col]), "value": float(row[column])}
                    for _, row in filtered.head(max(1, debug_sample_n)).iterrows()
                ]

    def _process_device_period(dev_name, period):
        section_name  = period["section"]
        t0 = time.perf_counter()

        df_daily = _to_df(fetcher.get_data_daily(
            auth_config["bucket"], dev_name, period["range_flux"],
            client=client, site=site, serial=serial,
        ))
        df_raw = _to_df(fetcher.get_data_raw(
            auth_config["bucket"], dev_name, period["range_flux"],
            client=client, site=site, serial=serial,
        ))
        fetch_elapsed = time.perf_counter() - t0

        # Período anterior — solo si el usuario lo pidió
        df_daily_prev = pd.DataFrame()
        df_raw_prev   = pd.DataFrame()
        prev_label    = None
        prev_has_data = False

        if show_prev and prev_start_dt and prev_end_dt:
            df_daily_prev, df_raw_prev, prev_label, prev_has_data = _fetch_prev_data(
                fetcher, auth_config, dev_name,
                prev_start_dt, prev_end_dt,
                client, site, serial,
            )

        # Análisis
        analysis_elapsed = 0.0
        kpis = []
        energy_columns_detected = [
            c for c in df_daily.columns if isinstance(c, str)
            and any(k in c for k in ["ENEact", "active_energy", "m3", "pulse", "volumen"])
        ]
        daily_columns_detected = [c for c in df_daily.columns if isinstance(c, str)]
        raw_columns_detected   = [c for c in df_raw.columns   if isinstance(c, str)]
        energy_resolution      = Analyzer.resolve_primary_energy_column(energy_columns_detected)
        energy_column_selected = energy_resolution.get("selected_energy_column")
        has_data = not df_daily.empty or not df_raw.empty

        if has_data:
            t_a = time.perf_counter()
            kpis = Analyzer.analyze_device_dual(
                df_daily, df_raw, dev_name, price,
                df_daily_prev=df_daily_prev if prev_has_data else None,
                df_raw_prev=df_raw_prev     if prev_has_data else None,
            ) or []
            analysis_elapsed = time.perf_counter() - t_a

            # Anotar aviso en cada KPI si no hubo datos anteriores
            if show_prev and not prev_has_data and prev_label:
                for kpi in kpis:
                    kpi["prev_no_data_warning"] = (
                        f"Sin datos para el período anterior ({prev_label})"
                    )
                    kpi["prev_label"] = prev_label
            elif show_prev and prev_has_data and prev_label:
                for kpi in kpis:
                    kpi["prev_label"] = prev_label

        # Métricas de debug
        computed_cost = None; total_energy_computed = None
        kpi_secondary_value = None; price_used_in_analyzer = None
        cost_computed = None; price_input = price
        energy_kpi    = next((i for i in kpis if i.get("type") == "energy"), None)
        selected_by_rule = energy_resolution.get("selected_by_rule")
        rejected_columns = energy_resolution.get("rejected_columns", [])
        energy_warning   = energy_resolution.get("warning")

        if energy_kpi:
            kpi_secondary_value = energy_kpi.get("secondary_value")
            if isinstance(energy_kpi.get("energy_columns_detected"), list):
                energy_columns_detected = energy_kpi["energy_columns_detected"]
            energy_column_selected = energy_kpi.get("energy_column_selected", energy_column_selected)
            total_energy_computed  = energy_kpi.get("total_energy_computed")
            price_input   = energy_kpi.get("price_input", price)
            cost_computed = energy_kpi.get("cost_computed")
            selected_by_rule = energy_kpi.get("energy_selection_rule", selected_by_rule)
            rejected_columns = energy_kpi.get("energy_rejected_columns", rejected_columns)
            energy_warning   = energy_kpi.get("energy_warning", energy_warning)
            nums = re.findall(r"[-+]?\d*\.?\d+", str(kpi_secondary_value or ""))
            if nums:
                try: computed_cost = float(nums[0])
                except: pass
            main_nums = re.findall(r"[-+]?\d*\.?\d+", str(energy_kpi.get("main_value", "")))
            if main_nums:
                try:
                    te = float(main_nums[0])
                    if te > 0 and computed_cost is not None:
                        price_used_in_analyzer = computed_cost / te
                except: pass

        daily_points_used = 0; first_daily_ts = None; last_daily_ts = None
        if not df_daily.empty and "_time" in df_daily.columns:
            daily_points_used = (
                int(df_daily[energy_column_selected].notna().sum())
                if energy_column_selected in df_daily.columns
                else int(len(df_daily.index))
            )
            first_daily_ts = _safe_iso(df_daily["_time"].min())
            last_daily_ts  = _safe_iso(df_daily["_time"].max())

        local_warnings = []
        if energy_column_selected and energy_column_selected not in energy_columns_detected:
            local_warnings.append(
                f"{dev_name}: columna energética seleccionada fuera de candidatas"
            )

        return {
            "device": dev_name, "section": section_name, "kpis": kpis,
            "has_data": has_data, "fetch_elapsed": fetch_elapsed,
            "analysis_elapsed": analysis_elapsed,
            "df_daily": df_daily, "df_raw": df_raw,
            "daily_rows": int(len(df_daily.index)),
            "raw_rows":   int(len(df_raw.index)),
            "computed_cost": computed_cost, "cost_computed": cost_computed,
            "kpi_secondary_value": kpi_secondary_value,
            "energy_columns_detected": energy_columns_detected,
            "energy_column_selected":  energy_column_selected,
            "daily_columns_detected":  daily_columns_detected,
            "raw_columns_detected":    raw_columns_detected,
            "total_energy_computed":   total_energy_computed,
            "price_input": price_input, "price_input_to_analyzer": price,
            "price_used_in_analyzer":  price_used_in_analyzer,
            "selected_by_rule": selected_by_rule,
            "rejected_columns": rejected_columns,
            "warning": energy_warning,
            "daily_points_used": daily_points_used,
            "first_daily_ts": first_daily_ts, "last_daily_ts": last_daily_ts,
            "local_warnings": local_warnings,
            "prev_has_data": prev_has_data, "prev_label": prev_label,
        }

    def _register_result(result, dev_name):
        timings["fetch"] += result["fetch_elapsed"]
        if result["device"] not in processed_devices:
            processed_devices.append(result["device"])
        e = device_debug.setdefault(result["device"], _new_device_debug(result["device"]))
        e["daily_queried"] = True; e["raw_queried"] = True
        e["daily_rows"]   += result["daily_rows"]
        e["raw_rows"]     += result["raw_rows"]
        e["price_input_to_analyzer"] = result["price_input_to_analyzer"]
        e["price_input"]  = result["price_input"]
        e["price_used_in_analyzer"]  = result["price_used_in_analyzer"]
        e["cost_computed"]           = result["cost_computed"]
        e["computed_cost"]           = result["computed_cost"]
        e["kpi_secondary_value"]     = result["kpi_secondary_value"]
        e["energy_columns_detected"] = result["energy_columns_detected"]
        e["energy_column_selected"]  = result["energy_column_selected"]
        e["daily_columns_detected"]  = result["daily_columns_detected"]
        e["raw_columns_detected"]    = result["raw_columns_detected"]
        e["total_energy_computed"]   = result["total_energy_computed"]
        e["selected_by_rule"]        = result["selected_by_rule"]
        e["rejected_columns"]        = result["rejected_columns"]
        e["warning"]                 = result["warning"]
        e["daily_points_used"]       = result["daily_points_used"]
        e["first_daily_ts"]          = result["first_daily_ts"]
        e["last_daily_ts"]           = result["last_daily_ts"]
        e["prev_queried"]  = show_prev
        e["prev_has_data"] = result.get("prev_has_data", False)
        e["prev_label"]    = result.get("prev_label")
        for w in result.get("local_warnings", []): warnings.append(w)
        e["periods"].append({
            "section":    result["section"],
            "daily_rows": result["daily_rows"],
            "raw_rows":   result["raw_rows"],
            "generated_kpis": len(result["kpis"]),
        })
        _collect_series_stats(result["device"], result["df_daily"])
        _collect_series_stats(result["device"], result["df_raw"])
        if result["kpis"]:
            devices_with_kpis.add(dev_name)
            e["generated_kpis"]      += len(result["kpis"])
            e["generated_kpis_count"] = e["generated_kpis"]
            e["used_in_pdf"] = True
            for kpi in result["kpis"]:
                key = f"{dev_name} {kpi.get('suffix_name', '')}".strip()
                if key not in e["generated_kpis_keys"]:
                    e["generated_kpis_keys"].append(key)
                e["generated_kpis_detail"].append({
                    "section": result["section"], "key": key,
                    "title": kpi.get("title"), "main_value": kpi.get("main_value"),
                    "secondary_value": kpi.get("secondary_value"),
                    "label_main": kpi.get("label_main", kpi.get("sub_value")),
                    "label_sec":  kpi.get("label_sec",  kpi.get("secondary_label")),
                    "type": kpi.get("type"),
                })
                final_report_data[result["section"]][key] = kpi
        else:
            if not result.get("has_data"):
                devices_without_data.add(dev_name)
                e["discard_reason"] = "no_data_for_filters"
        if not result["kpis"] and len(periods) > 1:
            final_report_data[result["section"]][f"{dev_name} (Resumen)"] = {
                "main_value": "Sin datos para este periodo",
                "secondary_value": "", "label_main": "Estado", "label_sec": "",
            }

    # Ejecución
    work       = [(dev_name, period) for dev_name in devices for period in periods]
    total_work = max(len(work), 1)
    processed  = 0

    if debug_mode:
        for dev_name, period in work:
            processed += 1
            if callback_status:
                callback_status(f"Analizando: {dev_name}", processed / total_work)
            try:
                result = _process_device_period(dev_name, period)
                _register_result(result, dev_name)
            except Exception as exc:
                e = device_debug.setdefault(dev_name, _new_device_debug(dev_name))
                e["discard_reason"] = f"processing_error: {exc}"
                warnings.append(f"Error analizando {dev_name}: {exc}")
    else:
        worker_count = max(1, min(int(max_workers), len(work))) if work else 1
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {
                executor.submit(_process_device_period, dev_name, period): (dev_name, period)
                for dev_name, period in work
            }
            for future in as_completed(futures):
                dev_name, period = futures[future]
                processed += 1
                if callback_status:
                    callback_status(f"Analizando: {dev_name}", processed / total_work)
                try:
                    result = future.result()
                    _register_result(result, dev_name)
                except Exception as exc:
                    e = device_debug.setdefault(dev_name, _new_device_debug(dev_name))
                    e["discard_reason"] = f"processing_error: {exc}"
                    warnings.append(f"Error analizando {dev_name}: {exc}")

    for dev_name in devices:
        e = device_debug.setdefault(dev_name, _new_device_debug(dev_name))
        if not e.get("used_in_pdf") and not e.get("discard_reason"):
            e["discard_reason"] = (
                "no_data_for_filters"
                if e.get("daily_rows", 0) == 0 and e.get("raw_rows", 0) == 0
                else "no_kpis_generated"
            )

    if callback_status:
        callback_status("Generando PDF...", 1.0)

    report_items = []
    for section, section_data in final_report_data.items():
        for key, item in section_data.items():
            report_items.append({
                "section": section, "alias_or_title": key,
                "device": key.split(" (", 1)[0] if isinstance(key, str) else None,
                "metric_type": item.get("type"),
                "main_value":  item.get("main_value"),
                "secondary_value": item.get("secondary_value"),
                "source_energy_column": item.get("energy_column_selected"),
                "source_total_kwh":     item.get("total_energy_computed"),
                "source_cost":          item.get("cost_computed"),
            })

    report_resolution = {
        "sections_count": len(final_report_data),
        "items_count":    len(report_items),
        "report_items":   report_items,
    }
    timings["charts"] = 0.0

    if not any(section for section in final_report_data.values()):
        warnings.append("PDF se construiría con 0 items")
        fetcher.set_debug_query_recorder(None)
        return (None, {}) if collect_debug else None

    try:
        pdf_resolution = {
            "pdf_enabled": True, "output_path": output_dir,
            "output_filename": None,
            "report_items_rendered_count": len(report_items),
            "rendered_items": [
                {"alias": i.get("alias_or_title"), "main_value": i.get("main_value")}
                for i in report_items[:50]
            ],
            "pdf_created": False, "pdf_size_bytes": None,
        }
        pdf_started = time.perf_counter()
        pdf_path = PDFComposer.build_report(
            f"{client}_{site}", final_report_data, output_dir,
            options=report_options or {},
        )
        timings["pdf"]   = time.perf_counter() - pdf_started
        timings["total"] = time.perf_counter() - total_started

        if pdf_path:
            pdf_file = os.path.abspath(pdf_path)
            pdf_resolution["output_path"]     = pdf_file
            pdf_resolution["output_filename"] = os.path.basename(pdf_file)
            pdf_resolution["pdf_created"]     = os.path.exists(pdf_file)
            if pdf_resolution["pdf_created"]:
                pdf_resolution["pdf_size_bytes"] = os.path.getsize(pdf_file)

        debug_payload = {}
        if collect_debug:
            query_text = "\n\n".join(i["query"].strip() for i in debug_queries)
            snippet    = "\n".join(query_text.splitlines()[:30])
            snippet    = snippet.encode("utf-8")[:2048].decode("utf-8", errors="ignore")
            total_points = sum(i["points"] for i in stats_by_series.values())
            all_first = [i.get("first_ts") for i in stats_by_series.values() if i.get("first_ts")]
            all_last  = [i.get("last_ts")  for i in stats_by_series.values() if i.get("last_ts")]
            coverage_start = min(all_first) if all_first else None
            coverage_end   = max(all_last)  if all_last  else None

            energy_res = []
            for dev_name in devices:
                info = device_debug.get(dev_name, {})
                energy_res.append({
                    "device":                   dev_name,
                    "candidate_energy_columns": info.get("energy_columns_detected", []),
                    "selected_energy_column":   info.get("energy_column_selected"),
                    "selected_by_rule":         info.get("selected_by_rule"),
                    "rejected_columns":         info.get("rejected_columns", []),
                    "daily_points_used":        info.get("daily_points_used"),
                    "first_daily_ts":           info.get("first_daily_ts"),
                    "last_daily_ts":            info.get("last_daily_ts"),
                    "computed_total_kwh":       info.get("total_energy_computed"),
                    "price_used":               info.get("price_input"),
                    "computed_cost":            info.get("cost_computed"),
                    "warning":                  info.get("warning"),
                    "prev_queried":             info.get("prev_queried"),
                    "prev_has_data":            info.get("prev_has_data"),
                    "prev_label":               info.get("prev_label"),
                })

            debug_payload = {
                "inputs": {
                    "client": client, "site": site, "serial": serial,
                    "devices": devices, "devices_processed": processed_devices,
                    "devices_with_kpis":    sorted(devices_with_kpis),
                    "devices_without_data": sorted(devices_without_data),
                    "range_flux": range_flux, "price": price,
                    "price_applied_kwh": price, "price_used_in_pdf": price,
                    "max_workers": max_workers,
                    "force_recalculate": force_recalculate,
                    "report_options": report_options,
                },
                "resolved_range": {
                    "range_mode": range_mode, "range_label": range_label,
                    "start": resolved_start, "stop": resolved_end,
                    "range_flux": range_flux,
                    "timezone": str(tz_value) if tz_value else "UTC",
                },
                "coverage": {
                    "data_start": coverage_start, "data_end": coverage_end,
                    "matches_request": bool(
                        coverage_start and coverage_end
                        and resolved_start and resolved_end
                        and coverage_start <= resolved_start
                        and coverage_end   >= resolved_end
                    ),
                },
                "query_proof": {
                    "sha256": hashlib.sha256(query_text.encode()).hexdigest()
                    if query_text else None,
                    "snippet": snippet,
                },
                "data_sources": {
                    "engine": "influxdb",
                    "url": auth_config.get("url"), "org": auth_config.get("org"),
                    "bucket": auth_config.get("bucket"), "query_trace": debug_queries,
                },
                "stats": {
                    "total_series": len(stats_by_series),
                    "total_points": total_points,
                    "series": list(stats_by_series.values()),
                },
                "sample_rows":       sample_rows,
                "report_resolution": report_resolution,
                "pdf_resolution":    pdf_resolution,
                "energy_resolution": energy_res,
                "timings_ms":        {k: int(v * 1000) for k, v in timings.items()},
                "device_debug":      device_debug,
                "warnings":          warnings,
            }
            debug_payload["summary"] = {
                "devices_requested": devices,
                "devices_processed": processed_devices,
                "range_requested": {
                    "range_mode": range_mode, "range_label": range_label,
                    "start": resolved_start, "stop": resolved_end,
                },
                "coverage":          debug_payload.get("coverage", {}),
                "energy_resolution": energy_res,
                "report_resolution": report_resolution,
                "pdf_resolution":    pdf_resolution,
                "warnings":          warnings,
            }

        fetcher.set_debug_query_recorder(None)
        return (pdf_path, debug_payload) if collect_debug else pdf_path

    except Exception as exc:
        print(f"Error PDF: {exc}")
        fetcher.set_debug_query_recorder(None)
        return (None, {}) if collect_debug else None
