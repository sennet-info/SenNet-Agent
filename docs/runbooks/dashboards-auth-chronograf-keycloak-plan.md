# Estrategia de dashboards + auth (Chronograf + Keycloak + Portal)

## 1) Objetivo funcional

El objetivo es que el usuario final entre al **Portal SenNet** y tenga acceso unificado a:
- Dashboards
- Informes
- Alertas
- Resto de módulos funcionales

La experiencia final debe minimizar cambios de contexto y evitar sensación de "salto" entre aplicaciones.

## 2) Estado actual real (a fecha de hoy)

## Infraestructura disponible

### Beagle principal (Portal + API)
- IP: `192.168.1.51`
- Servicios principales:
  - Portal Next.js
  - `agent_api` (FastAPI)
  - scheduler worker (systemd timer)

### Beagle secundaria (Auth + Dashboards)
- IP: `192.168.1.52`
- Servicios levantados:
  - Keycloak en `:8080`
  - Chronograf en `:8888`

## Validaciones ya logradas
- Keycloak operativo.
- Chronograf operativo.
- Login de Chronograf contra Keycloak validado.
- Arranque automático por systemd para contenedores de Keycloak/Chronograf.

## Lo que todavía NO está cerrado
- Integración final de dashboards dentro del portal principal.
- SSO completo Portal + Keycloak + Chronograf de extremo a extremo.
- Modelo RBAC definitivo por tenant/cliente/dispositivo.

## 3) Arquitectura objetivo (visión)

## Componentes y rol
- **Portal**: experiencia principal de usuario (cara visible del producto).
- **Keycloak**: autenticación y federación central.
- **Chronograf**: motor de dashboards y visualización.
- **InfluxDB**: fuente de datos de series temporales.

## Patrón de integración propuesto
1. El usuario accede al Portal como punto único.
2. El Portal ofrece módulo de dashboards integrado (embebido o servido bajo mismo dominio/base path).
3. Nginx/reverse proxy publica Chronograf bajo ruta controlada del portal.
4. El login evoluciona a SSO real centralizado en Keycloak.

## Principios UX/Security
- Evitar que el usuario final tenga que navegar directamente a Keycloak.
- Gestión de usuarios y operaciones IAM bajo control de SenNet/producción.
- Integración con apariencia unificada y navegación coherente.

## 4) Decisiones tomadas vs pendientes

## Decisiones tomadas
- Keycloak será el sistema central de autenticación.
- Chronograf será el motor de dashboards.
- El Portal será la interfaz principal para el usuario.
- Se usará estrategia de reverse proxy para acercar integración bajo misma base de acceso.
- Dashboards/alertas/informes deberán poder ser gestionados por cliente final según permisos.

## Decisiones pendientes
- Mecanismo final de integración visual (iframe controlado, proxy completo, o combinación).
- Definición completa de RBAC por tenant/cliente/dispositivo.
- Política de aprovisionamiento y ciclo de vida de usuarios/roles.
- Estrategia de auditoría de acceso y trazabilidad multi-tenant.

## 5) Fases recomendadas de implementación

## Fase 1 (actual, parcialmente completada)
- Infra de Keycloak y Chronograf levantada y validada.
- Primeras pruebas de autenticación entre ambos.

## Fase 2 (integración técnica)
- Publicar Chronograf tras reverse proxy controlado.
- Alinear dominios/cookies/cabeceras para reducir fricción de sesión.
- Integrar acceso desde Portal con navegación coherente.

## Fase 3 (SSO + permisos)
- Cerrar flujo de SSO real extremo a extremo.
- Implementar RBAC por tenant/cliente/dispositivo.
- Definir gobierno de permisos para dashboards, alertas e informes.

## Fase 4 (operación y endurecimiento)
- Observabilidad de auth y dashboards (logs, métricas, alertas).
- Endurecimiento de cabeceras/proxy y políticas de sesión.
- Runbooks de soporte y resolución de incidencias IAM/dashboards.

## 6) Riesgos y mitigaciones

- **Riesgo**: integración incompleta de sesión entre Portal y Chronograf.
  - **Mitigación**: pruebas por etapas con reverse proxy y validación de cookies/samesite/domains.
- **Riesgo**: RBAC insuficiente para escenarios multi-tenant.
  - **Mitigación**: modelado formal de roles/alcances antes de habilitar autogestión masiva.
- **Riesgo**: percepción de múltiples aplicaciones desconectadas.
  - **Mitigación**: unificar navegación, branding, rutas y comportamiento de login/logout.

## 7) Qué está estable y qué sigue en desarrollo

## Estable
- Plataforma principal de API + portal + scheduler en Beagle principal.
- Stack de auth/dashboards inicial (Keycloak + Chronograf) levantado en Beagle secundaria.
- Integración inicial Chronograf↔Keycloak validada.

## En desarrollo
- Integración completa del módulo dashboards dentro del Portal SenNet.
- SSO completo y transparente para usuario final.
- Modelo RBAC final orientado a tenants/clientes/dispositivos.

## 8) Criterios de “listo para producción” de dashboards (objetivo)

Se considerará cerrado cuando, como mínimo:
1. El acceso a dashboards se haga desde Portal sin ruptura de experiencia.
2. El flujo de autenticación esté centralizado y validado con Keycloak.
3. Exista RBAC formal para segmentación por tenant/cliente/dispositivo.
4. Existan runbooks operativos para incidencias de login/permisos/proxy.
5. Se validen pruebas de regresión funcional y de seguridad en integración.

## 9) Referencias cruzadas
- Ver también: `docs/runbooks/beagle-storage-hardening-docker-vps.md`
- Ver también: `docs/runbook-api-portal.md`
- Ver también: `docs/DEPLOY_BEAGLEPLAY.md`
