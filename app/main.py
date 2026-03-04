import os
import streamlit as st
import pandas as pd
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from modules.db_connector import DataFetcher
from modules.analyzer import Analyzer
from modules.visualizer import Visualizer
from modules.report_range import split_range_by_month, to_flux_range

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


# Configuración PDF
try:
    from modules.pdf_generator import PDFComposer
except ImportError:
    class PDFComposer:
         @staticmethod
         def build_report(name, data, out_path): return None


def _month_section_title(site, period_start, period_end, global_end):
    title = f"{MONTH_NAMES_ES.get(period_start.month, period_start.strftime('%B').upper())} {period_start.year}"
    if period_end == global_end:
        month_days = period_start.days_in_month
        full_month_end = period_start.replace(day=month_days, hour=23, minute=59, second=59, microsecond=999999)
        if period_end <= full_month_end:
            title = f"{title} (hasta hoy)"
    return f"{site} - {title}"


_FALLBACK_RUNTIME_STATE = {}


def _runtime_state():
    try:
        return st.session_state
    except Exception:
        return _FALLBACK_RUNTIME_STATE


@st.cache_resource(show_spinner=False)
def _get_data_fetcher(url, token, org):
    return DataFetcher(url, token, org)


@st.cache_data(ttl=600, show_spinner=False)
def _get_discovery_options_cached(url, token, org, bucket, level, parent, site, serial):
    fetcher = _get_data_fetcher(url, token, org)
    if level == "clients":
        return fetcher.get_clients(bucket)
    if level == "sites":
        return fetcher.get_sites(bucket, parent)
    if level == "serials":
        return fetcher.get_serials(bucket, parent, site)
    if level == "devices":
        return fetcher.get_devices(bucket, parent, site, serial=serial)
    return []


def get_discovery_options(auth_config, level, parent=None, site=None, serial=None):
    return _get_discovery_options_cached(
        auth_config['url'],
        auth_config['token'],
        auth_config['org'],
        auth_config['bucket'],
        level,
        parent,
        site,
        serial,
    )


def run_analysis_discovery(auth_config, client, site, devices, range_flux="7d", default_price=0.14, callback_status=None, serial=None, debug_mode=False, start_dt=None, end_dt=None, max_workers=4, force_recalculate=False):
    fetcher = _get_data_fetcher(auth_config['url'], auth_config['token'], auth_config['org'])
    timings = {
        "discovery_init": 0.0,
        "fetch_total": 0.0,
        "analysis_total": 0.0,
        "charts_total": 0.0,
        "pdf_total": 0.0,
        "device_details": {},
    }
    started_at = time.perf_counter()

    if start_dt and end_dt:
        range_flux = to_flux_range(start_dt, end_dt)
    os.makedirs('output', exist_ok=True)

    periods = [{"range_flux": range_flux, "section": f"{site} (V51)"}]
    if start_dt and end_dt:
        monthly_periods = split_range_by_month(start_dt, end_dt)
        if len(monthly_periods) > 1:
            periods = []
            global_end = pd.Timestamp(end_dt)
            for period in monthly_periods:
                p_start = pd.Timestamp(period["start"])
                p_end = pd.Timestamp(period["end"])
                periods.append({
                    "range_flux": to_flux_range(period["start"], period["end"]),
                    "section": _month_section_title(site, p_start, p_end, global_end),
                })

    cache_key = json.dumps({
        "tenant": auth_config.get("org"),
        "bucket": auth_config.get("bucket"),
        "client": client,
        "site": site,
        "serial": serial,
        "range_flux": range_flux,
        "devices": list(devices),
        "price": default_price,
        "periods": periods,
    }, sort_keys=True, default=str)
    state = _runtime_state()
    analysis_cache = state.setdefault("analysis_cache", {})
    if not force_recalculate and cache_key in analysis_cache:
        cached = analysis_cache[cache_key]
        state["last_analysis_timings"] = cached.get("timings", {})
        if callback_status:
            callback_status("Usando resultado en caché...", 1.0)
        return cached.get("pdf")

    final_report_data = {period["section"]: {} for period in periods}

    def _process_device_period(dev_name, period):
        section_name = period["section"]
        period_start = time.perf_counter()
        df_daily = fetcher.get_data_daily(auth_config['bucket'], dev_name, period["range_flux"], client=client, site=site, serial=serial)
        df_raw = fetcher.get_data_raw(auth_config['bucket'], dev_name, period["range_flux"], client=client, site=site, serial=serial)
        fetch_elapsed = time.perf_counter() - period_start

        analysis_elapsed = 0.0
        kpis = []
        if not df_daily.empty or not df_raw.empty:
            analysis_start = time.perf_counter()
            kpis = Analyzer.analyze_device_dual(df_daily, df_raw, dev_name, default_price) or []
            analysis_elapsed = time.perf_counter() - analysis_start

        return {
            "device": dev_name,
            "section": section_name,
            "df_daily": df_daily,
            "df_raw": df_raw,
            "kpis": kpis,
            "fetch_elapsed": fetch_elapsed,
            "analysis_elapsed": analysis_elapsed,
        }

    work = [(dev_name, period) for dev_name in devices for period in periods]
    total = max(len(work), 1)
    processed = 0

    if debug_mode:
        # Mantener salida detallada estable en modo debug.
        for dev_name, period in work:
            processed += 1
            if callback_status:
                callback_status(f"Analizando: {dev_name}", processed / total)
            try:
                result = _process_device_period(dev_name, period)
                timings["fetch_total"] += result["fetch_elapsed"]
                timings["analysis_total"] += result["analysis_elapsed"]
                timings["device_details"][f"{dev_name}|{period['section']}"] = {
                    "fetch_s": round(result["fetch_elapsed"], 3),
                    "analyze_s": round(result["analysis_elapsed"], 3),
                }
                section_name = result["section"]
                df_daily = result["df_daily"]
                df_raw = result["df_raw"]

                if debug_mode and callback_status:
                    st.markdown("---")
                    st.markdown(f"### 🔍 Debug: **{dev_name}** ({section_name})")

                    if not df_daily.empty:
                        st.markdown("#### 📅 Datos Diarios (Acumulado)")
                        df_display = df_daily.reset_index()
                        for col in df_display.columns:
                            if pd.api.types.is_datetime64_any_dtype(df_display[col]):
                                try: df_display[col] = df_display[col].dt.strftime('%Y-%m-%d %H:%M:%S')
                                except: pass
                        st.dataframe(df_display, use_container_width=True)
                    else:
                        st.warning("⚠️ No hay datos diarios disponibles.")

                    if not df_daily.empty:
                        st.markdown("#### ∑ Resumen Total (Todas las variables)")
                        resumen = df_daily.select_dtypes(include=['number']).sum().to_frame(name="Total Acumulado")
                        resumen['Coste Est. (€)'] = resumen['Total Acumulado'] * default_price
                        st.table(resumen.style.format("{:.2f}"))
                    elif not df_raw.empty:
                        st.markdown("#### ∑ Resumen Total (Desde Raw)")
                        resumen = df_raw.select_dtypes(include=['number']).sum().to_frame(name="Total Raw")
                        st.table(resumen)

                    with st.expander("Ver Datos Crudos (Detalle completo)"):
                        if not df_raw.empty:
                            df_raw_display = df_raw.reset_index()
                            for col in df_raw_display.columns:
                                if pd.api.types.is_datetime64_any_dtype(df_raw_display[col]):
                                    try: df_raw_display[col] = df_raw_display[col].dt.strftime('%Y-%m-%d %H:%M:%S')
                                    except: pass
                            st.dataframe(df_raw_display.head(100), use_container_width=True)
                        else:
                            st.info("Sin datos crudos.")

                if result["kpis"]:
                    for kpi in result["kpis"]:
                        key = f"{dev_name} {kpi.get('suffix_name', '')}".strip()
                        final_report_data[section_name][key] = kpi
                elif len(periods) > 1:
                    key = f"{dev_name} (Resumen)"
                    final_report_data[section_name][key] = {
                        "main_value": "Sin datos para este periodo",
                        "secondary_value": "",
                        "label_main": "Estado",
                        "label_sec": "",
                    }

            except Exception as e:
                err = f"Error analizando {dev_name}: {str(e)}"
                print(err)
                if callback_status:
                    st.error(err)
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
                    timings["fetch_total"] += result["fetch_elapsed"]
                    timings["analysis_total"] += result["analysis_elapsed"]
                    timings["device_details"][f"{dev_name}|{period['section']}"] = {
                        "fetch_s": round(result["fetch_elapsed"], 3),
                        "analyze_s": round(result["analysis_elapsed"], 3),
                    }
                    if result["kpis"]:
                        for kpi in result["kpis"]:
                            key = f"{dev_name} {kpi.get('suffix_name', '')}".strip()
                            final_report_data[result["section"]][key] = kpi
                    elif len(periods) > 1:
                        key = f"{dev_name} (Resumen)"
                        final_report_data[result["section"]][key] = {
                            "main_value": "Sin datos para este periodo",
                            "secondary_value": "",
                            "label_main": "Estado",
                            "label_sec": "",
                        }
                except Exception as e:
                    err = f"Error analizando {dev_name}: {str(e)}"
                    print(err)

    if callback_status:
        callback_status("Generando PDF...", 1.0)
    else:
        print("   Context[Scheduler]: Generando PDF...")

    chart_start = time.perf_counter()
    for section_data in final_report_data.values():
        for kpi_data in section_data.values():
            if 'chart_data' in kpi_data and kpi_data['chart_data']:
                c_type = kpi_data.get('chart_type', 'bar'); color = kpi_data.get('chart_color', '#D32F2F'); title = kpi_data.get('title_chart', '')
                img = Visualizer.create_line_chart(kpi_data['chart_data'], color, title) if c_type == 'line' else Visualizer.create_bar_chart(kpi_data['chart_data'], color, title)
                if img: kpi_data['chart_img_1'] = img

            if 'chart_profile' in kpi_data and kpi_data['chart_profile']:
                img_prof = Visualizer.create_hourly_profile(kpi_data['chart_profile'])
                if img_prof: kpi_data['chart_img_2'] = img_prof
    timings["charts_total"] = time.perf_counter() - chart_start

    if not any(section for section in final_report_data.values()):
        return None

    try:
        pdf_start = time.perf_counter()
        from modules.pdf_generator import PDFComposer
        pdf_path = PDFComposer.build_report(f"{client}_{site}", final_report_data, os.path.abspath('output'))
        timings["pdf_total"] = time.perf_counter() - pdf_start
        timings["discovery_init"] = time.perf_counter() - started_at
        state["last_analysis_timings"] = timings
        analysis_cache[cache_key] = {"pdf": pdf_path, "timings": timings, "cached_at": time.time()}
        return pdf_path
    except Exception as e:
        if debug_mode and callback_status: st.error(f"Error PDF: {e}")
        else: print(f"Error PDF: {e}")
        return None
