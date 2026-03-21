import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import io
import base64
import pandas as pd
import numpy as np

THEME = {
    "bg": "#FFFFFF", "bg2": "#F8F9FA", "grid": "#E9ECEF",
    "text": "#1A1A2E", "muted": "#6C757D", "border": "#DEE2E6",
}

SENSOR_PALETTE = {
    "TEMP":  {"main":"#E53935","light":"#FFCDD2","unit":"ºC",   "label":"Temperatura"},
    "HUM":   {"main":"#1565C0","light":"#BBDEFB","unit":"%",    "label":"Humedad"},
    "CO2":   {"main":"#37474F","light":"#ECEFF1","unit":"ppm",  "label":"CO₂"},
    "PM":    {"main":"#6A1B9A","light":"#E1BEE7","unit":"µg/m³","label":"Partículas"},
    "PRES":  {"main":"#2E7D32","light":"#C8E6C9","unit":"hPa",  "label":"Presión"},
    "ENERGY":{"main":"#E53935","light":"#FFCDD2","unit":"kWh",  "label":"Energía"},
    "M3":    {"main":"#00695C","light":"#B2DFDB","unit":"m³",   "label":"Volumen"},
    "PULSE": {"main":"#F57F17","light":"#FFF9C4","unit":"ud",   "label":"Pulsos"},
}

# Paletas corporativas — exportadas para uso en pdf_generator
BRAND_PALETTES = {
    "rojo":   {"main":"#E53935","light":"#FFCDD2"},
    "azul":   {"main":"#1565C0","light":"#BBDEFB"},
    "verde":  {"main":"#2E7D32","light":"#C8E6C9"},
    "oscuro": {"main":"#37474F","light":"#ECEFF1"},
    "morado": {"main":"#6A1B9A","light":"#E1BEE7"},
}

def _lighten(hex_color, factor=0.75):
    try:
        r = int(hex_color[1:3], 16)
        g = int(hex_color[3:5], 16)
        b = int(hex_color[5:7], 16)
        return f"#{int(r+(255-r)*factor):02X}{int(g+(255-g)*factor):02X}{int(b+(255-b)*factor):02X}"
    except:
        return "#F5F5F5"

def _detect_palette(col="", unit="", brand_color=None):
    s = (col + " " + unit).upper()
    if any(k in s for k in ["TEMP","DEGC","ºC"]):       return SENSOR_PALETTE["TEMP"]
    if any(k in s for k in ["HUM","RH"]):                return SENSOR_PALETTE["HUM"]
    if "CO2" in s or "PPM" in s:                         return SENSOR_PALETTE["CO2"]
    if any(k in s for k in ["PM1","PM2","PM10","UG"]):   return SENSOR_PALETTE["PM"]
    if "PRES" in s:                                      return SENSOR_PALETTE["PRES"]
    if any(k in s for k in ["M3","VOLUMEN"]):            return SENSOR_PALETTE["M3"]
    if any(k in s for k in ["PULSE","PERSONAS"]):        return SENSOR_PALETTE["PULSE"]
    base = dict(SENSOR_PALETTE["ENERGY"])
    if brand_color:
        base["main"]  = brand_color
        base["light"] = _lighten(brand_color, 0.75)
    return base

def _style(fig, axes):
    for ax in (axes if hasattr(axes,'__iter__') else [axes]):
        ax.set_facecolor(THEME["bg"])
        ax.grid(True, color=THEME["grid"], linewidth=0.6, linestyle='--', alpha=0.8)
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.spines['left'].set_color(THEME["border"])
        ax.spines['bottom'].set_color(THEME["border"])
        ax.tick_params(colors=THEME["muted"], labelsize=7)
    fig.patch.set_facecolor(THEME["bg"])

def _save(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', dpi=110, facecolor=THEME["bg"])
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')

class Visualizer:

    @staticmethod
    def create_bar_chart(data, color=None, title_chart="", unit="kWh",
                         prev_data=None, brand_color=None):
        try:
            if not data: return None
            pal = _detect_palette("", unit, brand_color=brand_color or color)
            main_c, light_c = pal["main"], pal["light"]
            sorted_items = sorted(data.items())
            x_labs, y_vals = [], []
            for k, v in sorted_items:
                try:    lab = pd.to_datetime(k).strftime('%d/%m')
                except: lab = str(k)
                x_labs.append(lab); y_vals.append(float(v))
            has_prev = bool(prev_data)
            fig, ax = plt.subplots(figsize=(7.2, 2.9))
            _style(fig, ax)
            x = np.arange(len(x_labs))
            w = 0.38 if has_prev else 0.6
            bars = ax.bar(x-(w/2 if has_prev else 0), y_vals, width=w,
                          color=main_c, alpha=0.92, label="Actual", zorder=3)
            if has_prev:
                pv = sorted(prev_data.items())
                pvals = [float(v) for _,v in pv[:len(x_labs)]]
                while len(pvals) < len(x_labs): pvals.append(0)
                ax.bar(x+w/2, pvals, width=w, color=light_c, alpha=0.85,
                       edgecolor=main_c, linewidth=0.5, label="Mes anterior", zorder=3)
                ax.legend(fontsize=7, framealpha=0.9, loc='upper right')
            if len(x_labs) <= 16:
                for bar in bars:
                    h = bar.get_height()
                    if h > 0:
                        ax.text(bar.get_x()+bar.get_width()/2., h+max(y_vals)*0.01,
                                f'{int(h)}', ha='center', va='bottom', fontsize=6.5,
                                color=THEME["text"], fontweight='500')
            ax.set_xticks(x)
            ax.set_xticklabels(x_labs, rotation=45 if len(x_labs)>8 else 0,
                               ha='right' if len(x_labs)>8 else 'center', fontsize=7)
            ax.set_ylabel(f"{pal['label']} ({unit})", fontsize=7.5, labelpad=4,
                          color=THEME["muted"])
            if title_chart:
                ax.set_title(title_chart, fontsize=9.5, fontweight='bold',
                             color=THEME["text"], pad=8)
            plt.tight_layout(pad=0.8)
            return _save(fig)
        except: return None

    @staticmethod
    def create_hourly_profile(data, color=None, unit="kW", sensor_col="",
                               brand_color=None):
        try:
            if not data: return None
            pal = _detect_palette(sensor_col, unit, brand_color=brand_color or color)
            main_c, light_c = pal["main"], pal["light"]
            clean = {}
            for k,v in data.items():
                try: clean[int(str(k).replace('h',''))] = float(v)
                except: pass
            if not clean: return None
            hours = list(range(24))
            vals  = [clean.get(h,0) for h in hours]
            fig, ax = plt.subplots(figsize=(6.5, 2.7))
            _style(fig, ax)
            x = np.array(hours, dtype=float)
            y = np.array(vals,  dtype=float)
            ax.fill_between(x, y, color=light_c, alpha=0.55, zorder=2)
            ax.plot(x, y, color=main_c, linewidth=2, zorder=3)
            idx_max = int(np.argmax(y))
            ax.scatter([x[idx_max]], [y[idx_max]], color=main_c, s=40, zorder=4,
                       edgecolors='white', linewidths=1)
            ax.annotate(f'{y[idx_max]:.1f}', xy=(x[idx_max], y[idx_max]),
                        xytext=(4,6), textcoords='offset points',
                        fontsize=7, color=main_c, fontweight='bold')
            ax.set_xticks([0,4,8,12,16,20,23])
            ax.set_xticklabels(['00:00','04:00','08:00','12:00','16:00','20:00','23:00'],fontsize=7)
            ax.set_xlim(-0.5, 23.5)
            ax.set_ylabel(f"{pal['label']} ({unit})", fontsize=7.5, labelpad=4, color=THEME["muted"])
            ax.set_xlabel("Hora del día", fontsize=7, labelpad=3, color=THEME["muted"])
            ax.set_title("Perfil Diario Promedio", fontsize=9, fontweight='bold',
                         color=THEME["text"], pad=7)
            plt.tight_layout(pad=0.8)
            return _save(fig)
        except: return None

    @staticmethod
    def create_line_chart(data, color=None, title_chart="", unit="Valor",
                          sensor_col="", ref_min=None, ref_max=None, brand_color=None):
        try:
            if not data: return None
            pal = _detect_palette(sensor_col, unit, brand_color=None)  # sensores: color propio
            main_c, light_c = pal["main"], pal["light"]
            sorted_items = sorted(data.items())
            x_labs, y_vals = [], []
            for k,v in sorted_items:
                try:    lab = pd.to_datetime(k).strftime('%d/%m')
                except: lab = str(k)
                x_labs.append(lab); y_vals.append(float(v))
            fig, ax = plt.subplots(figsize=(7.2, 2.8))
            _style(fig, ax)
            x = np.arange(len(x_labs))
            ax.fill_between(x, y_vals, color=light_c, alpha=0.45, zorder=2)
            ax.plot(x, y_vals, color=main_c, linewidth=2, marker='o',
                    markersize=3.5, zorder=3)
            if ref_min is not None and ref_max is not None:
                ax.axhspan(ref_min, ref_max, alpha=0.08, color='#2E7D32',
                           label=f"Confort {ref_min}–{ref_max} {unit}")
                ax.axhline(ref_min, color='#2E7D32', linewidth=0.8, linestyle=':', alpha=0.6)
                ax.axhline(ref_max, color='#2E7D32', linewidth=0.8, linestyle=':', alpha=0.6)
                ax.legend(fontsize=6.5, framealpha=0.9, loc='lower right')
            step = max(1, len(x_labs)//8)
            ax.set_xticks(x[::step])
            ax.set_xticklabels(x_labs[::step], rotation=45, ha='right', fontsize=7)
            ax.set_ylabel(f"{pal['label']} ({unit})", fontsize=7.5, labelpad=4, color=THEME["muted"])
            if title_chart:
                ax.set_title(title_chart, fontsize=9.5, fontweight='bold',
                             color=THEME["text"], pad=8)
            plt.tight_layout(pad=0.8)
            return _save(fig)
        except: return None

    @staticmethod
    def create_heatmap_weekly(df_raw_indexed, column, unit="kWh", sensor_col="",
                               brand_color=None):
        try:
            if df_raw_indexed is None or df_raw_indexed.empty: return None
            if column not in df_raw_indexed.columns: return None
            pal = _detect_palette(sensor_col, unit, brand_color=brand_color)
            cmap = mcolors.LinearSegmentedColormap.from_list(
                "sn", [THEME["bg"], pal["light"], pal["main"]])
            df = df_raw_indexed[[column]].copy()
            df['hour'] = df.index.hour
            df['dow']  = df.index.dayofweek
            pivot = df.groupby(['hour','dow'])[column].mean().unstack(fill_value=0)
            for d in range(7):
                if d not in pivot.columns: pivot[d] = 0
            pivot = pivot[sorted(pivot.columns)]
            fig, ax = plt.subplots(figsize=(6.5, 4.2))
            _style(fig, ax)
            im = ax.imshow(pivot.values, aspect='auto', cmap=cmap,
                           interpolation='nearest', origin='upper')
            ax.set_xticks(range(7))
            ax.set_xticklabels(['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'], fontsize=8)
            ax.set_yticks([0,4,8,12,16,20,23])
            ax.set_yticklabels(['00h','04h','08h','12h','16h','20h','23h'], fontsize=7)
            ax.set_ylabel("Hora", fontsize=8, labelpad=4, color=THEME["muted"])
            ax.set_title(f"Heatmap semanal — {pal['label']} ({unit})",
                         fontsize=9.5, fontweight='bold', color=THEME["text"], pad=8)
            cbar = fig.colorbar(im, ax=ax, fraction=0.03, pad=0.02)
            cbar.ax.tick_params(labelsize=7, colors=THEME["muted"])
            cbar.set_label(unit, fontsize=7, color=THEME["muted"])
            plt.tight_layout(pad=0.8)
            return _save(fig)
        except: return None

    @staticmethod
    def create_gauge(value, vmin, vmax, unit="", label="", sensor_col=""):
        try:
            pal = _detect_palette(sensor_col, unit)
            fig, ax = plt.subplots(figsize=(3.2, 2.0), subplot_kw={'projection':'polar'})
            fig.patch.set_facecolor(THEME["bg"])
            ax.set_facecolor(THEME["bg"])
            t_min = np.deg2rad(195); t_max = np.deg2rad(-15); t_rng = t_min-t_max
            def v2t(v):
                r = max(0,min(1,(v-vmin)/(vmax-vmin) if vmax>vmin else 0))
                return t_min-r*t_rng
            n = 200
            def arc(t1,t2,c):
                ax.plot(np.linspace(t1,t2,n),[1]*n,color=c,linewidth=10,solid_capstyle='butt',zorder=2)
            t33=v2t(vmin+(vmax-vmin)*0.33); t66=v2t(vmin+(vmax-vmin)*0.66)
            arc(t_min,t33,'#2E7D32'); arc(t33,t66,'#F57F17'); arc(t66,t_max,'#E53935')
            tv = v2t(value)
            ax.annotate("", xy=(tv,0.88), xytext=(0,0),
                        arrowprops=dict(arrowstyle="-|>",color=THEME["text"],lw=1.8,mutation_scale=10))
            ax.plot(0,0,'o',color=THEME["text"],markersize=5,zorder=5)
            ax.text(0,-0.35,f"{value:.1f} {unit}",ha='center',va='center',
                    fontsize=11,fontweight='bold',color=THEME["text"],transform=ax.transData)
            if label:
                ax.text(0,-0.62,label,ha='center',va='center',fontsize=7.5,
                        color=THEME["muted"],transform=ax.transData)
            ax.text(np.deg2rad(200),1.25,f'{vmin:.0f}',fontsize=6.5,color=THEME["muted"],ha='center')
            ax.text(np.deg2rad(-20),1.25,f'{vmax:.0f}',fontsize=6.5,color=THEME["muted"],ha='center')
            ax.set_ylim(0,1.4); ax.axis('off')
            plt.tight_layout(pad=0.3)
            return _save(fig)
        except: return None

    @staticmethod
    def create_summary_table(rows):
        try:
            if not rows: return None
            cols = ["Dispositivo","Tipo","Total / Promedio","Coste / Info","Tendencia"]
            n = len(rows)
            fig, ax = plt.subplots(figsize=(7.2, max(1.8, 0.45*n+0.9)))
            fig.patch.set_facecolor(THEME["bg"])
            ax.set_facecolor(THEME["bg"]); ax.axis('off')
            cell_data, cell_colors = [], []
            for i,r in enumerate(rows):
                sym = {"+":" ▲","-":" ▼","=":"  ●"}.get(r.get("trend",""),"")
                cell_data.append([r.get("device",""),r.get("type",""),
                                   r.get("main_value","—"),r.get("secondary_value","—"),sym])
                cell_colors.append([THEME["bg2"] if i%2==0 else THEME["bg"]]*5)
            tbl = ax.table(cellText=cell_data, colLabels=cols,
                           cellColours=cell_colors, loc='center', cellLoc='left')
            tbl.auto_set_font_size(False); tbl.set_fontsize(8); tbl.scale(1,1.6)
            for j in range(len(cols)):
                tbl[0,j].set_facecolor(THEME["text"])
                tbl[0,j].set_text_props(color='white',fontweight='bold',fontsize=8)
            for (ri,ci),cell in tbl.get_celld().items():
                cell.set_edgecolor(THEME["border"]); cell.set_linewidth(0.5)
            for i in range(1,n+1):
                c = {"+":'#B71C1C',"-":'#2E7D32',"=":'#6C757D'}.get(rows[i-1].get("trend",""),'#6C757D')
                tbl[i,4].set_text_props(color=c,fontweight='bold')
            plt.tight_layout(pad=0.4)
            return _save(fig)
        except: return None
