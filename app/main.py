import os
import streamlit as st
import pandas as pd
import json
from datetime import datetime
from modules.db_connector import DataFetcher
from modules.analyzer import Analyzer
from modules.visualizer import Visualizer
from modules.report_range import to_flux_range

# Configuración PDF
try:
    from modules.pdf_generator import PDFComposer
except ImportError:
    class PDFComposer:
         @staticmethod
         def build_report(name, data, out_path): return None

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
    
    # Estructura del Informe
    final_report_data = {}      
    section_name = f"{site} (V51)"
    final_report_data[section_name] = {}

    total = len(devices)

    for i, dev_name in enumerate(devices):
        # FEEDBACK: Visual (Streamlit) o Consola (Background)
        if callback_status: 
            callback_status(f"Analizando: {dev_name}", (i)/total)
        else: 
            print(f"   Context[Scheduler]: Procesando {dev_name} ({i+1}/{total})")

        try:
            # 1. OBTENER DATOS
            df_daily = fetcher.get_data_daily(auth_config['bucket'], dev_name, range_flux, client=client, site=site, serial=serial)
            df_raw = fetcher.get_data_raw(auth_config['bucket'], dev_name, range_flux, client=client, site=site, serial=serial)

            # 2. DEBUG VISUAL UNIVERSAL (Solo si hay interfaz grafica activa)
            if debug_mode and callback_status:
                st.markdown(f"---")
                st.markdown(f"### 🔍 Debug: **{dev_name}**")
                
                # --- TABLA A: CONSUMO DIARIO (UNIVERSAL) ---
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

                # --- TABLA B: RESUMEN TOTAL (UNIVERSAL) ---
                if not df_daily.empty:
                    st.markdown("#### ∑ Resumen Total (Todas las variables)")
                    resumen = df_daily.select_dtypes(include=['number']).sum().to_frame(name="Total Acumulado")
                    resumen['Coste Est. (€)'] = resumen['Total Acumulado'] * default_price
                    st.table(resumen.style.format("{:.2f}"))
                elif not df_raw.empty:
                     st.markdown("#### ∑ Resumen Total (Desde Raw)")
                     resumen = df_raw.select_dtypes(include=['number']).sum().to_frame(name="Total Raw")
                     st.table(resumen)

                # --- TABLA C: RAW DATA EXPANDIBLE ---
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

            # 3. ANALISIS
            if not df_daily.empty or not df_raw.empty:
                kpis = Analyzer.analyze_device_dual(df_daily, df_raw, dev_name, default_price)
                if kpis:
                    for kpi in kpis:
                        key = f"{dev_name} {kpi.get('suffix_name', '')}".strip()
                        final_report_data[section_name][key] = kpi
                        
        except Exception as e:
            err = f"Error analizando {dev_name}: {str(e)}"
            print(err)
            if debug_mode and callback_status: st.error(err)

    if callback_status: 
        callback_status("Generando PDF...", 1.0)
    else:
        print("   Context[Scheduler]: Generando PDF...")
    
    # Generar Graficas
    for device_key, kpi_data in final_report_data[section_name].items():
        if 'chart_data' in kpi_data and kpi_data['chart_data']:
            c_type = kpi_data.get('chart_type', 'bar'); color = kpi_data.get('chart_color', '#D32F2F'); title = kpi_data.get('title_chart', '')
            img = Visualizer.create_line_chart(kpi_data['chart_data'], color, title) if c_type == 'line' else Visualizer.create_bar_chart(kpi_data['chart_data'], color, title)
            if img: kpi_data['chart_img_1'] = img

        if 'chart_profile' in kpi_data and kpi_data['chart_profile']:
            img_prof = Visualizer.create_hourly_profile(kpi_data['chart_profile'])
            if img_prof: kpi_data['chart_img_2'] = img_prof

    if not final_report_data[section_name]: return None
        
    try:
        from modules.pdf_generator import PDFComposer 
        return PDFComposer.build_report(f"{client}_{site}", final_report_data, os.path.abspath('output'))
    except Exception as e:
        if debug_mode and callback_status: st.error(f"Error PDF: {e}")
        else: print(f"Error PDF: {e}")
        return None
