# Deploy del portal en BeaglePlay (por rama)

Este documento formaliza cómo desplegar y validar el portal Next.js en BeaglePlay para **cualquier rama** del repo.

## 1) Repo de trabajo vs runtime real

En BeaglePlay existen dos contextos distintos:

- **Repo de trabajo (git)**: donde haces `fetch/checkout/reset` de ramas de Codex.
  - Ejemplo en este proyecto: `/opt/sennet-agent/repo`.
- **Runtime real del portal**: donde vive lo que realmente ejecuta `sennet-portal.service`.
  - Ruta runtime: `/home/debian/sennet-portal/portal`.

> Importante: cambiar archivos en el repo de trabajo **no cambia automáticamente** lo que sirve `systemd`. Debes sincronizar al runtime y reconstruir standalone.

---

## 2) Flujo manual recomendado

Si necesitas hacerlo manualmente (sin script):

1. Actualizar el repo y fijar la rama:
   - `git fetch origin --prune`
   - `git checkout <rama>`
   - `git reset --hard origin/<rama>`
2. Parar servicio:
   - `sudo systemctl stop sennet-portal.service`
3. Sincronizar `portal/` al runtime:
   - copiar de `<repo>/portal/` a `/home/debian/sennet-portal/portal/` (usando `rsync -a --delete`)
4. Compilar standalone:
   - `cd /home/debian/sennet-portal/portal && ./scripts/build_standalone.sh`
5. Levantar servicio:
   - `sudo systemctl restart sennet-portal.service`
6. Verificar:
   - servicio activo (`systemctl is-active`)
   - proceso apuntando a `.next/standalone`
   - `curl http://127.0.0.1:3000/alertas` responde correctamente

---

## 3) Script automatizado

Se añadió el script:

- `scripts/deploy_portal_branch_beagleplay.sh`

### Uso

```bash
/opt/sennet-agent/repo/scripts/deploy_portal_branch_beagleplay.sh <rama>
```

Ejemplo:

```bash
cd /opt/sennet-agent/repo
./scripts/deploy_portal_branch_beagleplay.sh feat/alertas-fix
```

### Qué hace el script

1. Valida dependencias (`git`, `rsync`, `systemctl`, `curl`).
2. Valida que se ejecuta desde el repo esperado en BeaglePlay: `/opt/sennet-agent/repo`.
3. Ejecuta:
   - `git fetch origin --prune`
   - `git checkout <rama>` (crea rama local si no existe)
   - `git reset --hard origin/<rama>`
4. Para `sennet-portal.service`.
5. Sincroniza `portal/` hacia `/home/debian/sennet-portal/portal` con `rsync -a --delete`.
6. Ejecuta `./scripts/build_standalone.sh` como usuario `debian`.
7. Verifica que exista `/home/debian/sennet-portal/portal/.next/standalone`.
8. Reinicia `sennet-portal.service`.
9. Verifica:
   - servicio activo
   - `MainPID` con `cmdline` conteniendo `/home/debian/sennet-portal/portal/.next/standalone`
   - `curl` a `/alertas` con HTTP válido (200 o redirecciones 30x)
10. Muestra mensajes de error claros y aborta ante cualquier fallo (`set -euo pipefail`).

---

## 4) Configuración correcta de systemd

La unidad `sennet-portal.service` debe:

- Ejecutar desde rutas **absolutas** del runtime (`/home/debian/sennet-portal/portal`).
- Arrancar el servidor standalone generado en:
  - `/home/debian/sennet-portal/portal/.next/standalone`
- Usar usuario adecuado (normalmente `debian`).
- Tener reinicio automático (`Restart=always` o equivalente).

Comandos útiles:

```bash
sudo systemctl daemon-reload
sudo systemctl restart sennet-portal.service
systemctl --no-pager --full status sennet-portal.service
journalctl -u sennet-portal.service -n 200 --no-pager
```

---

## 5) Verificaciones post-deploy

Después de desplegar rama:

1. `systemctl is-active --quiet sennet-portal.service`
2. Confirmar `MainPID` y su `cmdline`:
   - `systemctl show -p MainPID --value sennet-portal.service`
   - revisar `/proc/<pid>/cmdline` para validar `.next/standalone`
3. Validar endpoint:
   - `curl -i http://127.0.0.1:3000/alertas`
4. Revisar logs si hay dudas:
   - `journalctl -u sennet-portal.service -n 200 --no-pager`

---

## 6) Errores típicos y diagnóstico rápido

- **`origin/<rama>` no existe**
  - Causa: rama no publicada o nombre incorrecto.
  - Acción: `git fetch --all --prune` y validar nombre.

- **Servicio no arranca tras build**
  - Causa: fallo de compilación o dependencia faltante.
  - Acción: revisar salida de `./scripts/build_standalone.sh` y `journalctl`.

- **Proceso no corre desde `.next/standalone`**
  - Causa: unit file apunta a ruta equivocada o arranque legacy.
  - Acción: corregir `ExecStart` a runtime standalone y `daemon-reload`.

- **`curl /alertas` devuelve 5xx o timeout**
  - Causa: servicio caído, app no levantó o puerto incorrecto.
  - Acción: validar `systemctl status`, logs y puertos.

- **Permisos en runtime**
  - Causa: archivos sincronizados con dueño incorrecto.
  - Acción: `sudo chown -R debian:debian /home/debian/sennet-portal`.

---

## 7) Buenas prácticas

- Ejecuta siempre deploy con rama explícita.
- Mantén `systemd` apuntando al runtime estable, no al repo temporal.
- Evita editar manualmente archivos dentro de `.next/`; recompila.
- Usa este flujo para pruebas repetibles entre ramas de Codex.
