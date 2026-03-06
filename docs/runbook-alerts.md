# Runbook Alertas (Portal SenNet)

## Componentes
- UI + API: `portal` (Next.js, módulo `/alertas` y rutas `/api/alerts/*`).
- Persistencia JSON con lock/atomic write en `ALERTS_DATA_DIR` (default `/opt/sennet-agent/alerts`).
- Worker externo: `scripts/run_alerts_worker.py` para ejecutar evaluación periódica sin navegador.

## Archivos de estado
- `alerts_rules.json`: reglas.
- `alerts_events.json`: eventos históricos.
- `alerts_state.json`: salud del motor y métricas.

## Comprobaciones rápidas
```bash
cd /home/debian/sennet-portal/portal
npm run build
sudo systemctl restart sennet-portal.service
journalctl -u sennet-portal.service -n 200 --no-pager
```

## Ver reglas/eventos/estado por API
```bash
export TOKEN="<admin_token>"
export PORTAL="http://127.0.0.1:3000"

curl -s -H "Authorization: Bearer $TOKEN" "$PORTAL/api/alerts/rules" | jq .
curl -s -H "Authorization: Bearer $TOKEN" "$PORTAL/api/alerts/events" | jq .
curl -s -H "Authorization: Bearer $TOKEN" "$PORTAL/api/alerts/status" | jq .
```

## Ejecutar evaluación manual
```bash
curl -X POST -s -H "Authorization: Bearer $TOKEN" "$PORTAL/api/alerts/run" | jq .
```

## Worker con cron o systemd timer
Ejemplo cron cada minuto:
```bash
* * * * * SENNET_PORTAL_BASE=http://127.0.0.1:3000 SENNET_ADMIN_TOKEN=<token> /opt/sennet-agent/venv/bin/python /opt/sennet-agent/repo/scripts/run_alerts_worker.py >> /var/log/sennet-alerts.log 2>&1
```

Ejemplo systemd (recomendado):
- Service: ejecuta `run_alerts_worker.py` con `Environment=SENNET_ADMIN_TOKEN=...`.
- Timer: `OnCalendar=*-*-* *:*:00`.

## Depurar fallos de consulta/evaluación
1. Revisar pestaña **Estado** (`lastError`, `engineStatus`).
2. Ejecutar test manual de regla desde pestaña **Reglas**.
3. Revisar logs del portal:
```bash
journalctl -u sennet-portal.service -n 200 --no-pager
```
4. Verificar token admin y conectividad al API del agente (`/v1/admin/tenants`).

## Nota MVP
El motor actual incluye evaluación robusta de `heartbeat`, `threshold/daily_sum`, `battery_low/battery_low_all` con soporte de datos mock para validación; la integración de consulta Influx puede extenderse sin cambiar el contrato de reglas/eventos.
