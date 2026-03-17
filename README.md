# SenNet-Agent

Sistema IoT de monitoreo y reporting energético. Genera informes PDF automáticos con datos de InfluxDB y los envía por email según tareas programadas.

## Arquitectura
```
InfluxDB (cloud) ←→ FastAPI (puerto 8000) ←→ Portal Next.js (puerto 3000)
                           ↑
                  systemd timer (cada minuto)
                  scheduler_worker.py
```

- **FastAPI** (`agent_api/`) — API REST, generación de PDFs, scheduler, administración
- **Portal Next.js** (`portal/`) — UI web, informes, programador, alertas, inventario
- **InfluxDB** — fuente de datos de medidores energéticos
- **systemd** — gestiona los tres servicios y el timer del scheduler

## Requisitos

- Linux con systemd (probado en BeaglePlay, Debian ARM64)
- Python 3.9+
- Node.js 20 LTS
- Acceso a una instancia de InfluxDB con datos

## Estructura del repo
```
agent_api/          API FastAPI (entry point: main.py)
app/
  core/             Discovery y generación de reportes
  modules/          Analyzer, PDF, email, scheduler legacy
  output/           PDFs generados (no se commitea)
portal/             Frontend Next.js
scripts/            Deploy, smoke tests, validación
systemd/            Units y overrides de ejemplo
docs/               Runbooks operacionales
Makefile            Comandos de test locales
env.example         Plantilla de variables de entorno
```

## Deploy en BeaglePlay desde cero

### 1. Clonar el repo
```bash
git clone https://github.com/sennet-info/SenNet-Agent.git /opt/sennet-agent/repo
cd /opt/sennet-agent/repo
```

### 2. Crear el virtualenv e instalar dependencias
```bash
python3 -m venv /opt/sennet-agent/venv
/opt/sennet-agent/venv/bin/pip install --upgrade pip
/opt/sennet-agent/venv/bin/pip install -r requirements.txt
```

### 3. Configurar variables de entorno
```bash
cp env.example /opt/sennet-agent/env
chmod 600 /opt/sennet-agent/env
# Editar con el token real:
nano /opt/sennet-agent/env
```

Contenido mínimo de `/opt/sennet-agent/env`:
```
AGENT_ADMIN_TOKEN=tu-token-aqui
AGENT_BASE_URL=http://127.0.0.1:8000
```

### 4. Instalar servicios systemd
```bash
sudo cp systemd/sennet-agent-api.service /etc/systemd/system/
sudo cp systemd/sennet-scheduler-worker.service /etc/systemd/system/
sudo cp systemd/sennet-scheduler-worker.timer /etc/systemd/system/
sudo cp systemd/sennet-portal.service /etc/systemd/system/
sudo systemctl daemon-reload
```

### 5. Crear overrides para BeaglePlay (usuario debian)

La API:
```bash
sudo mkdir -p /etc/systemd/system/sennet-agent-api.service.d/
sudo cp systemd/overrides/sennet-agent-api.override.conf.example \
  /etc/systemd/system/sennet-agent-api.service.d/override.conf
# Editar AGENT_ADMIN_TOKEN con el token real
sudo nano /etc/systemd/system/sennet-agent-api.service.d/override.conf
```

El scheduler worker:
```bash
sudo mkdir -p /etc/systemd/system/sennet-scheduler-worker.service.d/
sudo cp systemd/overrides/sennet-scheduler-worker.override.conf.example \
  /etc/systemd/system/sennet-scheduler-worker.service.d/override.conf
```

### 6. Arrancar servicios
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sennet-agent-api.service
sudo systemctl enable --now sennet-scheduler-worker.timer
sudo systemctl enable --now sennet-portal.service
```

### 7. Construir el portal Next.js
```bash
cd /home/debian/sennet-portal/portal
./scripts/build_standalone.sh
sudo systemctl restart sennet-portal.service
```

### 8. Verificar
```bash
systemctl is-active sennet-agent-api.service
systemctl is-active sennet-scheduler-worker.timer
systemctl is-active sennet-portal.service
curl -s http://127.0.0.1:8000/v1/health
```

## Configurar un tenant (conexión InfluxDB)
```bash
curl -s -X PUT http://127.0.0.1:8000/v1/admin/tenants/mi-tenant \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "url":"https://tu-influx-url",
    "token":"tu-influx-token",
    "org":"tu-org",
    "bucket":"tu-bucket"
  }'
```

## Tests locales
```bash
# Validación arquitectura + idempotencia scheduler (no necesita API)
make test-local

# Smoke test completo (necesita API levantada y tenant configurado)
make test-smoke TENANT=mi-tenant
```

## Flujo de trabajo con ramas

Cada cambio sigue este patrón:
```bash
# 1. Crear rama desde main actualizado
git checkout main && git pull origin main
git checkout -b feat/nombre-rama

# 2. Hacer cambios, commit y push
git add .
git commit -m "feat: descripción"
git push origin feat/nombre-rama

# 3. Abrir PR en GitHub, mergear
# https://github.com/sennet-info/SenNet-Agent/compare/feat/nombre-rama

# 4. Limpiar en BeaglePlay tras merge
git checkout main && git pull origin main
git branch -d feat/nombre-rama

# 5. Verificar servicios
systemctl is-active sennet-agent-api.service
systemctl is-active sennet-scheduler-worker.timer
curl -s http://127.0.0.1:8000/v1/health
```

## Variables de entorno
```bash
export AGENT_ADMIN_TOKEN='cambia-este-token'
export PORTAL_AGENT_API_BASE='http://127.0.0.1:8000'
```

> En portal detrás de nginx, `PORTAL_AGENT_API_BASE` puede quedar en `/api/agent`.

## FastAPI quickstart (desarrollo)
```bash
cd /opt/sennet-agent/repo
PYTHONPATH=/opt/sennet-agent/repo:/opt/sennet-agent/repo/app \
  /opt/sennet-agent/venv/bin/uvicorn agent_api.main:app --host 0.0.0.0 --port 8000
```

## API — Endpoints principales

### Health
```bash
curl -s http://127.0.0.1:8000/v1/health
```

### Discovery
```bash
curl -s 'http://127.0.0.1:8000/v1/discovery/clients?tenant=<tenant>'
curl -s 'http://127.0.0.1:8000/v1/discovery/sites?tenant=<tenant>&client=<client>'
curl -s 'http://127.0.0.1:8000/v1/discovery/serials?tenant=<tenant>&client=<client>&site=<site>'
curl -s 'http://127.0.0.1:8000/v1/discovery/devices?tenant=<tenant>&client=<client>&site=<site>'
```

### Generar informe PDF
```bash
curl -s -X POST http://127.0.0.1:8000/v1/reports \
  -H 'content-type: application/json' \
  -d '{
    "tenant":"<tenant>",
    "client":"<client>",
    "site":"<site>",
    "devices":["<device>"],
    "range_flux":"7d",
    "price":0.14
  }'
```

### Generar informe con debug
```bash
curl -s -X POST http://127.0.0.1:8000/v1/reports \
  -H 'content-type: application/json' \
  -d '{
    "tenant":"<tenant>",
    "client":"<client>",
    "site":"<site>",
    "devices":["<device>"],
    "range_flux":"7d",
    "price":0.14,
    "debug":true,
    "debug_sample_n":10
  }'
```

### Descargar PDF
```bash
curl -L 'http://127.0.0.1:8000/v1/reports/download?path=<pdf_path>' -o reporte.pdf
```

### Admin — Tenants
```bash
# Listar
curl -s http://127.0.0.1:8000/v1/admin/tenants \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN"

# Crear/actualizar
curl -s -X PUT http://127.0.0.1:8000/v1/admin/tenants/demo \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"url":"http://localhost:8086","token":"abc","org":"main","bucket":"raw"}'

# Borrar
curl -s -X DELETE http://127.0.0.1:8000/v1/admin/tenants/demo \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN"
```

### Admin — Roles de dispositivos
```bash
curl -s http://127.0.0.1:8000/v1/admin/roles \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN"

curl -s -X PUT http://127.0.0.1:8000/v1/admin/roles/DEVICE_001 \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"role":"consumption"}'
```

## Scheduler API

Persistencia en `/opt/sennet-agent/scheduled_tasks.json` y `/opt/sennet-agent/smtp_config.json`.
```bash
# Listar tareas
curl -s http://127.0.0.1:8000/v1/scheduler/tasks \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN"

# Crear tarea
curl -s -X POST http://127.0.0.1:8000/v1/scheduler/tasks \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "tenant":"<tenant>",
    "client":"<client>",
    "site":"<site>",
    "device":"<device>",
    "frequency":"daily",
    "time":"08:30",
    "report_range_mode":"last_7_days",
    "emails":["ops@example.com"]
  }'

# Ejecutar tarea manualmente
curl -s -X POST http://127.0.0.1:8000/v1/scheduler/tasks/<task_id>/run \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN"

# Configurar SMTP
curl -s -X PUT http://127.0.0.1:8000/v1/scheduler/smtp \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"server":"smtp.mail.com","port":587,"user":"bot@mail.com","password":"secreto"}'
```

### Cómo funciona el scheduler automático

El timer `sennet-scheduler-worker.timer` dispara cada minuto `scheduler_worker.py`, que llama a `POST /v1/scheduler/run-due`. Este endpoint evalúa qué tareas están vencidas (dentro de la ventana ±10 min de su hora programada) y las ejecuta una sola vez gracias al sistema de slots de idempotencia.

### Checklist post-deploy
```bash
systemctl is-active sennet-agent-api.service
systemctl is-active sennet-scheduler-worker.timer
systemctl is-active sennet-portal.service
systemctl list-timers --all | grep sennet
curl -s http://127.0.0.1:8000/v1/health
journalctl -u sennet-scheduler-worker.service -n 20 --no-pager
```

## Portal Next.js

Accesible en `http://<ip>:3000`. Módulos disponibles:

- `/` — Inicio
- `/conexiones` — Gestión de tenants/InfluxDB
- `/inventario` — Roles de dispositivos
- `/informes` — Generación de informes PDF
- `/programador` — Tareas automáticas y SMTP
- `/alertas` — Sistema de alertas (beta)
- `/tarifas-default` — Tarifas energéticas por scope

## Smoke tests
```bash
# API completa
python scripts/smoke_test_api.py \
  --base-url http://127.0.0.1:8000 \
  --tenant <tenant> \
  --admin-token "$AGENT_ADMIN_TOKEN"

# Scheduler completo
python scripts/smoke_test_scheduler_api.py \
  --base-url http://127.0.0.1:8000 \
  --admin-token "$AGENT_ADMIN_TOKEN" \
  --tenant <tenant> --client <client> --site <site> --device <device> \
  --email test@example.com
```
