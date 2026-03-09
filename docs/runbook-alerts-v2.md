# Runbook Alertas v2

## Flujo UI guiado
1. Ir a `/alertas`.
2. Pegar token admin y pulsar **Cargar**.
3. En formulario de regla, seleccionar en orden:
   - Tenant
   - Client
   - Site
   - Serial (opcional)
   - Devices (multiselección)
4. Confirmar resumen de scope (chips + número de devices).

## Crear regla v2
1. Definir nombre, tipo y severidad.
2. Elegir modo de regla:
   - `per_device`: genera evento por cada device afectado.
   - `grouped`: genera 1 evento con lista `affected[]`.
3. Configurar notificaciones:
   - Emails CSV directos
   - Grupo Cliente (CSV)
   - Grupo Mantenimiento (CSV)
   - Webhook URL opcional
   - triggerMode (`edge`/`level`) y `cooldownMinutes`

## Ejecutar y validar
1. Crear regla `battery_low_any` con `threshold=20`.
2. Ejecutar **Ejecutar evaluación ahora**.
3. Revisar pestaña **Eventos**:
   - severidad y mensaje
   - scope tenant/client/site
   - lista de afectados
4. Revisar pestaña **Estado**:
   - `lastRunAt`
   - `avgEvalMs`
   - `rulesEvaluated`

## Ejemplo: 10 contadores de pulsos en batería
- Escenario: 10 dispositivos con batería.
- Regla `battery_low_any`:
  - `grouped`: dispara si cualquiera cae bajo umbral; 1 evento con afectados.
  - `per_device`: dispara eventos individuales por cada equipo bajo umbral.
- Regla `battery_low_all`:
  - `grouped`: dispara solo si los 10 están bajo umbral; 1 evento.
  - `per_device`: si se cumple condición global, genera evento por cada equipo.

## Notificaciones fase 1
- Email: solo vista previa segura (no envío), se registra en `event.debug.deliveryPreview`.
- Webhook: POST JSON con payload `{ rule, event }`, timeout corto, resultado en `event.debug.deliveryPreview`.
