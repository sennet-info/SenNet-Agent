from weasyprint import HTML, CSS
import os
from datetime import datetime
from modules.visualizer import Visualizer, BRAND_PALETTES
from modules.analyzer import Analyzer

PALETTES = {
    "rojo":   {"main":"#E53935","dark":"#B71C1C","light":"#FFEBEE","border":"#FFCDD2"},
    "azul":   {"main":"#1565C0","dark":"#0D47A1","light":"#E3F2FD","border":"#BBDEFB"},
    "verde":  {"main":"#2E7D32","dark":"#1B5E20","light":"#E8F5E9","border":"#C8E6C9"},
    "oscuro": {"main":"#263238","dark":"#1A1A2E","light":"#ECEFF1","border":"#B0BEC5"},
    "morado": {"main":"#6A1B9A","dark":"#4A148C","light":"#F3E5F5","border":"#CE93D8"},
}

def _get_css(palette="rojo"):
    p = PALETTES.get(palette, PALETTES["rojo"])
    return f"""
@page {{
    size: A4;
    margin: 20mm 18mm 20mm 18mm;
    @top-right {{
        content: "Pag " counter(page) " / " counter(pages);
        font-family: Helvetica, sans-serif; font-size: 8pt; color: #6C757D;
    }}
}}
* {{ box-sizing: border-box; }}
body {{ font-family: Helvetica, Arial, sans-serif; color: #1A1A2E; margin: 0; padding: 0; line-height: 1.5; font-size: 10pt; }}
.report-header {{ display: flex; justify-content: space-between; align-items: flex-end;
                  border-bottom: 2.5px solid {p['main']}; padding-bottom: 8px; margin-bottom: 16px; }}
.logo {{ font-weight: bold; font-size: 22pt; letter-spacing: -0.5px; line-height: 1; }}
.logo .sen {{ color: #000; }} .logo .net {{ color: #9E9E9E; }}
.logo .bi  {{ font-size: 13pt; color: {p['main']}; margin-left: 3px; }}
.header-meta {{ font-size: 8.5pt; color: #6C757D; text-align: right; line-height: 1.7; }}
.section {{ padding-top: 0; }}
.section + .section {{ page-break-before: always; padding-top: 4mm; }}
.section-intro {{ break-inside: avoid; page-break-inside: avoid; margin-bottom: 16px; }}
.section-title {{ font-size: 15pt; font-weight: 700; color: #1A1A2E;
                  padding-left: 10px; border-left: 4px solid {p['main']};
                  margin: 0; }}
.card {{ background: #fff; border: 1px solid #DEE2E6; border-radius: 8px;
         padding: 16px 18px 14px; margin-bottom: 12px; break-inside: avoid;
         box-shadow: 0 1px 4px rgba(0,0,0,0.07); }}
.card-header {{ font-size: 11pt; font-weight: 700; color: #1A1A2E;
                padding-bottom: 8px; border-bottom: 1px solid #DEE2E6; margin-bottom: 14px; }}
.type-tag {{ display: inline-block; font-size: 7pt; font-weight: 700; text-transform: uppercase;
             letter-spacing: 0.5px; padding: 2px 8px; border-radius: 20px; margin-left: 8px; vertical-align: middle; }}
.tag-energy {{ background: {p['light']}; color: {p['dark']}; }}
.tag-sensor {{ background: #E3F2FD; color: #1565C0; }}
.kpi-row {{ display: flex; gap: 14px; margin-bottom: 16px; }}
.kpi-item {{ flex: 1; padding: 12px 16px; border-radius: 6px; text-align: center;
             border: 1px solid {p['border']}; background: {p['light']}; }}
.kpi-item.sensor {{ background: #E3F2FD; border-color: #BBDEFB; }}
.kpi-val {{ font-size: 18pt; font-weight: 700; line-height: 1.2; color: {p['dark']}; }}
.kpi-val.cost {{ color: {p['main']}; }}
.kpi-val.sensor {{ color: #1565C0; }}
.kpi-lbl {{ font-size: 7.5pt; color: #6C757D; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 5px; }}
.chart-wrap {{ text-align: center; margin-top: 14px; }}
.heatmap-wrap {{ text-align: center; margin-top: 8px; margin-bottom: 20px; }}
img.chart {{ max-width: 100%; border-radius: 5px; border: 1px solid #DEE2E6; }}
.prev-warning {{ background: #FFF3E0; border-left: 3px solid #FF9800; border-radius: 4px;
                 padding: 6px 10px; color: #E65100; font-size: 8pt; margin-top: 10px; }}
.summary-section {{ page-break-before: always; padding-top: 4mm; }}
.summary-title {{ font-size: 13pt; font-weight: 700; color: #1A1A2E;
                  margin-bottom: 12px; padding-left: 10px; border-left: 4px solid #37474F; }}
.no-data {{ background: #FFFDE7; border: 1px solid #FFE082; border-radius: 6px;
            padding: 10px 14px; color: #F57F17; font-size: 9pt; }}
.footer {{ font-size: 7.5pt; color: #6C757D; text-align: center;
           border-top: 1px solid #DEE2E6; padding-top: 5px; margin-top: 24px; }}
"""

def _img(b64):
    if not b64: return ""
    return f'<img class="chart" src="data:image/png;base64,{b64}"/>'

def _render_charts(kpi, options, brand_color=None):
    ktype      = kpi.get("type", "energy")
    chart_data = kpi.get("chart_data", {})
    unit       = kpi.get("chart_unit", "kWh")
    title      = kpi.get("title_chart", "")
    prof       = kpi.get("chart_profile", {})
    prev       = kpi.get("prev_chart_data", {})
    sensor_col = kpi.get("suffix_name", "")
    comfort    = kpi.get("comfort_range")
    enriched   = dict(kpi)
    show_prev    = options.get("show_prev", False)
    show_profile = options.get("show_profile", True)
    show_heatmap = options.get("show_heatmap", False)

    if ktype == "energy":
        enriched["chart_img_1"] = Visualizer.create_bar_chart(
            data=chart_data, title_chart=title, unit=unit,
            prev_data=prev if (show_prev and prev) else None,
            brand_color=brand_color,
        )
    else:
        enriched["chart_img_1"] = Visualizer.create_line_chart(
            data=chart_data, title_chart=title, unit=unit,
            sensor_col=sensor_col,
            ref_min=comfort[0] if comfort else None,
            ref_max=comfort[1] if comfort else None,
        )

    if show_profile and prof:
        enriched["chart_img_2"] = Visualizer.create_hourly_profile(
            data=prof,
            unit="kW" if ktype == "energy" else unit,
            sensor_col=sensor_col,
            brand_color=brand_color if ktype == "energy" else None,
        )

    gauge_d = kpi.get("gauge_data")
    if gauge_d and ktype == "sensor":
        enriched["gauge_img"] = Visualizer.create_gauge(
            value=gauge_d["value"], vmin=gauge_d["vmin"], vmax=gauge_d["vmax"],
            unit=gauge_d.get("unit",""), label=gauge_d.get("label",""),
            sensor_col=sensor_col,
        )

    show_cumulative = options.get("show_cumulative", False)
    show_top_days   = options.get("show_top_days", False)

    if show_cumulative and ktype == "energy" and chart_data:
        enriched["cumulative_img"] = Visualizer.create_cumulative_line(
            data=chart_data, unit=unit, brand_color=brand_color,
        )

    if show_top_days and ktype == "energy" and chart_data:
        enriched["top_days_img"] = Visualizer.create_top_days(
            data=chart_data, unit=unit, brand_color=brand_color,
        )

    if show_heatmap and ktype == "energy":
        heatmap_d = kpi.get("heatmap_data")
        if heatmap_d:
            enriched["heatmap_img"] = Visualizer.create_heatmap_weekly(
                heatmap_data=heatmap_d,
                unit=unit,
                brand_color=brand_color,
            )

    return enriched

def _card_html(alias, kpi):
    ktype   = kpi.get("type","energy")
    tag_cls = "tag-energy" if ktype=="energy" else "tag-sensor"
    tag_lbl = "Energia"    if ktype=="energy" else "Sensor"
    cls     = "sensor"     if ktype=="sensor" else ""
    main_val = kpi.get("main_value","--")
    sec_val  = kpi.get("secondary_value","--")
    lbl_main = kpi.get("label_main","Valor principal")
    lbl_sec  = kpi.get("label_sec","Informacion")

    kpi_html = f"""
    <div class="kpi-row">
        <div class="kpi-item {cls}">
            <div class="kpi-val {cls}">{main_val}</div>
            <div class="kpi-lbl">{lbl_main}</div>
        </div>
        <div class="kpi-item {cls}">
            <div class="kpi-val cost">{sec_val if sec_val else "--"}</div>
            <div class="kpi-lbl">{lbl_sec}</div>
        </div>
    </div>"""

    c1 = kpi.get("chart_img_1")
    c2 = kpi.get("chart_img_2")
    g  = kpi.get("gauge_img")
    prev_warn = kpi.get("prev_no_data_warning","")

    charts = ""
    if c1: charts += f'<div class="chart-wrap">{_img(c1)}</div>'
    if prev_warn:
        charts += f'<div class="prev-warning">&#9888; {prev_warn}</div>'
    if c2: charts += f'<div class="chart-wrap">{_img(c2)}</div>'
    if g and not c2: charts += f'<div class="chart-wrap">{_img(g)}</div>'

    card = f"""
    <div class="card">
        <div class="card-header">{alias}<span class="type-tag {tag_cls}">{tag_lbl}</span></div>
        {kpi_html}{charts}
    </div>"""

    hm  = kpi.get("heatmap_img")
    cum = kpi.get("cumulative_img")
    top = kpi.get("top_days_img")
    if hm:
        card += f'<div class="heatmap-wrap">{_img(hm)}</div>'
    if cum: card += f'<div class="chart-wrap">{_img(cum)}</div>'
    if top: card += f'<div class="chart-wrap">{_img(top)}</div>'

    return card

class PDFComposer:

    @staticmethod
    def build_report(profile_name, report_data, output_dir,
                     all_kpis=None, options=None):
        if options is None: options = {}
        palette      = options.get("palette", "rojo")
        show_summary = options.get("show_summary", True)
        p            = PALETTES.get(palette, PALETTES["rojo"])
        brand_color  = p["main"]
        now    = datetime.now().strftime("%d/%m/%Y %H:%M")
        client = profile_name.upper()

        header_html = f"""<div class="report-header">
    <div class="logo"><span class="sen">Sen</span><span class="net">Net</span><span class="bi"> Energy BI</span></div>
    <div class="header-meta">CLIENTE: {client}<br>FECHA: {now}</div>
</div>"""

        sections_html = ""
        first        = True
        all_rendered = []

        for section_title, devices in report_data.items():
            inner = ""
            if not devices:
                inner = '<div class="no-data">Sin datos disponibles para este periodo.</div>'
            else:
                for alias, kpi in devices.items():
                    kpi["_section"] = section_title
                    enriched = _render_charts(kpi, options, brand_color=brand_color)
                    all_rendered.append(enriched)
                    inner += _card_html(alias, enriched)

            header_block = header_html if first else ""
            first = False
            sections_html += (
                f'<div class="section">'
                f'<div class="section-intro">'
                f'{header_block}'
                f'<div class="section-title">{section_title}</div>'
                f'</div>'
                f'{inner}'
                f'</div>\n'
            )

        summary_html = ""
        if show_summary:
            src  = all_kpis if all_kpis else all_rendered
            if src:
                rows = Analyzer.build_summary_rows(src)
                img  = Visualizer.create_summary_table(rows)
                if img:
                    summary_html = f"""<div class="summary-section">
    <div class="summary-title">Resumen del informe</div>
    <div class="chart-wrap">{_img(img)}</div>
</div>"""

        html = f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"></head>
<body>
{sections_html}
{summary_html}
<div class="footer">SenNet IoT Solutions - Confidential Report - generated by AI Agent</div>
</body></html>"""

        if not os.path.exists(output_dir): os.makedirs(output_dir)
        filename    = f"Report_{profile_name}_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        output_path = os.path.join(output_dir, filename)
        HTML(string=html).write_pdf(output_path, stylesheets=[CSS(string=_get_css(palette))])
        return output_path
