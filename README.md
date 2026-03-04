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

Smoke test API:

```bash
python scripts/smoke_test_api.py --base-url http://127.0.0.1:8000 --tenant <tenant> --admin-token "$AGENT_ADMIN_TOKEN"
```
