import json
import os
import uuid
from datetime import datetime

# RUTA DE DATOS CORREGIDA PARA CRON (Ruta absoluta dinamica)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TASKS_FILE = os.path.join(BASE_DIR, "scheduled_tasks.json")

class SchedulerLogic:
    @staticmethod
    def load_tasks():
        if os.path.exists(TASKS_FILE):
            with open(TASKS_FILE, 'r') as f: return json.load(f)
        return []

    @staticmethod
    def save_tasks(tasks):
        with open(TASKS_FILE, 'w') as f: json.dump(tasks, f, indent=2)

    @staticmethod
    def add_task(tenant_alias, client, site, device, frequency, time, emails):
        tasks = SchedulerLogic.load_tasks()
        task = {
            "id": str(uuid.uuid4()),
            "tenant_alias": tenant_alias,
            "client": client,
            "site": site,
            "device": device,
            "frequency": frequency, 
            "time": time, 
            "emails": emails,
            "last_run": None,
            "created_at": datetime.now().isoformat()
        }
        tasks.append(task)
        SchedulerLogic.save_tasks(tasks)
        return task

    @staticmethod
    def remove_task(task_id):
        tasks = SchedulerLogic.load_tasks()
        new_tasks = [t for t in tasks if t['id'] != task_id]
        SchedulerLogic.save_tasks(new_tasks)

    @staticmethod
    def should_run(task):
        now = datetime.now()
        task_time_obj = datetime.strptime(task['time'], "%H:%M")
        # Creamos un objeto datetime para la ejecución de HOY a esa hora
        scheduled_today = now.replace(hour=task_time_obj.hour, minute=task_time_obj.minute, second=0, microsecond=0)
        
        # 1. Comprobar si ya pasó la hora (o es la hora exacta)
        if now < scheduled_today:
            return False

        # 2. Comprobar si ya se ejecutó hoy
        last_run_str = task.get('last_run')
        if last_run_str:
            last_run = datetime.fromisoformat(last_run_str)
            if last_run.date() >= now.date(): # Ya se ejecutó hoy o después (seguridad)
                return False

        # 3. Margen de seguridad: Solo ejecutar si estamos dentro de la hora programada 
        # (para evitar que una tarea de las 08:00 se ejecute a las 15:00 si se reinicia el sistema)
        # Ponemos un margen de 10 minutos
        diff_minutes = (now - scheduled_today).total_seconds() / 60
        if diff_minutes > 10:
            return False

        return True

    @staticmethod
    def update_last_run(task_id):
        tasks = SchedulerLogic.load_tasks()
        for t in tasks:
            if t['id'] == task_id:
                t['last_run'] = datetime.now().isoformat()
        SchedulerLogic.save_tasks(tasks)
