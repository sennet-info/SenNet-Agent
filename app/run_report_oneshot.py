import os
import json
import traceback
import sys
from datetime import datetime

# Añadimos el directorio actual al path para asegurar imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Importamos nuestros modulos
from modules.scheduler_logic import SchedulerLogic
from modules.email_sender import EmailSender
from modules.report_range import DEFAULT_REPORT_RANGE_MODE, compute_report_range, to_flux_range
from main import run_analysis_discovery

# RUTAS ABSOLUTAS CORREGIDAS PARA CRON
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TENANTS_FILE = os.path.join(BASE_DIR, "config_tenants.json")
SMTP_FILE = os.path.join(BASE_DIR, "smtp_config.json")
CRON_LOG_FILE = os.path.join(BASE_DIR, "cron_log.log")


def log_cron(event, **kwargs):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    details = ' '.join([f"{k}={v}" for k, v in kwargs.items()])
    line = f"[{ts}] {event} {details}\n"
    with open(CRON_LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(line)
    print(line.strip())


def load_tenants():
    if os.path.exists(TENANTS_FILE):
        with open(TENANTS_FILE, 'r') as f:
            return json.load(f)
    return {}


def load_smtp():
    if os.path.exists(SMTP_FILE):
        with open(SMTP_FILE, 'r') as f:
            return json.load(f)
    return {}


def main():
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 🔎 CRON: Buscando tareas...")

    try:
        tasks = SchedulerLogic.load_tasks()
        if not tasks:
            print("   (Sin tareas definidas)")
            return

        tenants = load_tenants()
        smtp_cfg = load_smtp()

        if not smtp_cfg:
            print("   ⚠️ Error: No hay configuración SMTP.")
            return

        sender = EmailSender(
            smtp_cfg.get('server'),
            smtp_cfg.get('port'),
            smtp_cfg.get('user'),
            smtp_cfg.get('password')
        )

        tasks_executed = 0

        for task in tasks:
            claim = SchedulerLogic.claim_execution(task['id'], source="cron")
            if not claim.get('ok'):
                log_cron("TASK_EXECUTE_SKIP_ALREADY_RAN", task_id=task['id'], reason=claim.get('reason'))
                continue

            run_id = claim.get('run_id')
            log_cron("TASK_EXECUTE_START", task_id=task['id'], run_id=run_id)
            print(f"   🚀 Ejecutando: {task['client']} - {task['site']} ({task['frequency']})")

            sent_ok = False
            try:
                tenant_alias = task.get('tenant_alias')
                if not tenant_alias or tenant_alias not in tenants:
                    print(f"      ❌ Error: Conexión '{tenant_alias}' no encontrada en config_tenants.json.")
                    continue

                auth_config = tenants[tenant_alias]
                report_range_mode = task.get('report_range_mode', DEFAULT_REPORT_RANGE_MODE)
                start_dt, end_dt = compute_report_range(report_range_mode)
                range_flux = to_flux_range(start_dt, end_dt)
                devices = [task['device']]
                print(
                    f"      🧭 report_range_mode={report_range_mode} | start={start_dt.isoformat(timespec='seconds')} | end={end_dt.isoformat(timespec='seconds')}"
                )

                print("      📊 Generando Informe PDF...")
                pdf_path = run_analysis_discovery(
                    auth_config=auth_config,
                    client=task['client'],
                    site=task['site'],
                    devices=devices,
                    range_flux=range_flux,
                    callback_status=None,
                    debug_mode=False
                )

                if pdf_path and os.path.exists(pdf_path):
                    print(f"      📄 PDF OK: {os.path.basename(pdf_path)}")
                    subject = f"📊 Informe Energético: {task['site']} ({datetime.now().strftime('%d/%m/%Y')})"
                    body = f"""
                    <html>
                    <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f9; margin: 0; padding: 20px;">
                        <div style="max-width: 600px; margin: auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border: 1px solid #e1e8ed;">
                            <div style="background: linear-gradient(135deg, #EF4444 0%, #B91C1C 100%); padding: 30px; text-align: center; color: white;">
                                <h1 style="margin: 0; font-size: 24px; letter-spacing: 1px;">SenNet Intelligence</h1>
                                <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 14px;">Generación Automática de Informes</p>
                            </div>
                            <div style="padding: 30px; color: #334155; line-height: 1.6;">
                                <h2 style="color: #1e293b; margin-top: 0;">Resumen Semanal de Energía</h2>
                                <p>Hola,</p>
                                <p>Se ha generado un nuevo informe energético para la instalación <strong>{task['site']}</strong> correspondiente al cliente <strong>{task['client']}</strong>.</p>
                                <div style="background-color: #f8fafc; border-left: 4px solid #EF4444; padding: 15px; margin: 20px 0; border-radius: 4px;">
                                    <p style="margin: 0;"><strong>Instalación:</strong> {task['site']}</p>
                                    <p style="margin: 5px 0 0 0;"><strong>Frecuencia:</strong> {task['frequency'].capitalize()}</p>
                                    <p style="margin: 5px 0 0 0;"><strong>Fecha de Generación:</strong> {datetime.now().strftime('%d/%m/%Y %H:%M')}</p>
                                </div>
                                <p>El documento detallado se encuentra adjunto a este mensaje en formato PDF para su revisión.</p>
                            </div>
                        </div>
                    </body>
                    </html>
                    """

                    print(f"      📧 Enviando a: {task['emails']}...")
                    sent_ok, msg = sender.send_email(task['emails'], subject, body, pdf_path)
                    if sent_ok:
                        log_cron("TASK_EMAIL_SENT", task_id=task['id'], run_id=run_id)
                        print("      ✅ Email enviado con éxito.")
                        tasks_executed += 1
                    else:
                        print(f"      ❌ Fallo envío: {msg}")
                else:
                    print("      ⚠️ No se generó archivo PDF.")
            except Exception as e:
                print(f"      🔥 Excepción: {e}")
            finally:
                SchedulerLogic.finish_execution(task['id'], run_id, sent_ok=sent_ok)

        if tasks_executed == 0:
            print("   (Ninguna tarea coincidía con la hora actual)")
        else:
            print(f"   ✅ Total ejecutadas: {tasks_executed}")

    except Exception as e:
        print(f"🔥 Error Global: {e}")
        traceback.print_exc()


if __name__ == "__main__":
    main()
