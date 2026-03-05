# Runbook API + Portal SenNet

## Objetivo
Validar de forma determinística que el backend del agente y su publicación vía NGINX están operativos, sin pruebas "a ciegas".

## Requisitos previos
- Acceso shell al host.
- `curl` instalado.
- Token admin válido (`AGENT_ADMIN_TOKEN`) para endpoints de administración.

```bash
export AGENT_ADMIN_TOKEN="<token_admin>"
```

## Comprobación definitiva (checklist)

### 1) Servicio arriba
**Comando**
```bash
systemctl is-active sennet-agent.service
```
**OK**: devuelve `active`.
**FAIL**: cualquier otro estado (`inactive`, `failed`, etc.).

Opcional para diagnóstico:
```bash
journalctl -u sennet-agent.service -n 200 --no-pager
```

---

### 2) Puerto 8000 escuchando
**Comando**
```bash
ss -ltnp | rg ':8000'
```
**OK**: aparece una línea `LISTEN` en `:8000` asociada al proceso del agente.
**FAIL**: no hay salida o no está en `LISTEN`.

---

### 3) Health local OK
**Comando**
```bash
curl -fsS http://127.0.0.1:8000/v1/health
```
**OK**: respuesta HTTP 200 con JSON válido (por ejemplo `{"ok": true}` o equivalente).
**FAIL**: timeout, error HTTP o JSON inválido.

---

### 4) Admin tenants local OK (con token)
**Comando**
```bash
curl -fsS \
  -H "Authorization: Bearer ${AGENT_ADMIN_TOKEN}" \
  http://127.0.0.1:8000/v1/admin/tenants
```
**OK**: respuesta HTTP 200 con JSON y estructura `items`.
**FAIL**: 401/403 (token), 5xx (backend) o timeout.

---

### 5) Verificación vía NGINX (/api/agent/...)
> Confirma que el proxy público del portal también enruta correctamente al agente.

**Health vía NGINX**
```bash
curl -fsS http://127.0.0.1/api/agent/v1/health
```
**OK**: HTTP 200 y JSON válido.
**FAIL**: 404/502/504 o timeout.

**Admin tenants vía NGINX**
```bash
curl -fsS \
  -H "Authorization: Bearer ${AGENT_ADMIN_TOKEN}" \
  http://127.0.0.1/api/agent/v1/admin/tenants
```
**OK**: HTTP 200 con JSON `items`.
**FAIL**: 401/403 (token), 404/502/504 (proxy), timeout.

---

## Criterio final de aceptación
Sistema **OK** solo si los 5 bloques anteriores cumplen condición OK.
Si cualquier bloque falla, el estado global es **FAIL** y se debe corregir antes de dar por válido el despliegue.

## Comando rápido (resumen)
Ejecuta en orden:

```bash
systemctl is-active sennet-agent.service
ss -ltnp | rg ':8000'
curl -fsS http://127.0.0.1:8000/v1/health
curl -fsS -H "Authorization: Bearer ${AGENT_ADMIN_TOKEN}" http://127.0.0.1:8000/v1/admin/tenants
curl -fsS http://127.0.0.1/api/agent/v1/health
curl -fsS -H "Authorization: Bearer ${AGENT_ADMIN_TOKEN}" http://127.0.0.1/api/agent/v1/admin/tenants
```
