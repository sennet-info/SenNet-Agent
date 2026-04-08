# Alertas — Guía de validación manual (mock + real)

## 1) Conceptos clave

- **dataSource=mock**: usa `params.mock*` para pruebas/demos controladas.
- **dataSource=real**: usa telemetría real desde backend (`/v1/alerts/device-energy-status`).
- **Batería por voltaje** (`battery_voltage_low_*`, `battery_voltage_critical_*`): compara voltaje real en **V**.
- **Batería por porcentaje** (`battery_low*`): puede usar porcentaje directo (mock) o **% estimado** desde voltaje con curva configurable.
- **Sin datos / heartbeat** (`heartbeat`): alerta distinta, no equivale a batería baja.

## 2) Simulación vs ejecución real

- **Validar (simulación)**
  - Botón en `Reglas activas`.
  - Usa JSON del bloque “Flujo de prueba controlado”.
  - No persiste eventos.
- **Ejecutar evaluación ahora**
  - Pestaña `Estado`.
  - Ejecuta motor real (`POST /api/alerts/run`) y puede persistir eventos.

## 3) Pruebas recomendadas (mock)

1. Crear regla con `dataSource=mock`.
2. Aplicar preset “dispara” y validar.
3. Confirmar en modal: `fired=true`, mensaje y `simulated_events`.
4. Aplicar preset “no dispara” y validar.
5. Ejecutar evaluación real y revisar eventos persistidos.

## 4) Pruebas recomendadas (real)

1. Crear regla con `dataSource=real` y scope completo (`tenant/client/site`).
2. Para voltaje:
   - tipo `battery_voltage_low_any` y `battery_voltage_critical_any`
   - perfil recomendado inicial: nominal `3.6V`, `low=3.35`, `critical=3.25`, `cutoff=3.2`
3. Ejecutar evaluación real y verificar mensajes tipo:
   - `Batería baja: 3.24 V (umbral 3.30 V)`
   - `Batería crítica: 3.19 V`
4. Crear/validar regla `heartbeat` con `expectedIntervalMinutes`, `staleMultiplier` y/o `timeoutMinutes` y confirmar mensajes:
   - `Equipo sin datos desde hace X min`

## 5) Curva voltaje -> porcentaje (estimado)

Para reglas `battery_low*` puedes enviar:

```json
{
  "threshold": 25,
  "batteryCurveName": "li-ion-custom",
  "batteryCurvePoints": [
    {"voltage": 3.2, "percent": 0},
    {"voltage": 3.6, "percent": 60},
    {"voltage": 4.0, "percent": 100}
  ]
}
```

El resultado debe interpretarse como **estimado**, no como medición directa.

## 5.1) Mock de voltaje por dispositivo (testing controlado)

Para reglas `battery_voltage_*` en `dataSource=mock`, usa:

```json
{
  "mockBatteries": [
    { "deviceId": "device-1", "serial": "GW-001", "label": "Sensor A", "voltage": 3.29 },
    { "deviceId": "device-2", "serial": "GW-002", "label": "Sensor B", "voltage": 3.45 }
  ]
}
```

Presets recomendados:
- low: ~3.29V
- critical: ~3.19V
- ok: ~3.45V

## 6) Retención y limpieza

- Retención de eventos configurable por env:
  - `ALERTS_EVENTS_RETENTION_DAYS` (default 30)
  - `ALERTS_EVENTS_MAX` (default 2000)
- Se preservan eventos activos y se limpian automáticamente resueltos/ack antiguos.
- El estado interno por entidad (`__entityState`, `__entityLastNotifiedAt`) también se poda para evitar crecimiento infinito.

## 7) Flujo recomendado

- **Demos / QA**: `dataSource=mock` + presets + Validar.
- **Producción**: `dataSource=real` + ejecución por scheduler/motor + revisión de retención.
