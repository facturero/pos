#!/usr/bin/env python3
"""Servidor local de la pantalla de instalación del primer arranque (solo biblioteca estándar).

Sirve index.html y /status en 127.0.0.1. No lleva lógica de instalación: solo LEE
  - el archivo de progreso que va escribiendo install.sh (ver progress() allí):
        step <n> <epoch>       empieza el paso n
        done <epoch>           todo terminado
        error <epoch> <texto>  algo falló (firstboot.service se relanza solo)
  - el registro del primer arranque (/var/log/facturero-firstboot.log), sin secuencias de color.
Se usa Python y no Node porque en ese momento Node todavía no está instalado; python3 viene con Ubuntu.
"""
import http.server
import json
import os
import re
import socketserver
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("INSTALLER_PORT", "4080"))
PROGRESS = os.environ.get("INSTALLER_PROGRESS", "/var/lib/facturero/install-progress")
LOG = os.environ.get("INSTALLER_LOG", "/var/log/facturero-firstboot.log")
LOG_LINES = 300

# Deben coincidir con las llamadas progress N de os/provision/install.sh (mismo orden).
STEPS = [
    "Preparar el sistema",
    "Instalar Node",
    "Configurar datos y claves",
    "Configurar los servicios",
    "Descargar e iniciar la aplicación",
    "Configurar el cortafuegos",
    "Activar el modo kiosco",
    "Terminar",
]
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def read_progress():
    started = {}
    finished = None
    error = None
    try:
        with open(PROGRESS, encoding="utf-8", errors="replace") as f:
            for line in f:
                parts = line.split(None, 2)
                if not parts:
                    continue
                if len(parts) >= 3 and parts[0] == "step" and parts[1].isdigit():
                    # "step n epoch": si el paso se repite (reintento), vale el último inicio
                    started[int(parts[1])] = float(parts[2].split()[0])   # epoch con decimales (ms)
                    error = None
                elif parts[0] == "done" and len(parts) >= 2:
                    finished = float(parts[1])
                elif parts[0] == "error":
                    error = parts[2].strip() if len(parts) > 2 else "error"
    except OSError:
        pass
    return started, finished, error


def build_status():
    started, finished, error = read_progress()
    now = time.time()
    current = max(started) if started else 0
    steps = []
    for i, label in enumerate(STEPS, start=1):
        if finished is not None or i < current:
            state, secs = "done", None
            if i in started:
                nxt = started.get(i + 1, finished if finished is not None else now)
                secs = round(max(0.0, (nxt or now) - started[i]), 3)
        elif i == current:
            state = "error" if error else "running"
            secs = round(max(0.0, now - started[i]), 3)
        else:
            state, secs = "pending", None
        steps.append({"id": i, "label": label, "state": state, "seconds": secs})
    done = sum(1 for s in steps if s["state"] == "done")
    percent = 100 if finished is not None else int(done * 100 / len(STEPS))
    lines = []
    try:
        with open(LOG, encoding="utf-8", errors="replace") as f:
            lines = [ANSI.sub("", ln.rstrip("\n")) for ln in f.readlines()[-LOG_LINES:]]
    except OSError:
        pass
    return {"steps": steps, "percent": percent, "finished": finished is not None, "error": error, "log": lines}


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/status":
            self._send(200, json.dumps(build_status()).encode(), "application/json; charset=utf-8")
        elif path in ("/", "/index.html"):
            with open(os.path.join(HERE, "index.html"), "rb") as f:
                self._send(200, f.read(), "text/html; charset=utf-8")
        else:
            self._send(404, b"no encontrado", "text/plain; charset=utf-8")

    def log_message(self, *args):  # sin ruido en el registro del primer arranque
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as srv:
        srv.serve_forever()
