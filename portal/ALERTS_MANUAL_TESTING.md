# Alertas — Guía de validación manual reproducible

Esta guía documenta cómo probar end-to-end el módulo de alertas del portal en modo **mock/testable**.

## Qué es simulación vs ejecución real

- **Validar (simulación)**
  - Botón en `Reglas activas`.
  - Usa el JSON del bloque `Flujo de prueba controlado`.
  - **No persiste eventos** en `alerts_events.json`.
- **Ejecutar evaluación ahora**
  - Botón en pestaña `Estado`.
  - Llama `POST /api/alerts/run`.
  - **Sí puede persistir eventos** en `alerts_events.json`.

## Checklist base (todas las reglas)

1. Crear regla y guardar.
2. Cargar preset **dispara** y ejecutar `Validar (simulación)`.
3. Confirmar en modal: `fired=true`, mensaje y `simulated_events` coherentes.
4. Cargar preset **no dispara** y repetir validación.
5. Ir a `Estado` y pulsar `Ejecutar evaluación ahora`.
6. Confirmar feedback: reglas evaluadas y disparadas.
7. Ir a `Eventos` y revisar eventos persistidos (estado, severidad, affected).
8. Probar operación de evento: ACK, RESOLVED, DELETE.

## Matriz rápida por tipo de regla

- `heartbeat`
  - dispara: `mockLastPointMinutesAgo` > `minutesWithoutData`
  - no dispara: `mockLastPointMinutesAgo` <= `minutesWithoutData`
- `threshold`
  - validar operadores (`gt`, `gte`, `lt`, `lte`, `eq`) con `mockValue`.
- `missing_field`
  - dispara cuando algún row en `mockRows` no trae el `field`.
- `irregular_interval`
  - dispara cuando `mockObservedGapMinutes` > `expectedMinutes + toleranceMinutes`.
- `daily_sum`
  - compara `mockValue` vs `target` con el operador configurado.
- `battery_low`, `battery_low_any`, `battery_low_all`
  - usan `mockBatteries`, validar umbral y diferencia `ANY` vs `ALL`.
  - en `per_device`, verificar transición por equipo: FAIL->OK debe generar recuperación individual.

## Estado funcional actual

- Funcional y operativo: creación/edición/borrado de reglas, validación simulada, ejecución real del motor, persistencia de eventos y acciones ACK/RESOLVED/DELETE.
- Base aún mock/MVP:
  - baterías evaluadas desde `params.mockBatteries`.
  - email en preview (sin entrega real).
  - webhook sí se intenta ejecutar.

## Semántica de recuperación automática

- `per_device`
  - transición independiente por entidad (`deviceId`/`serial`).
  - emite recuperación automática por cada entidad que pasa de FAIL a OK.
- `grouped`
  - transición global de la regla.
  - solo emite recuperación cuando el grupo completo vuelve a OK.

## Caso reproducible A/B (fallo y recuperación escalonada)

1. Configurar una regla `battery_low_any` con dos dispositivos (`A`, `B`) en `per_device`.
2. Run #1: ambos en OK (`A=70`, `B=75`) => sin evento.
3. Run #2: `A` en fallo (`A=10`, `B=75`) => evento fallo de `A`.
4. Run #3: `A` y `B` en fallo (`A=10`, `B=12`) => evento fallo de `B`.
5. Run #4: `A` recupera (`A=70`, `B=12`) => evento recuperación de `A`.
6. Run #5: `B` recupera (`A=70`, `B=75`) => evento recuperación de `B`.

Esperado tras el fix:
- no se pierde la recuperación del segundo dispositivo;
- en `grouped`, solo hay recuperación cuando el grupo completo vuelve a estado sano.
