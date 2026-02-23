import pandas as pd
import os
import json

class Analyzer:
    @staticmethod
    def load_roles():
        try:
            if os.path.exists('device_roles.json'):
                with open('device_roles.json', 'r') as f: return json.load(f)
        except: pass
        return {}

    @staticmethod
    def analyze_device_dual(df_daily, df_raw, alias, price_kwh=0.15):
        kpis = []
        roles = Analyzer.load_roles()

        # --- 1. ENERGIA / CONSUMOS ---
        try:
            df_cons = pd.DataFrame()
            if not df_daily.empty:
                df_cons = df_daily.copy()
                if '_time' in df_cons.columns: df_cons = df_cons.set_index('_time')
                if not pd.api.types.is_datetime64_any_dtype(df_cons.index): df_cons.index = pd.to_datetime(df_cons.index)

            cols_acc = [c for c in df_cons.columns if any(k in c for k in ['ENEact', 'active_energy', 'm3', 'pulse', 'volumen'])]

            # Si no hay daily, fallback a raw (Logica V47)
            if not cols_acc and not df_raw.empty:
                 df_r = df_raw.copy()
                 if '_time' in df_r.columns: df_r = df_r.set_index('_time')
                 if not pd.api.types.is_datetime64_any_dtype(df_r.index): df_r.index = pd.to_datetime(df_r.index)
                 acc_raw = [c for c in df_r.columns if any(k in c for k in ['ENEact', 'm3', 'pulse', 'in', 'out', 'personas', 'aforo'])]
                 if acc_raw:
                     c = acc_raw[0]
                     daily = df_r[c].resample('D').max() - df_r[c].resample('D').min()
                     if daily.sum() == 0: daily = df_r[c].resample('D').sum()
                     total = daily.sum()
                     if total > 0:
                         chart = {}
                         for t, v in daily.items():
                             if v > 0: chart[t.strftime('%Y-%m-%d')] = round(v, 1)
                         unit = "Unids"
                         if "m3" in c: unit = "m3"
                         elif "ENE" in c: unit = "kWh"

                         # Perfil desde raw (directo)
                         prof_data = {}
                         try:
                             h = df_r[c].resample('h').max() - df_r[c].resample('h').min()
                             if h.sum()==0: h = df_r[c].resample('h').last().diff()
                             h = h.fillna(0).clip(lower=0)
                             if h.sum() > 0:
                                 prof = h.groupby(h.index.hour).mean()
                                 prof_data = {f"{k}h": round(v, 2) for k, v in prof.items()}
                         except: pass

                         kpis.append({
                            "title": f"{alias} ({c})",
                            "title_chart": f"Consumo ({total:.0f} {unit})",
                            "main_value": f"{int(total)} {unit}",
                            "sub_value": "ACUMULADO",
                            "secondary_value": "",
                            "chart_data": chart,
                            "chart_type": "bar",
                            "chart_color": "#D32F2F" if unit=="kWh" else "#F59E0B",
                            "chart_profile": prof_data,
                            "type": "energy",
                            "suffix_name": f"({c})"
                         })

            elif cols_acc:
                target = cols_acc[0]
                daily = df_cons[target].fillna(0)
                total = daily.sum()
                cost = total * price_kwh
                chart = {}
                for t, v in daily.items():
                    if v > 0: chart[t.strftime('%Y-%m-%d')] = round(v, 1)

                # --- PERFIL INTELIGENTE ---
                # Buscamos en raw la columna que mas se parezca al target o que sea Energia
                prof_data = {}
                try:
                    if not df_raw.empty:
                        df_r = df_raw.copy()
                        if '_time' in df_r.columns: df_r = df_r.set_index('_time')
                        if not pd.api.types.is_datetime64_any_dtype(df_r.index): df_r.index = pd.to_datetime(df_r.index)

                        # Intento 1: Nombre exacto
                        raw_candidates = [c for c in df_r.columns if target in c]
                        # Intento 2: Cualquier energia
                        if not raw_candidates: raw_candidates = [c for c in df_r.columns if 'ENE' in c or 'active' in c]

                        if raw_candidates:
                            rc = raw_candidates[0]
                            # Calculo Horario
                            h = df_r[rc].resample('h').max() - df_r[rc].resample('h').min()
                            # Fallback diff
                            if h.sum() == 0: h = df_r[rc].resample('h').last().diff()

                            h = h.fillna(0).clip(lower=0)
                            if h.sum() > 0:
                                prof = h.groupby(h.index.hour).mean()
                                prof_data = {f"{k}h": round(v, 2) for k, v in prof.items()}
                except: pass

                # Fallback Plano (Solo si fallo todo lo anterior)
                if not prof_data:
                    avg = total/24 if total > 0 else 0
                    prof_data = {f"{h}h": round(avg, 2) for h in range(24)}

                kpis.append({
                    "title": f"{alias} (Energía)",
                    "title_chart": f"Consumo ({total:.0f} kWh)",
                    "main_value": f"{int(total)} kWh",
                    "sub_value": "CONSUMO",
                    "secondary_value": f"{cost:.2f} €",
                    "chart_data": chart,
                    "chart_type": "bar",
                    "chart_color": "#D32F2F",
                    "chart_profile": prof_data,
                    "type": "energy",
                    "suffix_name": "(Energía)"
                })
        except: pass

        # --- 2. SENSORES AMBIENTALES (Igual que V47) ---
        try:
            if not df_raw.empty:
                df_r = df_raw.copy()
                if '_time' in df_r.columns: df_r = df_r.set_index('_time')
                if not pd.api.types.is_datetime64_any_dtype(df_r.index): df_r.index = pd.to_datetime(df_r.index)

                sensor_keywords = ['TEMP', 'HUM', 'CO2', 'PRES', 'Temp', 'Humi', 'ppm', 'degC', 'PM1', 'PM2.5', 'PM10', 'ug/m3', 'particulas']
                cols_sensor = [c for c in df_r.columns if any(k in c for k in sensor_keywords)]

                for c in cols_sensor:
                    try:
                        d_avg = df_r[c].resample('D').mean().fillna(0)
                        val_avg = d_avg.mean()
                        val_min = df_r[c].min()
                        val_max = df_r[c].max()

                        if val_avg > 0:
                             chart_s = {}
                             for t, v in d_avg.items():
                                 chart_s[t.strftime('%Y-%m-%d')] = round(v, 1)

                             unit_s = ""
                             color_s = "#1976D2"
                             if "TEMP" in c.upper():
                                 unit_s = "ºC"; color_s = "#E53935"
                             elif "HUM" in c.upper():
                                 unit_s = "%"; color_s = "#039BE5"
                             elif "CO2" in c.upper():
                                 unit_s = "ppm"; color_s = "#546E7A"
                             elif "PM" in c.upper():
                                 unit_s = "µg/m³"; color_s = "#8E24AA"
                             elif "PRES" in c.upper():
                                 unit_s = "hPa"; color_s = "#43A047"

                             kpis.append({
                                "title": f"{alias} ({c})",
                                "main_value": f"{val_avg:.1f} {unit_s}",
                                "sub_value": "PROMEDIO",
                                "secondary_value": f"Min: {val_min:.0f} | Max: {val_max:.0f}",
                                "secondary_label": "RANGO",
                                "chart_data": chart_s,
                                "chart_type": "line",
                                "chart_color": color_s,
                                "type": "sensor",
                                "suffix_name": f"({c})"
                             })
                    except: continue
        except: pass

        return kpis
    @staticmethod
    def load_roles(): return {}
