import { execFile } from "node:child_process";

// Apagar/reiniciar el equipo desde la barra de estado del POS. Requiere la regla de sudoers
// "facturero-power" (os/provision/install.sh): SOLO estos dos comandos exactos, sin clave. No se
// ejecuta directo (sin sudo) porque el backend corre como el usuario `facturero`, sin permiso propio
// para apagar el sistema.
// Real (systemctl real) en Linux instalado; en desarrollo (Windows, o Linux sin la regla de sudoers)
// falla y el error se lo pasa al frontend — no hay una versión "de mentira" a propósito, para no
// esconder en desarrollo un sudoers mal puesto en producción.

function runSystemctl(action: "poweroff" | "reboot"): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("sudo", ["systemctl", action], (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      resolve();
    });
  });
}

export const powerOff = (): Promise<void> => runSystemctl("poweroff");
export const reboot = (): Promise<void> => runSystemctl("reboot");
