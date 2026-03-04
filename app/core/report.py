import os
import time
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
):
    fetcher = _get_data_fetcher(auth_config["url"], auth_config["token"], auth_config["org"])

    if start_dt and end_dt:
        range_flux = to_flux_range(start_dt, end_dt)

    output_dir = os.path.abspath("output")
    os.makedirs(output_dir, exist_ok=True)

    periods = [{"range_flux": range_flux, "section": f"{site} (V51)"}]
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

    def _process_device_period(dev_name, period):
        section_name = period["section"]
        period_start = time.perf_counter()
        df_daily = fetcher.get_data_daily(
            auth_config["bucket"], dev_name, period["range_flux"], client=client, site=site, serial=serial
        )
        df_raw = fetcher.get_data_raw(
            auth_config["bucket"], dev_name, period["range_flux"], client=client, site=site, serial=serial
        )
        fetch_elapsed = time.perf_counter() - period_start

        analysis_elapsed = 0.0
        kpis = []
        if not df_daily.empty or not df_raw.empty:
            analysis_start = time.perf_counter()
            kpis = Analyzer.analyze_device_dual(df_daily, df_raw, dev_name, price) or []
            analysis_elapsed = time.perf_counter() - analysis_start

        return {
            "device": dev_name,
            "section": section_name,
            "kpis": kpis,
            "fetch_elapsed": fetch_elapsed,
            "analysis_elapsed": analysis_elapsed,
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
                if result["kpis"]:
                    for kpi in result["kpis"]:
                        key = f"{dev_name} {kpi.get('suffix_name', '')}".strip()
                        final_report_data[result["section"]][key] = kpi
                elif len(periods) > 1:
                    final_report_data[result["section"]][f"{dev_name} (Resumen)"] = {
                        "main_value": "Sin datos para este periodo",
                        "secondary_value": "",
                        "label_main": "Estado",
                        "label_sec": "",
                    }
            except Exception as exc:
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
                    if result["kpis"]:
                        for kpi in result["kpis"]:
                            key = f"{dev_name} {kpi.get('suffix_name', '')}".strip()
                            final_report_data[result["section"]][key] = kpi
                    elif len(periods) > 1:
                        final_report_data[result["section"]][f"{dev_name} (Resumen)"] = {
                            "main_value": "Sin datos para este periodo",
                            "secondary_value": "",
                            "label_main": "Estado",
                            "label_sec": "",
                        }
                except Exception as exc:
                    print(f"Error analizando {dev_name}: {exc}")

    if callback_status:
        callback_status("Generando PDF...", 1.0)

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

    if not any(section for section in final_report_data.values()):
        return None

    try:
        return PDFComposer.build_report(f"{client}_{site}", final_report_data, output_dir)
    except Exception as exc:
        print(f"Error PDF: {exc}")
        return None
