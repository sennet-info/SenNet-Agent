import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import io
import base64
import pandas as pd
import numpy as np

class Visualizer:
    @staticmethod
    def _setup_style():
        plt.style.use('ggplot')
        plt.rcParams.update({
            'font.family': 'sans-serif',
            'font.size': 8,
            'axes.labelcolor': '#555555',
            'axes.labelsize': 8
        })

    @staticmethod
    def create_bar_chart(data, color='#D32F2F', title_chart=""):
        Visualizer._setup_style()
        try:
            if not data: return None
            sorted_items = sorted(data.items())
            x_labs = []
            y_vals = []
            for k, v in sorted_items:
                try: dt = pd.to_datetime(k); lab = dt.strftime('%d/%m')
                except: lab = str(k)
                x_labs.append(lab)
                y_vals.append(v)

            fig, ax = plt.subplots(figsize=(7, 3))
            bars = ax.bar(x_labs, y_vals, color=color, alpha=0.9, width=0.6)

            if len(x_labs) < 15:
                for bar in bars:
                    h = bar.get_height()
                    if h > 0:
                        ax.text(bar.get_x() + bar.get_width()/2., h,
                                f'{int(h)}', ha='center', va='bottom', fontsize=7)

            if title_chart: ax.set_title(title_chart, pad=10, fontsize=10, weight='bold')
            ax.set_ylabel("Energía (kWh)", labelpad=5) # Leyenda Eje Y
            ax.spines['top'].set_visible(False)
            ax.spines['right'].set_visible(False)

            if len(x_labs) > 7: plt.xticks(rotation=45, ha='right')
            else: plt.xticks(rotation=0)

            plt.tight_layout()

            buf = io.BytesIO()
            plt.savefig(buf, format='png', bbox_inches='tight', dpi=100)
            plt.close(fig)
            buf.seek(0)
            return base64.b64encode(buf.read()).decode('utf-8')
        except: return None

    @staticmethod
    def create_hourly_profile(data):
        Visualizer._setup_style()
        try:
            if not data: return None
            clean = {}
            for k,v in data.items():
                try: clean[int(str(k).replace('h',''))] = v
                except: pass
            if not clean: return None

            sorted_keys = sorted(clean.keys())
            sorted_vals = [clean[k] for k in sorted_keys]

            fig, ax = plt.subplots(figsize=(6, 3))
            x = np.arange(len(sorted_vals))

            # Curva Rellena
            ax.fill_between(x, sorted_vals, color='#10B981', alpha=0.3)
            ax.plot(x, sorted_vals, color='#059669', linewidth=2)

            ax.set_xticks([0, 6, 12, 18, 23])
            ax.set_xticklabels(['00:00', '06:00', '12:00', '18:00', '23:00'])

            # ETIQUETAS Y LEYENDA CLARAS
            ax.set_ylabel("Potencia Media (kW)", labelpad=5, weight='bold')
            ax.set_xlabel("Hora del Día", labelpad=5)

            plt.title("Perfil Diario Promedio", pad=10, fontsize=9, weight='bold')

            ax.grid(True, linestyle='--', alpha=0.5) # Cuadricula suave
            ax.spines['top'].set_visible(False)
            ax.spines['right'].set_visible(False)
            plt.tight_layout()

            buf = io.BytesIO()
            plt.savefig(buf, format='png', bbox_inches='tight', dpi=100)
            plt.close(fig)
            buf.seek(0)
            return base64.b64encode(buf.read()).decode('utf-8')
        except: return None

    @staticmethod
    def create_line_chart(data, color='#1976D2', title_chart=""):
        Visualizer._setup_style()
        try:
            if not data: return None
            k0 = list(data.keys())[0] if data else ""
            is_temp = "TEMP" in title_chart.upper() or "ºC" in title_chart
            unit = "ºC" if is_temp else "Valor" # Detectamos unidad por contexto simple

            sorted_items = sorted(data.items())
            x_labs = []
            y_vals = []
            for k, v in sorted_items:
                try: dt = pd.to_datetime(k); lab = dt.strftime('%d/%m')
                except: lab = str(k)
                x_labs.append(lab)
                y_vals.append(v)

            fig, ax = plt.subplots(figsize=(7, 3))
            ax.plot(x_labs, y_vals, color=color, marker='o', linewidth=2, markersize=4)
            ax.fill_between(x_labs, y_vals, color=color, alpha=0.1)

            if title_chart: ax.set_title(title_chart, pad=10, fontsize=10, weight='bold')
            ax.set_ylabel(unit, labelpad=5) # Leyenda Eje Y

            ax.spines['top'].set_visible(False)
            ax.spines['right'].set_visible(False)

            if len(x_labs) > 7: plt.xticks(rotation=45, ha='right')
            else: plt.xticks(rotation=0)

            plt.tight_layout()

            buf = io.BytesIO()
            plt.savefig(buf, format='png', bbox_inches='tight', dpi=100)
            plt.close(fig)
            buf.seek(0)
            return base64.b64encode(buf.read()).decode('utf-8')
        except: return None
