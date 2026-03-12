# SenNet-Agent

## Variables de entorno

```bash
export AGENT_ADMIN_TOKEN='cambia-este-token'
export PORTAL_AGENT_API_BASE='http://127.0.0.1:8000'
```

> En portal detrás de nginx, `PORTAL_AGENT_API_BASE` puede quedar en `/api/agent`.

## FastAPI quickstart

```bash
uvicorn agent_api.main:app --host 0.0.0.0 --port 8000
```

## Curl de validación

### Públicos

```bash
curl -s http://127.0.0.1:8000/v1/health
curl -s 'http://127.0.0.1:8000/v1/discovery/clients?tenant=<tenant>'
curl -s 'http://127.0.0.1:8000/v1/discovery/sites?tenant=<tenant>&client=<client>'
curl -s 'http://127.0.0.1:8000/v1/discovery/serials?tenant=<tenant>&client=<client>&site=<site>'
curl -s 'http://127.0.0.1:8000/v1/discovery/devices?tenant=<tenant>&client=<client>&site=<site>'
```

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

```bash
curl -L 'http://127.0.0.1:8000/v1/reports/download?path=<pdf_path>' -o reporte.pdf
```

### Debug demo-friendly (reportes)

Activa `debug=true` para generar el PDF y un `debug.json` correlacionado en `app/output`.

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

La respuesta incluye `debug_path` y, cuando el payload es pequeño, también `debug` inline. El `debug.json` contiene:

- inputs efectivos usados para la consulta,
- rango resuelto (start/stop/timezone),
- query proof (sha256 + snippet truncado),
- data proof (series/puntos + first/last ts),
- sample rows,
- timings en ms.

Descarga del artefacto:

```bash
curl -L 'http://127.0.0.1:8000/v1/reports/download-debug?path=<debug_path>' -o debug.json
```

Verifica existencia local (si ejecutas API en este repo):

```bash
test -f app/output/<archivo>.debug.json && echo "debug.json OK"
```

### Admin (Bearer token)

```bash
curl -s http://127.0.0.1:8000/v1/admin/tenants \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN"
```

```bash
curl -s -X PUT http://127.0.0.1:8000/v1/admin/tenants/demo \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"url":"http://localhost:8086","token":"abc","org":"main","bucket":"raw"}'
```

```bash
curl -s -X DELETE http://127.0.0.1:8000/v1/admin/tenants/demo \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN"
```

```bash
curl -s http://127.0.0.1:8000/v1/admin/roles \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN"
```

```bash
curl -s -X PUT http://127.0.0.1:8000/v1/admin/roles/DEVICE_001 \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"role":"consumption"}'
```

```bash
curl -s -X DELETE http://127.0.0.1:8000/v1/admin/roles/DEVICE_001 \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN"
```

## Portal Next.js (UI nativa)

Rutas nuevas:

- `/conexiones`
- `/inventario`
- `/informes`

En `/informes` puedes activar el toggle **Debug** antes de "Generar" para enviar `debug=true`, renderizar el panel de evidencia y habilitar el botón **Descargar debug.json**.
En `/programador` (Tareas activas) existe además **Ejecutar con debug**, que ejecuta `run` con `debug=true` y muestra panel inline + botón **Descargar debug.json** de la última ejecución.

Smoke test API:

```bash
python scripts/smoke_test_api.py --base-url http://127.0.0.1:8000 --tenant <tenant> --admin-token "$AGENT_ADMIN_TOKEN"
```

## Scheduler API (`/v1/scheduler/*`)

Persistencia (fuente de verdad operativa del scheduler FastAPI):

- `SCHEDULED_TASKS_PATH` (default `/opt/sennet-agent/scheduled_tasks.json`)
- `SMTP_CONFIG_PATH` (default `/opt/sennet-agent/smtp_config.json`)

Los endpoints de escritura (`POST/PUT/DELETE/run` y SMTP `PUT/test`) requieren `Authorization: Bearer $AGENT_ADMIN_TOKEN`.

- `GET /v1/scheduler/tasks`: lista tareas (sin secretos).
- `POST /v1/scheduler/tasks`: crea tarea.
- `PUT /v1/scheduler/tasks/{task_id}`: actualiza o habilita/deshabilita.
- `DELETE /v1/scheduler/tasks/{task_id}`: elimina tarea.
- `POST /v1/scheduler/tasks/{task_id}/run`: ejecuta tarea completa (resuelve rango/alcance/precio, genera PDF y envía email).
  - La respuesta incluye `sender_path=fastapi_scheduler` para evidenciar el emisor real.
- `POST /v1/scheduler/tasks/{task_id}/debug`: ejecuta en modo depuración (genera PDF+debug, **sin enviar email**).
- `POST /v1/scheduler/run-due`: ejecuta únicamente tareas vencidas (usado por el worker systemd FastAPI-only).
- `GET /v1/scheduler/smtp`: devuelve SMTP con password enmascarado.
- `PUT /v1/scheduler/smtp`: guarda SMTP (`password` vacío mantiene el actual).
- `POST /v1/scheduler/smtp/test`: correo de prueba.

### Curl de ejemplo (scheduler)

```bash
curl -s http://127.0.0.1:8000/v1/scheduler/tasks \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN"
```

```bash
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
```

```bash
curl -s -X PUT http://127.0.0.1:8000/v1/scheduler/smtp \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"server":"smtp.mail.com","port":587,"user":"bot@mail.com","password":""}'
```

Smoke test scheduler:

```bash
python scripts/smoke_test_scheduler_api.py \
  --base-url http://127.0.0.1:8000 \
  --admin-token "$AGENT_ADMIN_TOKEN" \
  --tenant <tenant> --client <client> --site <site> --device <device> --email test@example.com
```

### Nota de operación (FastAPI-only)

- El flujo productivo de informes/scheduler es único: **Portal Next.js + FastAPI**.
- Las tareas automáticas se ejecutan por `sennet-scheduler-worker.timer` ejecutando `agent_api/scheduler_worker.py`, que dispara internamente `POST /v1/scheduler/run-due` (y este usa el mismo flujo de `run` por tarea). Para depurar una tarea aislada usa `/v1/scheduler/tasks/{task_id}/debug` y comparte el `debug_path` generado.
- `SCHEDULED_TASKS_PATH` y `SMTP_CONFIG_PATH` son persistencia del scheduler FastAPI (no compartida con ejecutores legacy).
- El envío de email de tareas se hace una sola vez en `scheduler_run_task` con plantilla HTML profesional.
- El debug del scheduler incluye `device_debug` por dispositivo (columnas energéticas detectadas/seleccionadas, energía total, coste, KPIs) y trazabilidad PDF generado vs PDF adjuntado (`same_generated_and_emailed`).

### Servicios recomendados en producción

```bash
sudo systemctl enable --now sennet-agent-api.service
sudo systemctl enable --now sennet-scheduler-worker.timer
sudo systemctl enable --now sennet-portal.service
```

Desactivar legado (evita doble envío):

```bash
sudo systemctl disable --now sennet-agent.service || true
sudo rm -f /etc/cron.d/sennet-agent
```

### Verificación anti-emisor legacy (host)

```bash
systemctl is-active sennet-agent-api.service
systemctl is-enabled sennet-scheduler-worker.timer
systemctl cat sennet-scheduler-worker.service | rg 'agent_api.scheduler_worker'
systemctl is-active sennet-agent.service || true
test ! -f /etc/cron.d/sennet-agent && echo 'cron legacy ausente'
```

Si recibes un correo incorrecto tras desplegar, casi siempre indica que el host aún no está actualizado o mantiene un servicio/cron legacy fuera de esta rama.
