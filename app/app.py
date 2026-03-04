import streamlit as st
import os
import json
import base64
from datetime import datetime, date, timedelta
import pandas as pd
import time
from main import run_analysis_discovery, get_discovery_options, _get_discovery_options_cached
from modules.report_range import REPORT_RANGE_OPTIONS, DEFAULT_REPORT_RANGE_MODE, compute_report_range, to_flux_range

FREQUENCY_DEFAULT_RANGE_MODE = {
    "Diaria": "last_7_days",
    "Semanal": "last_7_days",
    "Mensual": "previous_full_month",
}


def format_date_es(value):
    if not value:
        return "--"
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return value
    return value.strftime("%d/%m/%Y")


def render_report_range_help(selected_mode):
    start_dt, end_dt = compute_report_range(selected_mode, now=datetime.now())
    st.caption(f"Rango calculado: {format_date_es(start_dt)} → {format_date_es(end_dt)}")
    st.caption(
        "• Mes anterior (mes completo): ideal para informes mensuales\n"
        "• Último mes (móvil): ideal si quieres siempre 30-31 días desde hoy"
    )


st.set_page_config(page_title="SenNet Energy Intelligence", layout="wide", initial_sidebar_state="expanded")

st.markdown("""
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');

    /* Configuración General */
    .stApp {
        background-color: #0F172A;
        font-family: 'Outfit', sans-serif;
        color: #F8FAFC;
    }

    /* Tipografía Equilibrada */
    html, body, [class*="css"] {
        font-size: 16px; 
    }

    h1 {
        font-size: 2.5rem !important;
        font-weight: 700;
        background: linear-gradient(90deg, #F87171, #DC2626);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 2rem !important;
        padding-top: 1rem;
    }

    h3 {
        color: #E2E8F0 !important;
        font-weight: 600;
        font-size: 1.4rem !important;
        margin-bottom: 1rem !important;
        border-bottom: 1px solid #334155;
        padding-bottom: 0.5rem;
    }

    /* Inputs Mejorados */
    .stSelectbox, .stMultiSelect { margin-bottom: 1.5rem; }
    .stSelectbox>div>div, .stMultiSelect>div>div, .stDateInput>div>div, .stNumberInput>div>div {
        background-color: #1E293B !important;
        color: #FFFFFF !important;
        border: 1px solid #475569 !important;
        border-radius: 8px !important;
    }

    /* Botones Estilizados pero Compactos */
    .stButton>button {
        border-radius: 8px;
        font-weight: 600;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        transition: all 0.2s ease;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    /* Boton Generar (Primary) */
    div[data-testid="stVerticalBlock"] > div > div > div > div > div > .stButton > button {
         background: linear-gradient(135deg, #EF4444 0%, #B91C1C 100%);
         color: white; border: none; font-size: 1.1rem; padding: 0.8em 2em;
         box-shadow: 0 4px 15px rgba(220, 38, 38, 0.4);
    }

    /* Sidebar */
    section[data-testid="stSidebar"] { background-color: #0B1120; border-right: 1px solid #1E293B; }
    .logo-text { font-size: 2rem; font-weight: 800; color: #EF4444; margin-bottom: 1.5rem; }
    .logo-sub { font-size: 0.85rem; color: #94A3B8; margin-top: -10px; }

    /* Contenedores */
    div[data-testid="column"] {
        background-color: #162032; /* Fondo sutil para columnas */
        padding: 1.5rem;
        border-radius: 12px;
        border: 1px solid #1E293B;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    </style>
""", unsafe_allow_html=True)

@st.cache_data(ttl=60, show_spinner=False)
def load_tenants():
    if os.path.exists('config_tenants.json'):
        with open('config_tenants.json', 'r') as f:
            return json.load(f)
    return {}

def save_tenants(data):
    with open('config_tenants.json', 'w') as f:
        json.dump(data, f, indent=2)
    load_tenants.clear()

def clear_discovery_cache():
    load_tenants.clear()
    load_roles.clear()
    _get_discovery_options_cached.clear()

def _load_roles_file():
    if os.path.exists('device_roles.json'):
        with open('device_roles.json', 'r') as f:
            return json.load(f)
    return {}

@st.cache_data(ttl=60, show_spinner=False)
def load_roles():
    return _load_roles_file()

def save_roles(data):
    with open('device_roles.json', 'w') as f:
        json.dump(data, f, indent=2)
    load_roles.clear()

def log_scheduler_event(event, **kwargs):
    log_file = "cron_log.log"
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    details = " ".join([f"{k}={v}" for k, v in kwargs.items()])
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(f"[{ts}] {event} {details}\n")


with st.sidebar:
    st.markdown('<div class="logo-text">SenNet<span style="color:white">Intelligence</span></div>', unsafe_allow_html=True)
    st.markdown('<div class="logo-sub">Platform V52.0 (SCHEDULER)</div>', unsafe_allow_html=True)
    st.write("")
    mode = st.radio("NAVEGACIÓN", ["🔭 Explorador de Datos", "🏭 Inventario & Roles", "📅 Programador", "⚙️ Conexiones"])
    tenants = load_tenants(); t_names = list(tenants.keys()); sel_tenant = None
    if st.button("🔄 Recargar conexiones", use_container_width=True):
        clear_discovery_cache()
        st.session_state.pop("analysis_cache", None)
        st.success("Caché recargada")
        st.rerun()
    if mode not in ["⚙️ Conexiones", "📅 Programador"]:
        st.markdown("---")
        if not tenants: st.warning("⚠️ Sin conexiones")
        else:
            st.markdown("### Seleccionar Cliente")
            sn = st.selectbox("Cliente", t_names, label_visibility="collapsed")
            sel_tenant = tenants[sn]

ROLE_OPTIONS = ['consumption', 'generation', 'storage', 'meter_fluids', 'meter_people', 'environmental']
ROLE_LABELS = {'consumption':'🔌 Consumo','generation':'🌞 Generación','storage':'🔋 Batería','meter_fluids':'💧 Agua/Gas','meter_people':'👥 Personas','environmental':'🌡️ Sensor'}

if mode == "📅 Programador":
    st.title("📅 Programador de Tareas Automáticas")
    
    tab1, tab2, tab3 = st.tabs(["➕ Nueva Tarea", "📋 Tareas Activas", "⚙️ Configuración SMTP"])
    
    # --- TAB 1: NUEVA TAREA ---
    with tab1:
        if not tenants:
            st.warning("⚠️ Primero configura una conexión en '⚙️ Conexiones'")
        else:
            col1, col2 = st.columns(2)
            with col1:
                st.subheader("1. Selección del Objetivo")
                p_alias = st.selectbox("Conexión (Tenant)", t_names, key="sch_c")
                if p_alias:
                    t_conf = tenants[p_alias]
                    # Descubrimos los clientes REALES dentro de ese bucket
                    p_clients = get_discovery_options(t_conf, "clients")
                    p_client = st.selectbox("Cliente", p_clients, key="sch_cli")
                    
                    if p_client:
                        p_sites = get_discovery_options(t_conf, "sites", parent=p_client)
                        p_site = st.selectbox("Instalación", p_sites, key="sch_s")
                        
                        if p_site:
                            p_devs = get_discovery_options(t_conf, "devices", parent=p_client, site=p_site)
                            def_devs = [d for d in p_devs if 'GENERAL' in d.upper()]
                            p_dev = st.selectbox("Dispositivo Principal", p_devs, index=p_devs.index(def_devs[0]) if def_devs else 0, key="sch_d")

            with col2:
                st.subheader("2. Programación y Envío")
                p_freq = st.selectbox("Frecuencia", ["Diaria", "Semanal", "Mensual"], key="sch_f")
                report_range_modes = list(REPORT_RANGE_OPTIONS.keys())
                suggested_mode = FREQUENCY_DEFAULT_RANGE_MODE.get(p_freq, DEFAULT_REPORT_RANGE_MODE)
                if st.session_state.get("sch_rrm_last_freq") != p_freq:
                    st.session_state["sch_rrm"] = suggested_mode
                    st.session_state["sch_rrm_last_freq"] = p_freq

                current_mode = st.session_state.get("sch_rrm", DEFAULT_REPORT_RANGE_MODE)
                if current_mode not in report_range_modes:
                    current_mode = DEFAULT_REPORT_RANGE_MODE
                p_report_range_mode = st.selectbox(
                    "Rango del informe",
                    report_range_modes,
                    index=report_range_modes.index(current_mode),
                    format_func=lambda mode: REPORT_RANGE_OPTIONS[mode],
                    key="sch_rrm"
                )
                render_report_range_help(p_report_range_mode)
                p_time = st.time_input("Hora de Ejecución", value=datetime.strptime("08:00", "%H:%M").time(), key="sch_t")
                p_emails = st.text_area("Emails Destino (separados por coma)", placeholder="jefe@empresa.com, yo@empresa.com", key="sch_e")
                
                st.markdown("---")
                if st.button("💾 Guardar Tarea Programada", type="primary"):
                    if not p_emails:
                        st.error("❌ Indica al menos un email.")
                    else:
                        emails_list = [e.strip() for e in p_emails.split(",") if e.strip()]
                        # Mapeo Frecuencia
                        freq_map = {"Diaria": "daily", "Semanal": "weekly", "Mensual": "monthly"}
                        
                        from modules.scheduler_logic import SchedulerLogic
                        res = SchedulerLogic.add_task(
                            tenant_alias=p_alias,
                            client=p_client,
                            site=p_site,
                            device=p_dev,
                            frequency=freq_map[p_freq],
                            time=p_time.strftime("%H:%M"),
                            emails=emails_list,
                            report_range_mode=p_report_range_mode
                        )
                        st.success(f"✅ Tarea guardada correctamente. ID: {res['id'][:8]}...")
                        time.sleep(1)
                        st.rerun()

    # --- TAB 2: LISTAR TAREAS ---
    with tab2:
        from modules.scheduler_logic import SchedulerLogic
        tasks = SchedulerLogic.load_tasks()
        
        if not tasks:
            st.info("No hay tareas programadas.")
        else:
            for t in tasks:
                with st.expander(f"⏰ {t['time']} | {t['site']} ({t['device']}) - {t['frequency'].upper()}"):
                    c1, c2, c3 = st.columns([3, 1, 1])
                    task_range_mode = t.get('report_range_mode', DEFAULT_REPORT_RANGE_MODE)
                    task_range_label = REPORT_RANGE_OPTIONS.get(task_range_mode, REPORT_RANGE_OPTIONS[DEFAULT_REPORT_RANGE_MODE])
                    last_range_text = ""
                    if t.get('last_range_start') and t.get('last_range_end'):
                        last_range_text = f"<br><small>Último rango ejecutado: {format_date_es(t.get('last_range_start'))} → {format_date_es(t.get('last_range_end'))}</small>"

                    c1.markdown(
                        f"**Conexión:** {t.get('tenant_alias','--')}<br>"
                        f"**Cliente:** {t['client']}<br>"
                        f"**Emails:** {', '.join(t['emails'])}<br>"
                        f"**Rango informe:** {task_range_label}<br>"
                        f"**Última:** {t['last_run'] if t['last_run'] else 'Nunca'}"
                        f"{last_range_text}",
                        unsafe_allow_html=True
                    )
                    
                    if c2.button("🚀 Ahora", key=f"run_now_{t['id']}"):
                        with st.spinner("Enviando..."):
                            # Ejecución puntual
                            auth = tenants.get(t.get('tenant_alias'))
                            if auth:
                                start_dt = None
                                end_dt = None
                                try:
                                    claim = SchedulerLogic.claim_execution(t['id'], source="manual")
                                    if not claim.get('ok'):
                                        log_scheduler_event("TASK_EXECUTE_SKIP_ALREADY_RAN", task_id=t['id'], reason=claim.get('reason'))
                                        st.warning("Tarea ya en ejecución o ya marcada en esta ventana.")
                                        continue

                                    run_id = claim.get('run_id')
                                    log_scheduler_event("TASK_EXECUTE_START", task_id=t['id'], run_id=run_id)
                                    start_dt, end_dt = compute_report_range(task_range_mode)
                                    range_flux = to_flux_range(start_dt, end_dt)
                                    pdf = run_analysis_discovery(auth, t['client'], t['site'], [t['device']], range_flux, 0.14, None, start_dt=start_dt, end_dt=end_dt)
                                    from modules.email_sender import EmailSender
                                    smtp = {}
                                    if os.path.exists("smtp_config.json"):
                                        with open("smtp_config.json") as f: smtp = json.load(f)
                                    sender = EmailSender(smtp.get('server'), smtp.get('port'), smtp.get('user'), smtp.get('password'))
                                    subject = f"📊 Informe Energético: {t['site']} ({datetime.now().strftime('%d/%m/%Y')})"
                                    
                                    # Cuerpo HTML Profesional Premium
                                    body = f"""
                                    <html>
                                    <body style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f7f9; margin: 0; padding: 20px;">
                                        <div style="max-width: 600px; margin: auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border: 1px solid #e1e8ed;">
                                            <div style="background: linear-gradient(135deg, #EF4444 0%, #B91C1C 100%); padding: 30px; text-align: center; color: white;">
                                                <h1 style="margin: 0; font-size: 24px; letter-spacing: 1px;">SenNet Intelligence</h1>
                                                <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 14px;">Auditoría de Energía Bajo Demanda</p>
                                            </div>
                                            <div style="padding: 30px; color: #334155; line-height: 1.6;">
                                                <h2 style="color: #1e293b; margin-top: 0;">Resumen Manual de Instalación</h2>
                                                <p>Hola,</p>
                                                <p>Se ha generado un informe energético solicitado manualmente para la instalación <strong>{t['site']}</strong>.</p>
                                                
                                                <div style="background-color: #f8fafc; border-left: 4px solid #EF4444; padding: 15px; margin: 20px 0; border-radius: 4px;">
                                                    <p style="margin: 0;"><strong>Instalación:</strong> {t['site']}</p>
                                                    <p style="margin: 5px 0 0 0;"><strong>Origen:</strong> Solicitud desde Panel Administrativo</p>
                                                    <p style="margin: 5px 0 0 0;"><strong>Fecha:</strong> {datetime.now().strftime('%d/%m/%Y %H:%M')}</p>
                                                </div>

                                                <p>El documento detallado se encuentra adjunto para su revisión inmediata.</p>
                                                
                                                <div style="text-align: center; margin-top: 30px;">
                                                    <p style="font-size: 11px; color: #94a3b8;">
                                                        Aviso: Este informe ha sido solicitado manualmente desde el portal SenNet Intelligence.<br>
                                                        Utilice este canal para auditorías puntuales.
                                                    </p>
                                                </div>
                                            </div>
                                            <div style="background: #f8fafc; padding: 15px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">
                                                © {datetime.now().year} SenNet Portfolio - Advanced Monitoring
                                            </div>
                                        </div>
                                    </body>
                                    </html>
                                    """
                                    ok, msg = sender.send_email(t['emails'], subject, body, pdf)
                                    if ok:
                                        log_scheduler_event("TASK_EMAIL_SENT", task_id=t['id'], run_id=run_id)
                                        st.success("🚀 ¡Informe Premium Enviado!")
                                    else:
                                        st.error(msg)
                                    SchedulerLogic.finish_execution(t['id'], run_id, sent_ok=ok, range_start=start_dt, range_end=end_dt)
                                    if ok:
                                        time.sleep(1)
                                        st.rerun()
                                except Exception as e:
                                    if 'run_id' in locals() and run_id:
                                        SchedulerLogic.finish_execution(t['id'], run_id, sent_ok=False, range_start=start_dt, range_end=end_dt)
                                    st.error(f"Error: {e}")
                            else: st.error("Conexión perdida")

                    if c3.button("🗑️", key=f"del_task_{t['id']}"):
                        SchedulerLogic.remove_task(t['id'])
                        st.rerun()

    # --- TAB 3: CONFIG SMTP ---
    with tab3:
        st.subheader("⚙️ Servidor de Correo (SMTP)")
        st.info("Configura aquí desde dónde se enviarán los correos.")
        
        SMTP_FILE = "smtp_config.json"
        curr_smtp = {}
        if os.path.exists(SMTP_FILE):
             with open(SMTP_FILE, 'r') as f: curr_smtp = json.load(f)
        
        with st.form("smtp_form"):
            c1, c2 = st.columns(2)
            s_host = c1.text_input("Servidor SMTP", value=curr_smtp.get('server', 'smtp.gmail.com'))
            s_port = c2.number_input("Puerto (SSL=465, TLS=587)", value=curr_smtp.get('port', 587))
            s_user = c1.text_input("Usuario / Email", value=curr_smtp.get('user', ''))
            s_pass = c2.text_input("Contraseña / App Password", value=curr_smtp.get('password', ''), type="password")
            
            if st.form_submit_button("Guardar Configuración"):
                new_conf = {"server": s_host, "port": s_port, "user": s_user, "password": s_pass}
                with open(SMTP_FILE, 'w') as f: json.dump(new_conf, f)
                st.success("✅ Configuración guardada.")

elif mode == "⚙️ Conexiones":
    if 'admin_auth' not in st.session_state: st.session_state.admin_auth = False

    if not st.session_state.admin_auth:
        st.title("🔒 Acceso Administrativo")
        with st.form("login"):
            u = st.text_input("Usuario"); p = st.text_input("Contraseña", type="password")
            if st.form_submit_button("Acceder"):
                if u=="admin" and p=="admin": st.session_state.admin_auth=True; st.rerun()
                else: st.error("Acceso denegado")
    else:
        c1, c2 = st.columns([3,1])
        c1.title("⚙️ Gestión de Conexiones")
        if c2.button("🔓 Salir"): st.session_state.admin_auth=False; st.rerun()

        with st.expander("➕ Añadir Nueva Conexión", expanded=True):
            with st.form("add"):
                c1,c2=st.columns(2); n=c1.text_input("Alias"); u=c2.text_input("URL", "http://sennet-dataready.com:8086")
                t=st.text_input("Token", type="password"); c3,c4=st.columns(2); o=c3.text_input("Org"); b=c4.text_input("Bucket")
                if st.form_submit_button("Guardar"): tenants[n]={"url":u,"token":t,"org":o,"bucket":b}; save_tenants(tenants); st.rerun()
        for n,d in tenants.items():
            st.info(f"🏢 **{n}** | {d['url']}")
            if st.button("Eliminar", key=f"del_{n}"): del tenants[n]; save_tenants(tenants); st.rerun()

elif mode == "🏭 Inventario & Roles":
    st.title("🏭 Inventario de Equipos")
    if sel_tenant:
        roles_db = load_roles()
        try:
            with st.spinner("🔄 Escaneando..."):
                devs_set=set(); ctx={}
                for c in get_discovery_options(sel_tenant,"clients"):
                    for s in get_discovery_options(sel_tenant,"sites",parent=c):
                        for d in get_discovery_options(sel_tenant,"devices",parent=c,site=s):
                            devs_set.add(d);
                            if d not in ctx: ctx[d]=f"{s} ({c})"
                all_d=sorted(list(devs_set))
            unk=[d for d in all_d if d not in roles_db]; knw=[d for d in all_d if d in roles_db]
            if unk:
                st.subheader(f"⚠️ Pendientes ({len(unk)})")
                sites_unk=sorted(list(set([ctx.get(d,"G").split(" (")[0] for d in unk])))
                fil=st.selectbox("Filtrar:", ["-- TODOS --"]+sites_unk)
                sh=[d for d in unk if fil in ctx.get(d,"")] if fil!="-- TODOS --" else unk
                if sh:
                    c1,c2,c3=st.columns([2,1,1]); d=c1.selectbox("Disp", sh, key="n"); r=c2.selectbox("Rol", ROLE_OPTIONS, format_func=lambda x:ROLE_LABELS[x], key="rn")
                    c3.write("");
                    if c3.button("Guardar"): roles_db[d]=r; save_roles(roles_db); st.rerun()
            else: st.success("🎉 Todo clasificado.")
            st.markdown("---")
            with st.expander(f"📚 Ver Clasificados ({len(knw)})"):
                if knw:
                    c1,c2,c3=st.columns([2,1,1]); d=c1.selectbox("Editar", knw, format_func=lambda x:f"{x} ({roles_db.get(x)})", key="e")
                    if d:
                        idx=ROLE_OPTIONS.index(roles_db.get(d)) if roles_db.get(d) in ROLE_OPTIONS else 0
                        r=c2.selectbox("Nuevo", ROLE_OPTIONS, index=idx, format_func=lambda x:ROLE_LABELS[x], key="re")
                        c3.write("");
                        if c3.button("Actualizar"): roles_db[d]=r; save_roles(roles_db); st.rerun()
        except Exception as e:
            if str(e) == "__stop__": raise e
            st.error(f"Error inventario: {e}")

elif mode == "🔭 Explorador de Datos":
    if sel_tenant:
        st.title(f"🔭 Explorador: {sn}")

        # COLUMNAS ESTILIZADAS CON FONDO OSCURO
        col1, col2 = st.columns([1, 2], gap="medium")
        with col1:
            st.markdown("### 1. Ubicación")
            cl_influx = st.selectbox("Cliente", get_discovery_options(sel_tenant, "clients"))
            if cl_influx:
                sites = get_discovery_options(sel_tenant, "sites", parent=cl_influx)
                site = st.selectbox("Instalación", sites)
                sel_serial = None
                if site:
                    try:
                        serials = get_discovery_options(sel_tenant, "serials", parent=cl_influx, site=site)
                        if serials:
                            s_raw = st.selectbox("Serial (Opcional)", ["-- TODOS --"] + serials)
                            if s_raw != "-- TODOS --": sel_serial = s_raw
                    except: pass
        with col2:
            st.markdown("### 2. Equipos")
            if cl_influx and site:
                devices = get_discovery_options(sel_tenant, "devices", parent=cl_influx, site=site, serial=sel_serial)
                ms_key = f"s_{sel_tenant.get('org')}_{site}_{sel_serial}"
                if ms_key not in st.session_state:
                    st.session_state[ms_key] = [d for d in devices if 'GENERAL' in d.upper() or 'TOTAL' in d.upper()]

                def f_all(): st.session_state[ms_key] = devices
                def f_none(): st.session_state[ms_key] = []
                def f_gen(): st.session_state[ms_key] = [d for d in devices if 'GENERAL' in d.upper()]

                cb1, cb2, cb3, _ = st.columns([0.2, 0.2, 0.2, 0.4])
                cb1.button("Todos", on_click=f_all, key=f"ba_{ms_key}")
                cb2.button("Nada", on_click=f_none, key=f"bn_{ms_key}")
                cb3.button("General", on_click=f_gen, key=f"bg_{ms_key}")

                sel_devs = st.multiselect("Selección:", devices, key=ms_key, label_visibility="collapsed")
                if not sel_devs: st.warning("Selecciona al menos un equipo.")

        st.markdown("<br>", unsafe_allow_html=True)

        with st.container():
            st.markdown("### 3. Parámetros del Informe")
            c_dates, c_cost, c_act = st.columns([2, 1, 1], gap="medium")
            range_flux = "7d"
            with c_dates:
                date_mode = st.radio("Rango", ["⚡ Últimos Días", "📅 Mes Completo", "📆 Personalizado"], horizontal=True, label_visibility="collapsed")
                if date_mode == "⚡ Últimos Días":
                    bd = st.slider("Días atrás", 1, 90, 7)
                    range_flux = f"{bd}d"
                elif date_mode == "📅 Mes Completo":
                    today = date.today().replace(day=1); opts = []
                    m_map = {"January":"Enero","February":"Febrero","March":"Marzo","April":"Abril","May":"Mayo","June":"Junio","July":"Julio","August":"Agosto","September":"Septiembre","October":"Octubre","November":"Noviembre","December":"Diciembre"}
                    for i in range(12):
                        dt = pd.Timestamp(today)-pd.DateOffset(months=i)
                        lbl = dt.strftime(f"%Y - {m_map.get(dt.strftime('%B'), dt.strftime('%B'))}")
                        val = f"start: {dt.strftime('%Y-%m-%dT00:00:00Z')}, stop: {(dt+pd.DateOffset(months=1)).strftime('%Y-%m-%dT00:00:00Z')}"
                        opts.append((lbl, val))
                    sel = st.selectbox("Mes", [o[0] for o in opts])
                    range_flux = next(o[1] for o in opts if o[0] == sel)
                else:
                    s = st.date_input("Inicio", value=date.today()-timedelta(days=7)); e = st.date_input("Fin", value=date.today())
                    if s and e: range_flux = f"start: {s.strftime('%Y-%m-%dT00:00:00Z')}, stop: {(e+timedelta(days=1)).strftime('%Y-%m-%dT00:00:00Z')}"
            with c_cost:
                price = st.number_input("Coste (€/kWh)", 0.0, 10.0, 0.14)
                debug_mode = st.checkbox("Debug")
                max_workers = st.slider("Workers", min_value=1, max_value=6, value=4, help="Tuning recomendado BeaglePlay: 4-6")
                force_recalculate = st.checkbox("Forzar recalcular", value=False)
            with c_act:
                st.markdown("<br>", unsafe_allow_html=True)
                start = st.button("🚀 GENERAR", type="primary", disabled=(not range_flux))
                if st.button("♻️ Limpiar caché informe", use_container_width=True):
                    st.session_state.pop("analysis_cache", None)
                    st.success("Caché de informes limpiada")

        if start:
             with st.status("Procesando...", expanded=True) as status:
                def up(m, p): status.update(label=f"{m} ({int(p*100)}%)", state="running")
                pdf = run_analysis_discovery(sel_tenant, cl_influx, site, sel_devs, range_flux, price, up, serial=sel_serial, debug_mode=debug_mode, max_workers=max_workers, force_recalculate=force_recalculate)
                if pdf and os.path.exists(pdf):
                    status.update(label="✅ **¡Listo!**", state="complete", expanded=False)
                    with open(pdf, "rb") as f:
                        b64 = base64.b64encode(f.read()).decode()
                        st.markdown(f'''<div style="text-align: center; margin-top: 20px;"><a href="data:application/pdf;base64,{b64}" download="{os.path.basename(pdf)}" style="text-decoration: none;"><button style="background: linear-gradient(90deg, #10B981 0%, #059669 100%); color: white; border: none; padding: 15px 30px; font-size: 1.2rem; font-weight: bold; border-radius: 50px; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); cursor: pointer;">📥 DESCARGAR PDF</button></a></div>''', unsafe_allow_html=True)
                else:
                    if not debug_mode: st.error("❌ Error.")
                    status.update(label="❌ Error", state="error")

        if debug_mode:
            timings = st.session_state.get("last_analysis_timings", {})
            if timings:
                st.markdown("### ⏱️ Timings")
                st.json(timings)
