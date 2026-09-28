#!/usr/bin/env python3
"""Pantalla de texto del PRIMER ARRANQUE, con el mismo aspecto que la de la instalación de Ubuntu (install-tui.py):
pasos a la izquierda, comandos que se ejecutan (salida en vivo) a la derecha.

Cubre el tramo en que todavía no hay entorno gráfico (install.sh está instalando paquetes). Cuando install.sh abre
la pantalla gráfica (installer-ui/run.sh start), esta se cierra sola. Lee lo mismo que la pantalla gráfica:
el archivo de progreso y el registro del primer arranque, a través de installer-ui/server.py (build_status).

Cosmético: cualquier fallo se ignora y el primer arranque sigue (firstboot.sh lo lanza en segundo plano).
"""
import importlib.util
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


tui = load("install_tui", os.path.join(HERE, "install-tui.py"))                    # paleta, colores, clip
srv = load("installer_server", os.path.join(HERE, "..", "installer-ui", "server.py"))  # build_status

TTY = os.environ.get("TUI_TTY", "/dev/tty9")


def fmt(s):
    s = float(s)
    if s < 1:
        return f"{int(s * 1000)}ms"
    return f"{s:.1f}s" if s < 10 else tui.fmt_time(s)


def render(out, rows, cols, tick):
    st = srv.build_status()
    steps = st["steps"]
    n = len(steps)
    done = sum(1 for s in steps if s["state"] == "done")
    pct = st["percent"]
    left = max(38, min(int(cols * 0.42), 64))
    rx = left + 4
    rw = max(10, cols - rx - 2)
    BG, INK, BLUE, GRAY = tui.BG, tui.INK, tui.BLUE, tui.GRAY
    buf = ["\033[H"]

    def put(r, c, text, style=""):
        if 1 <= r <= rows:
            buf.append(f"\033[{r};{c}H{style}{text}{BG}{INK}")

    for r in range(1, rows + 1):
        buf.append(f"\033[{r};1H{BG}{INK}" + " " * cols)

    put(2, 3, tui.NAME, BLUE)
    put(3, 3, tui.BYLINE, GRAY)
    put(4, 3, "Preparando el equipo. Se hace una sola vez, tarda unos minutos y no hay que tocar nada.", GRAY)
    put(6, 3, f"{done} de {n} pasos completos", GRAY)
    put(6, left - len(f"{pct}%") + 1, f"{pct}%", GRAY)
    barw = left - 3
    filled = int(barw * pct / 100)
    put(7, 3, "█" * filled, BLUE)
    put(7, 3 + filled, "█" * (barw - filled), tui.TRACK)

    spin = "|/-\\"[tick % 4]
    for i, s in enumerate(steps):
        r = 9 + i * 2
        if s["state"] == "done":
            mark, style, txt = "√", tui.GREEN, INK
        elif s["state"] in ("running", "error"):
            mark, style, txt = (spin if s["state"] == "running" else "!"), BLUE, "\033[1;30m"
        else:
            mark, style, txt = "·", GRAY, GRAY
        t = fmt(s["seconds"]) if s["seconds"] is not None else ""
        put(r, 3, mark, style)
        put(r, 6, tui.clip(s["label"], left - 14), txt)
        if t:
            put(r, left - len(t) + 1, t, GRAY)
    if st["error"]:
        put(9 + n * 2, 3, tui.clip("Algo falló, se reintenta solo: " + st["error"], left - 2), tui.RED)

    for r in range(6, rows):
        put(r, left + 2, "│", tui.LINE)
    put(6, rx, "Detalle de la instalación", BLUE)
    cnt = f"{len(st['log'])} líneas"
    put(6, cols - len(cnt) - 1, cnt, GRAY)
    room = rows - 8
    for j, line in enumerate(st["log"][-room:]):
        r = 8 + j
        if line.startswith("[install]"):
            put(r, rx, "-> ", BLUE)
            put(r, rx + 3, tui.clip(line[9:].strip(), rw - 3), "\033[1;30m")
        else:
            put(r, rx, tui.clip(line, rw), GRAY)

    out.write("".join(buf))
    out.flush()


def main():
    out = open(TTY, "w", encoding="utf-8", errors="replace")
    try:
        cols, rows = os.get_terminal_size(out.fileno())
    except OSError:
        cols, rows = 160, 50
    tui.setup_tty(out)
    tick = 0
    while True:
        try:
            cols, rows = os.get_terminal_size(out.fileno())
        except OSError:
            pass
        if tick % 10 == 0:
            tui.apply_palette(out)   # console-setup puede volver a poner la paleta de fabrica tras el arranque
        render(out, rows, cols, tick)
        tick += 1
        time.sleep(0.5)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        print(f"firstboot-tui: {exc}", file=sys.stderr)
