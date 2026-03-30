# Hardening de almacenamiento en BeaglePlay y preparación para Docker/VPS

## 1) Contexto operativo

Este documento deja trazabilidad técnica y operativa del hardening aplicado en la Beagle principal de SenNet-Agent (`192.168.1.51`) y cómo este enfoque prepara el camino para una dockerización futura y un despliegue limpio en VPS.

### Alcance de este documento
- **Incluye**: estado real, cambios ejecutados, rutas críticas, operación diaria y lineamientos de evolución.
- **No incluye**: cambios de lógica de negocio ni migración completa a contenedores.

## 2) Problema detectado

En el módulo Programador (scheduler), al guardar tareas se observaba en frontend:
- `Error inesperado`

El error real en backend fue:
- `OSError: [Errno 28] No space left on device`

### Diagnóstico
La causa raíz fue saturación de espacio en la raíz del sistema (`/`) de la Beagle principal.

## 3) Acciones ejecutadas (hardening aplicado)

Las siguientes acciones se ejecutaron para estabilizar almacenamiento en producción:

1. Limpieza de artefactos no críticos en raíz:
   - eliminado `/opt/sennet-agent/repo_clean`
   - eliminado `/opt/sennet-agent/repo/portal/node_modules`
2. Alta de capa persistente de datos:
   - incorporación de microSD
   - formateo en `ext4`
   - montaje en `/mnt/data`
3. Persistencia de montaje vía `/etc/fstab`:
   - `UUID=d4a0b823-4386-40c9-b437-3bf9e8f81078 /mnt/data ext4 defaults,nofail 0 2`
4. Redirección de crecimiento operativo a `/mnt/data`:
   - reports: `/opt/sennet-agent/repo/app/output` -> `/mnt/data/reports`
   - scheduler: `/opt/sennet-agent/scheduled_tasks.json` -> `/mnt/data/sennet/scheduled_tasks.json`
5. Ajuste de permisos:
   - `chown -R debian:debian /mnt/data`
6. Limpieza automática de reports:
   - script: `/usr/local/bin/cleanup_reports.sh`
   - cron: `0 3 * * * /usr/local/bin/cleanup_reports.sh`

## 4) Estado actual: qué está resuelto y qué sigue en desarrollo

## Resuelto / estable (a fecha de este documento)
- El fallo de guardado de tareas ligado a falta de disco quedó mitigado.
- Se separó crecimiento operativo hacia una capa de datos persistente (`/mnt/data`).
- Se estableció limpieza automática para contener crecimiento de reports.
- Se mejoró resiliencia básica de arranque por `nofail` en `fstab`.

## En desarrollo / pendiente
- Política formal y versionada de retención por tipo de dato (reports, logs, backups).
- Observabilidad de disco con umbrales y alertado proactivo.
- Plan de rollback y recovery documentado para fallos de microSD.
- Homologación de esta estrategia en futuros entornos (VPS/containers) con IaC.

## 5) Rutas críticas y criterios de operación

## Rutas críticas de runtime (Beagle principal)
- Código y runtime principal: `/opt/sennet-agent/repo`
- API FastAPI: `/opt/sennet-agent/repo/agent_api/main.py`
- Worker scheduler: `/opt/sennet-agent/repo/agent_api/scheduler_worker.py`

## Rutas críticas de datos
- Capa persistente: `/mnt/data`
- Reports: `/mnt/data/reports`
- Scheduler tasks persistidas: `/mnt/data/sennet/scheduled_tasks.json`

## Archivos runtime sensibles (no versionables)
- `/opt/sennet-agent/config_tenants.json`
- `/opt/sennet-agent/smtp_config.json`
- `/opt/sennet-agent/scheduled_tasks.json`
- `/opt/sennet-agent/device_roles.json`

## Qué mover y qué NO mover

### Sí mover (o mantener fuera de la raíz del SO)
- Datos de crecimiento continuo (reports, exportaciones, backups operativos).
- Archivos JSON operativos con escrituras frecuentes (scheduler y similares).
- Cualquier caché o artefacto transitorio de alto crecimiento.

### No mover sin plan formal
- Entrypoints y rutas de servicios systemd actualmente productivos.
- Runtime crítico API/worker sin validar dependencias y rutas absolutas.
- Configuraciones de producción sin ventana de cambio y rollback.

## 6) Preparación para futura dockerización (sin romper lo logrado)

Este hardening **no bloquea dockerización**; la facilita.

## Principio objetivo
- **Contenedor = aplicación**
- **Volumen = datos persistentes**

## Traducción práctica de lo actual a contenedores
- `/mnt/data/reports` -> futuro `volume`/`bind mount` de reports
- `/mnt/data/sennet/scheduled_tasks.json` -> futuro `volume`/`bind mount` de estado scheduler
- Configs sensibles (`smtp_config`, tenants, roles) -> secretos/configs inyectados (no imagen)

## Reglas para transición segura
1. No mover runtime crítico adicional hasta tener diseño de compose/manifiestos.
2. Mantener mapeo explícito de rutas persistentes desde fase host hacia volúmenes.
3. Aislar artefactos de build para no inflar filesystem raíz.
4. Definir healthchecks y política de restart equivalente a systemd actual.

## 7) Preparación para despliegue limpio en VPS

Aunque una VPS tenga más recursos, se mantiene la misma disciplina operativa:

1. Separar `app` y `data` desde el día 0.
2. Mantener limpieza/rotación periódica y límites de crecimiento.
3. Incorporar reverse proxy delante de servicios expuestos.
4. Planificar backup de datos persistentes (reports + estado scheduler + configs de negocio).
5. Definir alertas de uso de disco y memoria por umbrales.

## Baseline recomendado en VPS
- `/srv/sennet/app` para aplicación
- `/srv/sennet/data` para persistencia
- `/srv/sennet/backups` para copias operativas

## 8) Checklist operativo mínimo

### Verificación de montaje y capacidad
- `df -h`
- `mount | grep /mnt/data`
- `lsblk -f`

### Verificación de redirecciones críticas
- validar que reports escriben en `/mnt/data/reports`
- validar que scheduler persiste en `/mnt/data/sennet/scheduled_tasks.json`

### Verificación de limpieza automática
- revisar script `/usr/local/bin/cleanup_reports.sh`
- revisar cron activo (`crontab -l` o `/etc/crontab` según implementación)

## 9) Decisiones tomadas vs pendientes

## Decisiones tomadas
- Usar `/mnt/data` como capa persistente principal en Beagle 192.168.1.51.
- Evitar crecimiento operativo en raíz del SO.
- Mantener limpieza automática de artefactos voluminosos.
- Separar explícitamente runtime y datos como base para evolución.

## Decisiones pendientes
- Diseño formal de dockerización por componentes (API, portal, scheduler, auxiliares).
- Política definitiva de retención y purga por tipo de artefacto.
- Estrategia de backup/restore con RPO/RTO definidos.
- Estandarización de despliegue VPS (scripts, compose y/o IaC).

## 10) Referencias cruzadas
- Ver también: `docs/runbooks/dashboards-auth-chronograf-keycloak-plan.md`
- Ver también: `docs/DEPLOY_BEAGLEPLAY.md`
