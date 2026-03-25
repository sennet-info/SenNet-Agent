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

---

## Changelog reciente (Marzo 2026)

### Nuevas funcionalidades en informes PDF (`report_options`)

Las siguientes opciones están disponibles tanto en generación manual (portal `/informes`) como en tareas programadas (`/programador`):

| Opción | Por defecto | Descripción |
|--------|-------------|-------------|
| `show_profile` | ✅ | Perfil horario promedio del período |
| `show_summary` | ✅ | Tabla resumen con tendencias y comparativa |
| `show_prev` | ❌ | Barras comparativas con mes anterior |
| `show_heatmap` | ❌ | Heatmap semanal hora×día (lento en ARM64) |
| `show_cumulative` | ❌ | Línea de consumo acumulado del mes |
| `show_top_days` | ❌ | Ranking top 7 días de mayor consumo |

### Fixes aplicados
- Página en blanco al inicio del PDF — corregido con `section-intro` block
- Leyenda del gráfico de barras solapada — movida encima del plot (`bbox_to_anchor`)
- Tendencia en tabla resumen ahora muestra el mes de referencia (ej. "▼ -45.9% vs Enero 2026")
- Conexiones (Tenants) fallaban por puerto incorrecto — corregido a 8000 en `.env`

### Timeouts
- Generación manual: `REPORT_TIMEOUT_SECONDS = 480`
- Tareas programadas: `SCHEDULER_RUN_TIMEOUT_SECONDS = 600`

### Notas de operación
- El heatmap tarda ~3-4 min en ARM64. Mantener como opt-in.
- **No usar `python3 - << EOF`** para editar archivos — vacía el archivo si falla a mitad.
- **PuTTY**: el clic derecho pega en lugar de copiar. Seleccionar texto = copiar automáticamente.
- El portal necesita rebuild (`build_standalone.sh`) solo cuando cambia código TypeScript/React.
- Los cambios en Python (API, módulos) solo requieren `systemctl restart sennet-agent-api.service`.

---

## Deploy en VPS (producción recomendada)

El sistema está diseñado para correr en BeaglePlay ARM64 como entorno de desarrollo/pruebas, pero el destino final es una VPS con más recursos. En VPS:

- La generación de PDFs con heatmap pasa de ~3-4 min a ~15-30 segundos
- Los timeouts pueden reducirse: `REPORT_TIMEOUT_SECONDS = 120`, `SCHEDULER_RUN_TIMEOUT_SECONDS = 180`
- Se puede aumentar `max_workers` en las tareas para procesar más dispositivos en paralelo

### Requisitos recomendados para VPS
- Ubuntu 22.04 / Debian 12 LTS, x86_64
- 2 vCPU mínimo (4 recomendado)
- 4 GB RAM mínimo (8 recomendado)
- 20 GB disco SSD
- Python 3.10+, Node.js 20 LTS
- Puerto 3000 (portal) y 8000 (API) accesibles o detrás de nginx

### Diferencias respecto a BeaglePlay

| Aspecto | BeaglePlay ARM64 | VPS x86_64 |
|---------|-----------------|------------|
| Generación PDF sin heatmap | ~30-60s | ~5-10s |
| Generación PDF con heatmap | ~3-4 min | ~15-30s |
| `REPORT_TIMEOUT_SECONDS` | 480 | 120 |
| `SCHEDULER_RUN_TIMEOUT_SECONDS` | 600 | 180 |
| `max_workers` recomendado | 2-4 | 4-8 |
| Heatmap como opt-in | Sí (lento) | Opcional (rápido) |

### Pasos de instalación en VPS (desde cero)
```bash
# 1. Dependencias del sistema
apt update && apt install -y python3 python3-venv python3-pip nodejs npm git \
  libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libgdk-pixbuf2.0-0 \
  libffi-dev shared-mime-info

# 2. Clonar repo
git clone https://github.com/sennet-info/SenNet-Agent.git /opt/sennet-agent/repo
cd /opt/sennet-agent/repo

# 3. Virtualenv Python
python3 -m venv /opt/sennet-agent/venv
/opt/sennet-agent/venv/bin/pip install --upgrade pip
/opt/sennet-agent/venv/bin/pip install -r requirements.txt

# 4. Configurar token admin
mkdir -p /etc/systemd/system/sennet-agent-api.service.d/
cat > /etc/systemd/system/sennet-agent-api.service.d/override.conf << EOF
[Service]
Environment="AGENT_ADMIN_TOKEN=cambia-este-token"
EOF

# 5. Instalar servicios
cp systemd/sennet-agent-api.service /etc/systemd/system/
cp systemd/sennet-scheduler-worker.service /etc/systemd/system/
cp systemd/sennet-scheduler-worker.timer /etc/systemd/system/
cp systemd/sennet-portal.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now sennet-agent-api.service
systemctl enable --now sennet-scheduler-worker.timer

# 6. Construir portal
cd /opt/sennet-agent/repo/portal
npm ci
mkdir -p /opt/sennet-portal/portal
rsync -a --delete --exclude node_modules --exclude .next \
  /opt/sennet-agent/repo/portal/ /opt/sennet-portal/portal/
cat > /opt/sennet-portal/portal/.env << EOF
AGENT_BASE_URL=http://127.0.0.1:8000
EOF
cd /opt/sennet-portal/portal
./scripts/build_standalone.sh
systemctl enable --now sennet-portal.service

# 7. Verificar
curl -s http://127.0.0.1:8000/v1/health
systemctl is-active sennet-agent-api sennet-scheduler-worker.timer sennet-portal
```

### Nginx como proxy inverso (recomendado en VPS)
```nginx
server {
    listen 80;
    server_name tu-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/agent/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_read_timeout 600s;
    }
}
```

Con nginx, el portal usa `AGENT_BASE_URL=http://127.0.0.1:8000` internamente y el cliente accede a `/api/agent/` externamente.

### Ajustar timeouts para VPS en `agent_api/main.py`
```python
REPORT_TIMEOUT_SECONDS = 120
SCHEDULER_RUN_TIMEOUT_SECONDS = 180
```

### Variables de entorno importantes en VPS
```bash
# /etc/systemd/system/sennet-agent-api.service.d/override.conf
AGENT_ADMIN_TOKEN=token-seguro-aqui

# /opt/sennet-portal/portal/.env
AGENT_BASE_URL=http://127.0.0.1:8000
```
