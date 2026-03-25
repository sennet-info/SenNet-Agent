import pandas as pd
import os
import json

COMFORT_RANGES = {
    "TEMP": (18.0, 26.0), "HUM": (40.0, 70.0),
    "CO2":  (400.0, 1000.0), "PM": (0.0, 25.0), "PRES": (950.0, 1050.0),
}
SENSOR_UNITS  = {"TEMP":"ºC","HUM":"%","CO2":"ppm","PM":"µg/m³","PRES":"hPa"}
SENSOR_COLORS = {"TEMP":"#E53935","HUM":"#1565C0","CO2":"#37474F","PM":"#6A1B9A","PRES":"#2E7D32"}
SENSOR_LABELS = {"TEMP":"Temperatura","HUM":"Humedad","CO2":"CO₂","PM":"Partículas","PRES":"Presión"}

class Analyzer:

    @staticmethod
    def load_roles():
        try:
            if os.path.exists("device_roles.json"):
                with open("device_roles.json","r") as f: return json.load(f)
        except: pass
        return {}

    @staticmethod
    def resolve_primary_energy_column(columns):
        cols = [c for c in (columns or []) if isinstance(c,str)]
        priority = ["ENEact","active_energy","EP_imp","AE","AI","ENEactExpTot","ENEactpTot"]
        lower_map = {c.lower():c for c in cols}
        for name in priority:
            matched = lower_map.get(name.lower())
            if matched:
                rejected = [c for c in cols if c!=matched and c.lower() in {"eneact1","eneact2","eneact3"}]
                return {"selected_energy_column":matched,"selected_by_rule":f"priority_match:{name}",
                        "candidate_energy_columns":cols,"rejected_columns":rejected,"warning":None}
        fallback = sorted(cols)[0] if cols else None
        return {"selected_energy_column":fallback,
                "selected_by_rule":"fallback_sorted" if fallback else "no_energy_column",
                "candidate_energy_columns":cols,
                "rejected_columns":[c for c in cols if c!=fallback],
                "warning":f"Sin columna prioritaria; fallback:{fallback}" if fallback else "No hay columnas energéticas"}

    @staticmethod
    def select_primary_energy_column(columns):
        return Analyzer.resolve_primary_energy_column(columns).get("selected_energy_column")

    @staticmethod
    def _detect_kind(col):
        c = col.upper()
        if any(k in c for k in ["TEMP","DEGC"]): return "TEMP"
        if any(k in c for k in ["HUM","RH"]):    return "HUM"
        if "CO2" in c or "PPM" in c:             return "CO2"
        if any(k in c for k in ["PM1","PM2","PM10","UG"]): return "PM"
        if "PRES" in c:                          return "PRES"
        return ""

    @staticmethod
    def _daily_chart(series):
        return {t.strftime("%Y-%m-%d"): round(float(v),1)
                for t,v in series.items() if v > 0}

    @staticmethod
    def _hourly_profile(df_r, col, accumulator=True):
        try:
            if col not in df_r.columns: return {}
            s = df_r[col]
            if accumulator:
                h = s.resample("h").max() - s.resample("h").min()
                if h.sum()==0: h = s.resample("h").last().diff()
                h = h.fillna(0).clip(lower=0)
            else:
                h = s.resample("h").mean().fillna(0)
            if h.sum()==0: return {}
            prof = h.groupby(h.index.hour).mean()
            return {f"{k}h": round(float(v),3) for k,v in prof.items()}
        except: return {}

    @staticmethod
    def _prep_df(df):
        d = df.copy()
        if "_time" in d.columns: d = d.set_index("_time")
        if not pd.api.types.is_datetime64_any_dtype(d.index):
            d.index = pd.to_datetime(d.index)
        return d

    @staticmethod
    def analyze_device_dual(df_daily, df_raw, alias, price_kwh=0.15,
                             df_daily_prev=None, df_raw_prev=None):
        kpis = []

        df_cons = Analyzer._prep_df(df_daily) if not df_daily.empty else pd.DataFrame()
        df_r    = Analyzer._prep_df(df_raw)   if not df_raw.empty   else pd.DataFrame()

        # 1. ENERGIA
        try:
            cols_acc = [c for c in df_cons.columns if any(k in c for k in
                        ["ENEact","active_energy","EP_imp","AE","AI","m3","pulse","volumen"])]
            eres = Analyzer.resolve_primary_energy_column(cols_acc)

            if not eres.get("selected_energy_column") and not df_r.empty:
                acc_raw = [c for c in df_r.columns if any(k in c for k in
                           ["ENEact","active_energy","EP_imp","AE","AI","m3","pulse","in","out","personas","aforo"])]
                rres = Analyzer.resolve_primary_energy_column(acc_raw)
                c = rres.get("selected_energy_column")
                if c:
                    daily = df_r[c].resample("D").max() - df_r[c].resample("D").min()
                    if daily.sum()==0: daily = df_r[c].resample("D").sum()
                    total = daily.sum()
                    if total > 0:
                        unit = "m3" if "m3" in c else ("kWh" if "ENE" in c else "ud")
                        prev_chart = {}
                        if df_raw_prev is not None and not df_raw_prev.empty:
                            try:
                                dp = Analyzer._prep_df(df_raw_prev)
                                if c in dp.columns:
                                    pd_ = dp[c].resample("D").max()-dp[c].resample("D").min()
                                    prev_chart = Analyzer._daily_chart(pd_)
                            except: pass
                        kpis.append({
                            "title":f"{alias} ({c})","title_chart":f"Consumo ({total:.0f} {unit})",
                            "main_value":f"{int(total)} {unit}","secondary_value":"",
                            "label_main":"Acumulado","label_sec":"—",
                            "chart_data":Analyzer._daily_chart(daily),"chart_type":"bar",
                            "chart_color":"#E53935" if unit=="kWh" else "#F57F17",
                            "chart_unit":unit,
                            "chart_profile":Analyzer._hourly_profile(df_r,c,accumulator=True),
                            "prev_chart_data":prev_chart,"type":"energy","suffix_name":f"({c})",
                            "energy_column_selected":c,"energy_selection_rule":rres.get("selected_by_rule"),
                            "energy_warning":rres.get("warning"),
                            "heatmap_data":Analyzer._heatmap_data(df_r, c) if not df_r.empty else {},
                        })

            elif eres.get("selected_energy_column"):
                target = eres.get("selected_energy_column")
                daily  = df_cons[target].fillna(0)
                total  = daily.sum()
                cost   = total * price_kwh
                prof   = {}
                if not df_r.empty:
                    rc = next((c for c in df_r.columns if target in c), None)
                    if not rc: rc = next((c for c in df_r.columns if "ENE" in c or "active" in c), None)
                    if rc: prof = Analyzer._hourly_profile(df_r, rc, accumulator=True)
                if not prof:
                    avg = total/24 if total>0 else 0
                    prof = {f"{h}h": round(avg,2) for h in range(24)}
                prev_chart = {}
                if df_daily_prev is not None and not df_daily_prev.empty:
                    try:
                        dp = Analyzer._prep_df(df_daily_prev)
                        if target in dp.columns:
                            prev_chart = Analyzer._daily_chart(dp[target].fillna(0))
                    except: pass
                kpis.append({
                    "title":f"{alias} (Energía)","title_chart":f"Consumo ({total:.0f} kWh)",
                    "main_value":f"{int(total)} kWh","secondary_value":f"{cost:.2f} €",
                    "label_main":"Consumo","label_sec":"Coste estimado",
                    "chart_data":Analyzer._daily_chart(daily),"chart_type":"bar",
                    "chart_color":"#E53935","chart_unit":"kWh","chart_profile":prof,
                    "prev_chart_data":prev_chart,"type":"energy","suffix_name":"(Energía)",
                    "energy_column_selected":target,"total_energy_computed":float(total),
                    "price_input":float(price_kwh),"cost_computed":float(cost),
                    "energy_selection_rule":eres.get("selected_by_rule"),
                    "energy_warning":eres.get("warning"),
                    "heatmap_data":Analyzer._heatmap_data(df_r, rc) if (not df_r.empty and rc) else {},
                })
        except: pass

        # 2. SENSORES
        try:
            if not df_r.empty:
                sensor_kw = ["TEMP","HUM","CO2","PRES","Temp","Humi","ppm","degC",
                             "PM1","PM2.5","PM10","ug/m3","particulas"]
                cols_s = [c for c in df_r.columns if any(k in c for k in sensor_kw)]
                for c in cols_s:
                    try:
                        d_avg   = df_r[c].resample("D").mean().fillna(0)
                        val_avg = float(d_avg.mean())
                        val_min = float(df_r[c].min())
                        val_max = float(df_r[c].max())
                        if val_avg <= 0: continue
                        kind    = Analyzer._detect_kind(c)
                        unit_s  = SENSOR_UNITS.get(kind,"")
                        color_s = SENSOR_COLORS.get(kind,"#1565C0")
                        label_s = SENSOR_LABELS.get(kind,c)
                        comfort = COMFORT_RANGES.get(kind)
                        gauge_data = {
                            "value":round(val_avg,1),
                            "vmin": round(min(val_min, comfort[0] if comfort else val_min),1),
                            "vmax": round(max(val_max, comfort[1] if comfort else val_max),1),
                            "unit":unit_s,"label":label_s,
                        }
                        kpis.append({
                            "title":f"{alias} ({c})",
                            "main_value":f"{val_avg:.1f} {unit_s}",
                            "secondary_value":f"Min {val_min:.1f} · Max {val_max:.1f} {unit_s}",
                            "label_main":f"Promedio {label_s}","label_sec":"Rango del período",
                            "chart_data":Analyzer._daily_chart(d_avg),"chart_type":"line",
                            "chart_color":color_s,"chart_unit":unit_s,
                            "chart_profile":Analyzer._hourly_profile(df_r,c,accumulator=False),
                            "gauge_data":gauge_data,
                            "comfort_range":list(comfort) if comfort else None,
                            "type":"sensor","sensor_kind":kind,"suffix_name":f"({c})",
                        })
                    except: continue
        except: pass

        return kpis

    @staticmethod
    def _heatmap_data(df_raw, column):
        """
        Agrega df_raw en {hora(0-23): {dow(0-6): valor_medio}}.
        Ligero, serializable, sin DataFrame en memoria tras el cálculo.
        """
        try:
            if df_raw is None or df_raw.empty: return {}
            if column not in df_raw.columns: return {}
            import pandas as _pd
            df = df_raw[[column]].copy()
            if not isinstance(df.index, _pd.DatetimeIndex):
                return {}
            # Vectorizado: sin lambda para máximo rendimiento en ARM64
            df["date"] = df.index.date
            df["hour"] = df.index.hour
            df["dow"]  = df.index.dayofweek
            grp = df.groupby(["date","hour","dow"])[column]
            hourly = (grp.max() - grp.min()).clip(lower=0)
            hourly = hourly[hourly > 0]
            if hourly.empty:
                return {}
            grouped = hourly.groupby(["hour","dow"]).mean()
            result = {}
            for (h, d), v in grouped.items():
                result.setdefault(int(h), {})[int(d)] = round(float(v), 4)
            return result
        except:
            return {}

    @staticmethod
    def build_summary_rows(all_kpis):
        """
        Genera filas para la tabla resumen.
        - Multi-período: calcula tendencia entre períodos consecutivos del mismo dispositivo.
        - Mes anterior externo (prev_chart_data): lo usa si está disponible.
        - Sin datos para comparar: muestra neutro.
        """
        from collections import defaultdict
        by_device = defaultdict(list)
        for kpi in all_kpis:
            key = kpi.get("title","")
            by_device[key].append(kpi)

        rows = []
        for kpi in all_kpis:
            trend     = "="
            trend_pct = None
            trend_note = ""

            try:
                curr  = kpi.get("chart_data",{}) or {}
                prev  = kpi.get("prev_chart_data",{}) or {}
                title = kpi.get("title","")
                peers = by_device.get(title,[])

                # Opción 1: mes anterior externo disponible
                if curr and prev and not kpi.get("prev_no_data_warning"):
                    ca = sum(curr.values()) / max(len(curr),1)
                    pa = sum(prev.values()) / max(len(prev),1)
                    if pa > 0:
                        pct = (ca - pa) / pa * 100
                        trend_pct = pct
                        trend = "+" if ca > pa*1.05 else ("-" if ca < pa*0.95 else "=")
                        # Calcular nombre del mes anterior para que el cliente entienda la comparación
                        try:
                            first_key = sorted(curr.keys())[0]
                            from datetime import datetime as _dt
                            curr_dt = _dt.strptime(first_key[:7], "%Y-%m")
                            import calendar
                            prev_month = curr_dt.month - 1 or 12
                            prev_year  = curr_dt.year if curr_dt.month > 1 else curr_dt.year - 1
                            prev_name  = calendar.month_name[prev_month]
                            meses_es   = {1:"Enero",2:"Febrero",3:"Marzo",4:"Abril",5:"Mayo",6:"Junio",
                                          7:"Julio",8:"Agosto",9:"Septiembre",10:"Octubre",11:"Noviembre",12:"Diciembre"}
                            trend_note = f"vs {meses_es[prev_month]} {prev_year}"
                        except Exception:
                            trend_note = "vs mes anterior"

                # Opción 2: comparar períodos consecutivos del mismo informe
                elif len(peers) > 1:
                    idx = peers.index(kpi)
                    if idx > 0:
                        prev_peer  = peers[idx-1]
                        curr_total = sum((kpi.get("chart_data") or {}).values())
                        prev_total = sum((prev_peer.get("chart_data") or {}).values())
                        if prev_total > 0:
                            pct = (curr_total - prev_total) / prev_total * 100
                            trend_pct  = pct
                            trend = "+" if curr_total > prev_total*1.05 else ("-" if curr_total < prev_total*0.95 else "=")
                            prev_sec   = prev_peer.get("_section","período anterior")
                            if " - " in prev_sec: prev_sec = prev_sec.split(" - ",1)[1]
                            trend_note = f"vs {prev_sec}"
            except: pass

            if trend_pct is not None:
                sign = "+" if trend_pct > 0 else ""
                trend_str = f"{sign}{trend_pct:.1f}%"
            else:
                trend_str = "—"

            rows.append({
                "device":          kpi.get("title",""),
                "period":          kpi.get("_section",""),
                "type":            "Energía" if kpi.get("type")=="energy" else "Sensor",
                "main_value":      kpi.get("main_value","—"),
                "secondary_value": kpi.get("secondary_value","—"),
                "trend":           trend,
                "trend_pct":       trend_str,
                "trend_note":      trend_note,
                "prev_warning":    kpi.get("prev_no_data_warning",""),
            })
        return rows
