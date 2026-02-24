import os
import streamlit as st
import pandas as pd
import json
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


def get_discovery_options(auth_config, level, parent=None, site=None, serial=None):
    fetcher = DataFetcher(auth_config['url'], auth_config['token'], auth_config['org'])
    if level == "clients": return fetcher.get_clients(auth_config['bucket'])
    elif level == "sites": return fetcher.get_sites(auth_config['bucket'], parent)
    elif level == "serials": return fetcher.get_serials(auth_config['bucket'], parent, site)
    elif level == "devices": return fetcher.get_devices(auth_config['bucket'], parent, site, serial=serial)
    return []


def run_analysis_discovery(auth_config, client, site, devices, range_flux="7d", default_price=0.14, callback_status=None, serial=None, debug_mode=False, start_dt=None, end_dt=None):
    fetcher = DataFetcher(auth_config['url'], auth_config['token'], auth_config['org'])
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

    final_report_data = {period["section"]: {} for period in periods}
    total = len(devices)

    for i, dev_name in enumerate(devices):
        if callback_status:
            callback_status(f"Analizando: {dev_name}", (i) / total)
        else:
            print(f"   Context[Scheduler]: Procesando {dev_name} ({i+1}/{total})")

        try:
            for period in periods:
                section_name = period["section"]
                df_daily = fetcher.get_data_daily(auth_config['bucket'], dev_name, period["range_flux"], client=client, site=site, serial=serial)
                df_raw = fetcher.get_data_raw(auth_config['bucket'], dev_name, period["range_flux"], client=client, site=site, serial=serial)

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

                if not df_daily.empty or not df_raw.empty:
                    kpis = Analyzer.analyze_device_dual(df_daily, df_raw, dev_name, default_price)
                    if kpis:
                        for kpi in kpis:
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
            if debug_mode and callback_status: st.error(err)

    if callback_status:
        callback_status("Generando PDF...", 1.0)
    else:
        print("   Context[Scheduler]: Generando PDF...")

    for section_data in final_report_data.values():
        for kpi_data in section_data.values():
            if 'chart_data' in kpi_data and kpi_data['chart_data']:
                c_type = kpi_data.get('chart_type', 'bar'); color = kpi_data.get('chart_color', '#D32F2F'); title = kpi_data.get('title_chart', '')
                img = Visualizer.create_line_chart(kpi_data['chart_data'], color, title) if c_type == 'line' else Visualizer.create_bar_chart(kpi_data['chart_data'], color, title)
                if img: kpi_data['chart_img_1'] = img

            if 'chart_profile' in kpi_data and kpi_data['chart_profile']:
                img_prof = Visualizer.create_hourly_profile(kpi_data['chart_profile'])
                if img_prof: kpi_data['chart_img_2'] = img_prof

    if not any(section for section in final_report_data.values()):
        return None

    try:
        from modules.pdf_generator import PDFComposer
        return PDFComposer.build_report(f"{client}_{site}", final_report_data, os.path.abspath('output'))
    except Exception as e:
        if debug_mode and callback_status: st.error(f"Error PDF: {e}")
        else: print(f"Error PDF: {e}")
        return None
