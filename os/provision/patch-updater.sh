#!/usr/bin/env bash
# Parche para cajas YA INSTALADAS (las que traen el actualizador viejo): lleva a la caja lo que
# install.sh instalaría hoy en la capa del sistema operativo, sin reinstalar ni reiniciar nada.
# Corre EN la caja, como root. Normalmente lo lanza patch-box.sh desde el equipo de servicio.
#
#   patch-updater.sh <carpeta con updater.mjs, restart-app.sh y facturero-updater.timer>
#
# Por qué existe: el actualizador (updater.mjs), su config (updater.json), la regla de sudoers y el
# timer son capa del SO — una release de la app NO los toca. Sin este parche una caja instalada no
# puede actualizarse: con el backend vivo `prisma migrate deploy` falla siempre con "database is
# locked" (CHANGELOG 2026-10-04) y el actualizador viejo no sabe parar el backend antes de migrar.
#
# Qué hace (idempotente, repetirlo no cambia nada):
#   1. restart-app.sh (stop|restart) en /opt/facturero/update-cli, root:root 0755
#   2. sudoers: el usuario facturero puede ejecutar ESE script (se valida con visudo antes de instalar)
#   3. updater.mjs nuevo (para el backend antes de migrar y lo devuelve al aire si falla)
#   4. updater.json: stopCmd + restartCmd nuevos y reintentos de migración
#   5. timer con OnCalendar=hourly de respaldo (en algunas VM el timer solo-monotónico nunca dispara)
# Orden pensado para que el actualizador no quede a medias si un timer dispara en medio: primero el
# script y el sudoers, al final la config que los usa. Si algo falla, se restaura lo anterior desde
# /var/backups/facturero-patch/<fecha>/.
set -euo pipefail

die() { printf '\033[1;31m[patch] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }
log() { printf '\033[1;34m[patch]\033[0m %s\n' "$*"; }

[[ "$(id -u)" -eq 0 ]] || die "corre como root (sudo bash patch-updater.sh <carpeta>)"
SRC="${1:?uso: patch-updater.sh <carpeta con updater.mjs, restart-app.sh y facturero-updater.timer>}"
for f in updater.mjs restart-app.sh facturero-updater.timer; do
  [[ -f "$SRC/$f" ]] || die "falta $SRC/$f"
done

UPDATE_CLI=/opt/facturero/update-cli
UPD_JSON=/etc/facturero/updater.json
SUDOERS=/etc/sudoers.d/facturero-updater
TIMER=/etc/systemd/system/facturero-updater.timer
RESTART_SCRIPT="$UPDATE_CLI/restart-app.sh"
[[ -d "$UPDATE_CLI" && -f "$UPD_JSON" ]] || die "esto no parece una caja instalada (falta $UPDATE_CLI o $UPD_JSON)"

NODE_BIN="$(ls -d /opt/facturero/runtime/node-*/bin/node 2>/dev/null | tail -1 || true)"
[[ -x "$NODE_BIN" ]] || die "no encuentro el Node fijado en /opt/facturero/runtime"
command -v python3 >/dev/null || die "falta python3 (para editar updater.json)"

# --- validar ANTES de tocar nada ----------------------------------------------
"$NODE_BIN" --check "$SRC/updater.mjs" || die "updater.mjs no pasa 'node --check'"
bash -n "$SRC/restart-app.sh" || die "restart-app.sh tiene errores de sintaxis"

# --- respaldo + restauración si algo falla -----------------------------------
BK="/var/backups/facturero-patch/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
for f in "$UPDATE_CLI/updater.mjs" "$RESTART_SCRIPT" "$UPD_JSON" "$SUDOERS" "$TIMER" /opt/facturero/state.json; do
  if [[ -e "$f" ]]; then cp -a "$f" "$BK/$(echo "$f" | tr / _)"; fi
done
DONE=""
restore() {
  [[ -n "$DONE" ]] && return
  printf '\033[1;31m[patch] falló: restaurando lo anterior desde %s\033[0m\n' "$BK" >&2
  for f in "$UPDATE_CLI/updater.mjs" "$RESTART_SCRIPT" "$UPD_JSON" "$SUDOERS" "$TIMER"; do
    b="$BK/$(echo "$f" | tr / _)"
    if [[ -e "$b" ]]; then cp -a "$b" "$f"; elif [[ "$f" == "$RESTART_SCRIPT" ]]; then rm -f "$f"; fi
  done
  systemctl daemon-reload || true
}
trap restore EXIT

# --- 1) script de control ----------------------------------------------------
install -m 0755 -o root -g root "$SRC/restart-app.sh" "$RESTART_SCRIPT"
log "restart-app.sh instalado ($RESTART_SCRIPT)"

# --- 2) sudoers (validado con visudo antes de instalarlo) --------------------
TMP_SUDO="$(mktemp)"
printf 'facturero ALL=(root) NOPASSWD: %s\n' "$RESTART_SCRIPT" > "$TMP_SUDO"
visudo -cf "$TMP_SUDO" >/dev/null || die "la regla de sudoers no valida"
install -m 0440 -o root -g root "$TMP_SUDO" "$SUDOERS"
rm -f "$TMP_SUDO"
log "sudoers actualizado (facturero puede ejecutar $RESTART_SCRIPT)"

# --- 3) actualizador ----------------------------------------------------------
install -m 0644 -o root -g root "$SRC/updater.mjs" "$UPDATE_CLI/updater.mjs"
log "updater.mjs actualizado"

# --- 4) config (al final: ya existen el script y el permiso que usa) ---------
TMP_JSON="$(mktemp)"
UPD_JSON="$UPD_JSON" RESTART_SCRIPT="$RESTART_SCRIPT" python3 - "$TMP_JSON" <<'PY'
import json, os, sys
cfg = json.load(open(os.environ["UPD_JSON"]))
rs = os.environ["RESTART_SCRIPT"]
cfg["stopCmd"] = f"sudo {rs} stop"
cfg["restartCmd"] = f"sudo {rs}"
cfg["migrateRetries"] = max(int(cfg.get("migrateRetries", 0)), 5)
cfg["migrateRetryDelayMs"] = int(cfg.get("migrateRetryDelayMs", 3000))
json.dump(cfg, open(sys.argv[1], "w"), indent=2)
PY
install -m 0640 -o root -g facturero "$TMP_JSON" "$UPD_JSON"
rm -f "$TMP_JSON"
log "updater.json actualizado (stopCmd, restartCmd, reintentos)"

# --- 5) timer ----------------------------------------------------------------
if ! cmp -s "$SRC/facturero-updater.timer" "$TIMER"; then
  install -m 0644 -o root -g root "$SRC/facturero-updater.timer" "$TIMER"
  systemctl daemon-reload
  systemctl restart facturero-updater.timer   # no ejecuta el servicio, solo recalcula el calendario
  log "timer actualizado"
fi

# --- 6) versiones "malas" que solo fallaron por este problema ----------------
# El actualizador viejo marca una versión como mala PARA SIEMPRE cuando falla la migración, y aquí
# fallaba por el bloqueo, no por culpa de la versión. Se quitan de la lista las más nuevas que la
# instalada para que se reintenten (si de verdad estuvieran rotas, fallarían otra vez, se marcarían
# de nuevo y esta vez el backend se devolvería al aire). Las más viejas no importan: nunca se bajan.
STATE=/opt/facturero/state.json
if [[ -f "$STATE" && -L /opt/facturero/current ]]; then
  CUR="$(basename "$(readlink /opt/facturero/current)")"
  python3 - "$STATE" "$CUR" <<'PY'
import json, sys
path, cur = sys.argv[1], sys.argv[2]
key = lambda v: tuple(int(x) for x in v.split("."))
s = json.load(open(path))
bad = s.get("bad", [])
keep = [v for v in bad if key(v) <= key(cur)]
if keep != bad:
    s["bad"] = keep
    json.dump(s, open(path, "w"), indent=2)
    print(f"[patch] versiones malas liberadas para reintento: {sorted(set(bad) - set(keep))}")
PY
  chown facturero:facturero "$STATE"
fi

# --- verificación final -------------------------------------------------------
sudo -n -u facturero sudo -n -l "$RESTART_SCRIPT" >/dev/null 2>&1 \
  || die "facturero no puede ejecutar $RESTART_SCRIPT con sudo sin clave"
"$NODE_BIN" -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$UPD_JSON" \
  || die "updater.json quedó inválido"
DONE=1
log "OK. Respaldo en $BK"
log "stopCmd:    $(python3 -c 'import json;print(json.load(open("'"$UPD_JSON"'"))["stopCmd"])')"
NEXT="$(systemctl show -p NextElapseUSecRealtime --value facturero-updater.timer)"
log "próxima corrida del actualizador: ${NEXT:-(sin calcular)}"
