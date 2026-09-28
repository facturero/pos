#!/usr/bin/env python3
"""Pantalla de instalación de Ubuntu en modo texto DIVIDIDO (pasos a la izquierda, comandos en vivo a la derecha).

El instalador de Ubuntu (subiquity) es solo texto: no hay X ni navegador. Este script hace lo más parecido posible
a la pantalla gráfica del primer arranque (os/installer-ui) dentro de esa limitación:
  - subiquity avisa CADA evento de la instalación a un servidor local (autoinstall.yaml -> reporting -> webhook);
  - este script recibe esos eventos (stdlib, sin dependencias), los muestra a la derecha como "salida en vivo" y
    deduce a qué paso corresponde cada uno para pintar la lista de pasos y la barra de progreso a la izquierda;
  - dibuja todo en una consola virtual limpia (la 9) con la paleta de la marca y cambia a ella.
Los eventos crudos se guardan en /run/facturero-install-events.log (late-commands lo copia al equipo instalado)
para poder ajustar la correspondencia evento -> paso mirando una instalación real.

Cosmético: cualquier fallo se ignora y la instalación sigue (autoinstall.yaml lo lanza con `|| true`).
Colores (paleta de la consola, 16 entradas): editar PALETTE.
"""
import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import threading
import time
from collections import deque

TTY = os.environ.get("TUI_TTY", "/dev/tty9")
VT = re.sub(r"\D", "", TTY) or "9"
PORT = int(os.environ.get("TUI_PORT", "8765"))
EVENTS_LOG = os.environ.get("TUI_EVENTS_LOG", "/run/facturero-install-events.log")
NAME = "POS KIOSKO"
BYLINE = "un producto de noahsolutions"

# Paleta de la marca (índice -> rrggbb). La consola de Linux solo tiene 16 colores: se redefinen los que se usan.
# Verde azulado sobre gris cálido: identidad propia, distinta a propósito de la de otros instaladores.
PALETTE = {0: "1f2933", 1: "d92d20", 2: "1a9a55", 4: "0e7c66", 5: "d7ece6", 7: "f7f7f5", 8: "66756f", 6: "cfd8d3"}
RESET = "\033[0m"
BG = "\033[47m"                      # fondo (color 7, casi blanco)
INK = "\033[30m"                     # texto (color 0, azul muy oscuro)
BLUE = "\033[1;34m"                  # marca (color 4)
GRAY = "\033[22;90m"                 # secundario (color 8)
GREEN = "\033[1;32m"
RED = "\033[1;31m"
TRACK = "\033[22;35m"                # riel de la barra (color 5, azul muy claro)
LINE = "\033[22;36m"                 # divisor (color 6)

# Pasos visibles. Cada uno se reconoce por el NOMBRE del evento de subiquity (medido en una instalacion real: ver
# /var/log/facturero-installer-events.log del equipo instalado). El paso alcanzado nunca retrocede; lo que no encaja
# en ninguno pertenece al primero (carga de la configuracion, red, espejos...).
STEPS = [
    ("Preparar el instalador", None),
    ("Preparar el disco", r"stage-(initial|partitioning)|block-meta"),
    ("Copiar el sistema", r"stage-extract"),
    ("Configurar el sistema", r"stage-curthooks|setup_target"),
    ("Instalar paquetes", r"/postinstall"),
    ("Aplicar la configuración", r"/Late/run"),
    ("Finalizar", None),      # empieza al terminar los comandos finales (finish de /Late/run)
]
STEP_RULES = [(i, re.compile(rx)) for i, (_, rx) in enumerate(STEPS) if rx]
NOISE = re.compile(r"status_GET|_send_update|load_autoinstall|apply_autoinstall_config")

state = {
    "reached": 0,                    # índice del paso en curso (0 = el primero)
    "started": {0: time.time()},
    "finished": False,
    "error": None,
    "lines": deque(maxlen=600),      # (tipo, texto) tipo: cmd | bad
    "count": 0,
}
lock = threading.Lock()


def advance(idx):
    if idx > state["reached"]:
        now = time.time()
        for i in range(state["reached"] + 1, idx + 1):
            state["started"].setdefault(i, now)
        state["reached"] = idx


def on_event(ev):
    name = str(ev.get("name", ""))
    desc = str(ev.get("description", "")).strip()
    kind = str(ev.get("event_type", ""))
    result = str(ev.get("result", ""))
    with lock:
        for i, rx in STEP_RULES:
            if rx.search(name):
                advance(i)
        if kind == "finish" and name.endswith("/Late/run") and result.upper() in ("SUCCESS", "WARN", ""):
            advance(len(STEPS) - 1)
            state["finished"] = True
        if kind == "finish" and result and result.upper() not in ("SUCCESS", "WARN"):
            state["error"] = desc or name.rsplit("/", 1)[-1]
            state["lines"].append(("bad", "FALLÓ: " + state["error"]))
            state["count"] += 1
        elif kind == "start" and desc and not NOISE.search(name):
            # una fila por comando/accion que empieza (los "finish" repetirian cada fila y no aportan)
            state["lines"].append(("cmd", desc))
            state["count"] += 1


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(n).decode("utf-8", "replace")
            try:
                with open(EVENTS_LOG, "a", encoding="utf-8") as f:
                    f.write(raw.replace("\n", " ") + "\n")
            except OSError:
                pass
            data = json.loads(raw)
            for ev in data if isinstance(data, list) else [data]:
                if isinstance(ev, dict):
                    on_event(ev)
        except Exception:
            pass
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def fmt_time(s):
    s = int(s)
    return f"{s // 60}m {s % 60:02d}s" if s >= 60 else f"{s}s"


def clip(text, width):
    text = text.replace("\t", " ").replace("\r", "")
    return text if len(text) <= width else text[: max(0, width - 1)] + "…"


def render(out, rows, cols, tick):
    with lock:
        reached = state["reached"]
        started = dict(state["started"])
        lines = list(state["lines"])
        finished = state["finished"]
        error = state["error"]
        count = state["count"]
    n = len(STEPS)
    done = n if finished else reached
    pct = 100 if finished else int(done * 100 / n)
    left = max(38, min(int(cols * 0.42), 64))       # ancho de la columna de pasos
    rx = left + 4                                    # columna donde empieza la salida en vivo
    rw = max(10, cols - rx - 2)                      # ancho de la salida en vivo

    buf = ["\033[H"]

    def put(r, c, text, style=""):
        if 1 <= r <= rows:
            buf.append(f"\033[{r};{c}H{style}{text}{BG}{INK}")

    # fondo limpio (se repinta entero: es barato y evita restos)
    for r in range(1, rows + 1):
        buf.append(f"\033[{r};1H{BG}{INK}" + " " * cols)

    put(2, 3, NAME, BLUE)
    put(3, 3, BYLINE, GRAY)
    put(4, 3, "Instalando el sistema. Se hace una sola vez y no hay que tocar nada.", GRAY)

    # progreso
    put(6, 3, f"{done} de {n} pasos completos", GRAY)
    put(6, left - len(f"{pct}%") + 1, f"{pct}%", GRAY)
    barw = left - 3
    filled = int(barw * pct / 100)
    put(7, 3, "█" * filled, BLUE)
    put(7, 3 + filled, "█" * (barw - filled), TRACK)

    # pasos
    spin = "|/-\\"[tick % 4]
    for i, (label, _) in enumerate(STEPS):
        r = 9 + i * 2
        if finished or i < reached:
            mark, style, txt = "√", GREEN, INK
            t = fmt_time(started.get(i + 1, time.time()) - started.get(i, time.time())) if i in started else ""
        elif i == reached:
            mark, style, txt = spin, BLUE, "\033[1;30m"
            t = fmt_time(time.time() - started.get(i, time.time()))
        else:
            mark, style, txt, t = "·", GRAY, GRAY, ""
        put(r, 3, mark, style)
        put(r, 6, clip(label, left - 14), txt)
        if t:
            put(r, left - len(t) + 1, t, GRAY)
    if error:
        put(9 + n * 2, 3, clip("Algo falló: " + error, left - 2), RED)
    if finished:
        put(9 + n * 2, 3, "Listo. El equipo se reiniciará solo.", GREEN)

    # divisor y salida en vivo
    for r in range(6, rows):
        put(r, left + 2, "│", LINE)
    put(6, rx, "Detalle de la instalación", BLUE)
    cnt = f"{count} línea{'s' if count != 1 else ''}"
    put(6, cols - len(cnt) - 1, cnt, GRAY)
    room = rows - 8
    for j, (kind, text) in enumerate(lines[-room:]):
        r = 8 + j
        if kind == "cmd":
            put(r, rx, "$ ", BLUE)
            put(r, rx + 2, clip(text, rw - 2), "\033[1;30m")
        elif kind == "ok":
            put(r, rx, clip(text, rw), GREEN)
        elif kind == "bad":
            put(r, rx, clip(text, rw), RED)
        else:
            put(r, rx, clip(text, rw), GRAY)

    out.write("".join(buf))
    out.flush()


def setup_tty(out):
    pal = "".join(f"\033]P{i:X}{hexv}" for i, hexv in PALETTE.items())
    out.write(pal + "\033[?25l" + BG + INK + "\033[2J")
    out.flush()
    if shutil.which("chvt"):
        subprocess.run(["chvt", VT], check=False)


def main():
    srv = Server(("127.0.0.1", PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    out = open(TTY, "w", encoding="utf-8", errors="replace")
    try:
        cols, rows = os.get_terminal_size(out.fileno())
    except OSError:
        cols, rows = 160, 50
    setup_tty(out)
    tick = 0
    while True:
        try:
            cols, rows = os.get_terminal_size(out.fileno())
        except OSError:
            pass
        render(out, rows, cols, tick)
        tick += 1
        time.sleep(0.5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:  # cosmético: nunca debe impedir instalar
        print(f"install-tui: {exc}", file=sys.stderr)
