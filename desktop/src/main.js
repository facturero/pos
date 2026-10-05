// Proceso principal de Electron — el equivalente Windows, "como Discord", del kiosco Linux
// (os/kiosk + os/provision), pero como proyecto APARTE: no toca nada de os/, y os/ no sabe que
// esto existe. Reusa pos/backend y pos/frontend TAL CUAL; no hay backend ni pantalla propios.
//
// DOS CORRECCIONES sobre la versión anterior de este archivo, ambas nacidas de que en la práctica
// esta app no arrancaba nunca:
//
// 1) El backend NO corre con el Node embebido de Electron (ELECTRON_RUN_AS_NODE). Ese Node es la
//    v20.18 y el backend importa argon2, un addon nativo: al cargarlo el proceso MUERE en silencio,
//    sin excepción ni una línea de log, y esta misma función lo relanzaba cada 2 s para siempre
//    (7 intentos en 12 s medidos) sin que nadie supiera por qué. Con Node 22.14.0, el mismo argon2
//    hashea y verifica bien. Por tanto el .exe lleva su propio node.exe: scripts/fetch-node.mjs lo
//    baja con el mismo patrón y el mismo SHA256 que usa el kiosco (os/provision/install.sh:104-113).
//    Sin Node del sistema y sin supervisor en PowerShell: el manejo de proceso hijo de este archivo
//    basta, y `app.relaunch` sigue siendo la base del autoarranque de Windows.
//
// 2) El log va a un fichero. Con `stdio: "inherit"` el backend no escribía en ninguna parte que
//    pudiéramos leer después de un fallo, que es justo lo que hizo imposible diagnosticar el punto 1.
//
// Además: las migraciones se aplican ANTES de arrancar el backend, se comprueba que el 4000 es
// nuestro, y los reintentos tienen tope. Antes, una base recién instalada se quedaba sin tablas
// (el backend no migra solo) y un fallo mataba el proceso en bucle infinito sin mostrar nada.
//
// POS_MODE=desktop (backend/src/system/mode.ts): StatusBar.vue oculta hora/apagar/reiniciar
// porque en escritorio esos ya los da Windows — pedido explícito del dueño.
const { app, BrowserWindow, dialog } = require("electron");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const crypto = require("node:crypto");

const isDev = !app.isPackaged;
const PORT = 4000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- rutas

// En dev, backend/frontend viven en el repo al lado de este proyecto; empaquetado, electron-builder
// los copia a resources/ (ver "extraResources" en package.json → stage/backend).
const backendDir = isDev
  ? path.join(__dirname, "..", "..", "backend")
  : path.join(process.resourcesPath, "backend");
const frontendDistDir = isDev
  ? path.join(__dirname, "..", "..", "frontend", "dist")
  : path.join(process.resourcesPath, "frontend-dist");

// El runtime de Node va DENTRO de la app. electron-builder lo deja en resources/node/ (en dev, en
// vendor/node/, que produce scripts/fetch-node.mjs y está en .gitignore: son ~92MB, no van a git).
// El nombre del binario cambia según la plataforma (node.exe en Windows, node en Linux/mac), igual
// que el archivo que lo baja: esta carpeta se traspasó de Windows a Linux/Mint y con el nombre
// fijo la app intentaba ejecutar un node.exe en Linux.
const nodeBinName = process.platform === "win32" ? "node.exe" : "node";
const nodeExe = isDev
  ? path.join(__dirname, "..", "vendor", "node", nodeBinName)
  : path.join(process.resourcesPath, "node", nodeBinName);
// El CLI de Prisma vive en dependencies (no devDependencies) a propósito: sin él no hay
// `migrate deploy` en el cliente. Es el mismo requisito que build-release.sh:102 comprueba para
// el kiosco.
const prismaCli = path.join(backendDir, "node_modules", "prisma", "build", "index.js");

// %APPDATA%\pos-desktop en Windows — separado del perfil de datos del kiosco (que ni siquiera
// existe en la misma máquina): esta instalación tiene su propia base SQLite, propio JWT_SECRET.
const userDataDir = app.getPath("userData");
const dataDir = path.join(userDataDir, "data");
const logsDir = path.join(userDataDir, "logs");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

// ---------------------------------------------------------------- log a fichero

const logFile = path.join(logsDir, "pos-desktop.log");
const MAX_LOG_BYTES = 2 * 1024 * 1024;

function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(logFile)) return;
    if (fs.statSync(logFile).size < MAX_LOG_BYTES) return;
    // Dos generaciones: pos-desktop.log (actual), .1 (anterior) y .2 (la anterior a esa). Suficiente
    // para comparar "funcionaba antes" contra "no funciona ahora" sin que crezca sin parar.
    fs.rmSync(`${logFile}.2`, { force: true });
    if (fs.existsSync(`${logFile}.1`)) fs.renameSync(`${logFile}.1`, `${logFile}.2`);
    fs.renameSync(logFile, `${logFile}.1`);
  } catch {
    // si el log no existe o no se puede rotar, seguimos escribiendo: es mejor un log enorme que
    // quedarse sin diagnóstico
  }
}

function log(...args) {
  const line = `${new Date().toISOString()} ${args.join(" ")}\n`;
  try {
    rotateLogIfNeeded();
    fs.appendFileSync(logFile, line);
  } catch {
    // sin permiso de escritura en userData no hay a dónde ir; no debe tumbar la app por eso
  }
  console.log(line.trimEnd());
}

// Un bloque de salida del hijo se escribe de golpe, no línea a línea: el log se lee después de un
// fallo y hay que poder ver el error entero sin que las líneas se intercalen.
function logBlock(text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim()) log("  |", line);
  }
}

function fatal(message, detail) {
  log("FATAL:", message, detail || "");
  dialog.showErrorBox("POS no puede arrancar", detail ? `${message}\n\n${detail}` : message);
  app.quit();
}

// ---------------------------------------------------------------- varios datos

function getOrCreateJwtSecret() {
  const secretsFile = path.join(userDataDir, "secrets.json");
  try {
    const saved = JSON.parse(fs.readFileSync(secretsFile, "utf8"));
    if (saved.jwtSecret) return saved.jwtSecret;
  } catch {
    // primera vez, o archivo corrupto: se genera uno nuevo
  }
  const jwtSecret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretsFile, JSON.stringify({ jwtSecret }));
  return jwtSecret;
}

function backendEnv() {
  // Prisma no acepta barras invertidas en el scheme file: se pasa la ruta con "/", que además
  // es la forma que documenta Prisma y la que ya usan los .env del kiosco.
  const dbPath = path.join(dataDir, "pos.db").replace(/\\/g, "/");
  return {
    ...process.env,
    // Sin ELECTRON_RUN_AS_NODE a propósito: ver el punto 1 de la cabecera.
    NODE_ENV: "production",
    PORT: String(PORT),
    POS_MODE: "desktop",
    // connection_limit=1: SQLite admite un escritor a la vez (misma nota que pos.env del kiosco)
    DATABASE_URL: `file:${dbPath}?connection_limit=1`,
    JWT_SECRET: getOrCreateJwtSecret(),
    POS_FRONTEND_DIST: frontendDistDir,
    POS_IMAGES_DIR: path.join(dataDir, "product-images"),
  };
}

// ---------------------------------------------------------------- migraciones

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// `migrate deploy` ANTES de arrancar el backend, porque el backend no migra solo: sin esto una base
// recién instalada se queda sin tablas y cada consulta revienta con "no such table".
// Se reintenta porque el caso real que vimos en el kiosco es `database is locked` cuando hay OTRO
// proceso con la base abierta; si el que la tiene abierta es un huérfano de una salida anterior,
// estos intentos son justo los que resuelven el arranque sin pedirle al usuario que lo mate a mano.
async function runMigrations(env) {
  if (!fs.existsSync(prismaCli)) {
    fatal(
      "Falta la CLI de Prisma que aplica las migraciones.",
      `No se encontró ${prismaCli}.\nEn desarrollo se arregla con:\n  cd pos/desktop && npm run prepare:resources`
    );
    return false;
  }
  for (const [intento, esperaMs] of [0, 3000, 10_000].entries()) {
    const r = spawnSync(nodeExe, [prismaCli, "migrate", "deploy"], {
      cwd: backendDir,
      env,
      encoding: "utf8",
    });
    const salida = `${r.stdout || ""}${r.stderr || ""}`.trim();
    if (r.status === 0) {
      log(`migraciones aplicadas (intento ${intento + 1})`);
      return true;
    }
    log(`migrate deploy falló (intento ${intento + 1}, código ${r.status}):`);
    logBlock(salida);
    if (intento < 2) await sleep(esperaMs);
  }
  fatal(
    "No se pudieron aplicar las migraciones de la base de datos.",
    "El log completo está en " + logFile
  );
  return false;
}

// ---------------------------------------------------------------- el puerto 4000 es nuestro

function isPortFree(port) {
  return new Promise((resolve) => {
    // reached=false significa que nadie cogió el puerto mientras esperábamos
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

// El PID que tiene el puerto, para poder decirle al usuario QUÉ se lo está comiendo en vez de solo
// "puerto ocupado". Sin dependencias, pero el comando es distinto en cada sistema: netstat en
// Windows, ss en Linux (que además da el nombre del proceso, no solo el PID).
function pidOnPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
      for (const line of out.split(/\r?\n/)) {
        if (new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING`).test(line)) {
          return line.trim().split(/\s+/).pop();
        }
      }
      return null;
    }
    // ss -ltnp: la columna "users:((" lleva pid=NNN
    const out = execFileSync("ss", ["-H", "-ltnp", `sport = :${port}`], { encoding: "utf8" });
    const m = out.match(/pid=(\d+)/);
    return m ? m[1] : null;
  } catch {
    // ss no está (o el usuario no puede leer los procesos): seguimos sin PID, el mensaje lo dirá
    return null;
  }
}

// Con el 4000 ocupado hay dos casos muy distintos y el mensaje tiene que distinguirirlos, porque la
// respuesta es distinta: o cerrar la otra copia de la app, o apagar el otro programa.
async function explainBusyPort() {
  const pid = pidOnPort(PORT);
  let detalle;
  try {
    const r = await fetch(`${BASE_URL}/system/info`, { signal: AbortSignal.timeout(2000) });
    const info = await r.json();
    detalle =
      info && info.mode
        ? `El puerto ${PORT} lo tiene otro proceso (PID ${pid ?? "?"}) que responde como POS ${info.version} en modo ${info.mode}.\nLo más probable es que haya otra copia de esta app abierta: ciérrala y vuelve a arrancar.`
        : `El puerto ${PORT} lo tiene otro programa (PID ${pid ?? "desconocido"}).`;
  } catch {
    detalle = `El puerto ${PORT} lo tiene otro programa (PID ${pid ?? "desconocido"}) que no responde como el POS. Libéralo y vuelve a arrancar.`;
  }
  fatal("El puerto " + PORT + " ya está ocupado.", detalle);
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        // No basta con que algo responda 200: si otra cosa se coló en el 4000 en la carrera entre
        // el chequeo y el spawn, abriríamos una ventana contra un servidor que no es el nuestro.
        const info = await fetch(`${BASE_URL}/system/info`, { signal: AbortSignal.timeout(3000) })
          .then((x) => x.json())
          .catch(() => null);
        if (info && info.mode) return info;
      }
    } catch {
      // aún no responde
    }
    await sleep(500);
  }
  return null;
}

// ---------------------------------------------------------------- backend

let backendProcess = null;
let quitting = false;
let intentos = 0;
const MAX_INTENTOS = 5;
// Backoff con tope. Antes era un setTimeout(startBackend, 2000) infinito: un backend que muere al
// arrancar (addon nativo roto, base bloqueada, puerto ocupado) convertía la app en un bucle que
// consumía CPU y llenaba el log sin que nadie se enterara.
const ESPERA_ENTRE_INTENTOS = [1000, 2000, 4000, 8000, 15_000];

function startBackend(env) {
  backendProcess = spawn(nodeExe, [path.join(backendDir, "dist", "index.js")], {
    cwd: backendDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  backendProcess.stdout.on("data", logBlock);
  backendProcess.stderr.on("data", logBlock);
  log(`backend lanzado con ${nodeExe} (PID ${backendProcess.pid})`);
  return backendProcess;
}

// Al cerrar hay que matar al hijo de verdad. Si Electron muere sin hacerlo, el backend sigue
// escuchando en el 4000 y la próxima apertura falla con "puerto ocupado" — o sea, se rompe sola.
function stopBackend() {
  if (!backendProcess) return;
  const child = backendProcess;
  backendProcess = null;
  // En Windows, taskkill /T se lleva el árbol entero; en Linux no existe ese comando, así que el
  // fallo se mira en el resultado de spawnSync (que devuelve error ENOENT sin lanzar excepción: un
  // try/catch NO habría Servido y el backend se habría quedado huérfano en el traspaso a Linux).
  if (process.platform === "win32") {
    const r = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return;
  }
  try {
    child.kill();
  } catch {
    // el hijo ya estaba muerto: nada que hacer
  }
}

async function bringUpBackend(env) {
  if (!(await isPortFree(PORT))) {
    await explainBusyPort();
    return null;
  }
  while (intentos < MAX_INTENTOS) {
    intentos += 1;
    startBackend(env);
    const info = await waitForHealth(30_000);
    if (info) {
      log(`backend listo: POS ${info.version} en modo ${info.mode}`);
      return info;
    }
    log(`el backend no respondió a tiempo (intento ${intentos} de ${MAX_INTENTOS})`);
    stopBackend();
    if (intentos < MAX_INTENTOS) {
      const espera = ESPERA_ENTRE_INTENTOS[Math.min(intentos - 1, ESPERA_ENTRE_INTENTOS.length - 1)];
      log(`   reintento en ${espera} ms`);
      await sleep(espera);
    }
  }
  fatal(
    "El backend no arrancó.",
    `Se intentó ${MAX_INTENTOS} veces y no respondió a /health.\nEl log completo está en ${logFile}`
  );
  return null;
}

// ---------------------------------------------------------------- ventana

async function createWindow() {
  // Ventana normal (bordes, redimensionable): a diferencia del kiosco, convive con otras ventanas
  // de Windows y no oculta la barra de tareas.
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "POS",
    autoHideMenuBar: true,
  });

  // La SPA se sirve desde el backend, así que la caché HTTP de Electron sobrevive a las
  // actualizaciones de la app y puede pedir assets con el hash de la versión anterior. Es el
  // problema que se veía en el kiosco: tras actualizar, la ventana pedía los ficheros
  // viejos y el backend respondía 404, tres veces seguidas, hasta que una petición nueva los fijó.
  // Aquí se vacía la caché antes de cargar, que es barato y hace el arranque determinista.
  try {
    await win.webContents.session.clearCache();
  } catch {
    // clearCache no disponible en este contexto: la app abre igual
  }
  win.loadURL(BASE_URL);
}

// ---------------------------------------------------------------- arranque

if (!fs.existsSync(nodeExe)) {
  fatal(
    "Falta el runtime de Node que va dentro de la app.",
    `No se encontró ${nodeExe}.\nEn desarrollo se resuelve con:\n  cd pos/desktop && npm run prepare:resources`
  );
}

// Dos copias de la app NO pueden compartir el 4000. El lock se pide antes de tocar nada, así que la
// segunda instancia se va avisando al usuario, sin llegar a pelearse con el puerto.
if (!app.requestSingleInstanceLock()) {
  log("hay otra instancia en marcha; saliendo");
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    log(`pos-desktop arrancando (${app.getVersion()}, modo ${isDev ? "dev" : "empaquetado"})`);

    const env = backendEnv();
    if (!(await runMigrations(env))) return;
    if (!(await bringUpBackend(env))) return;

    await createWindow();

    // "Como Discord": se abre solo al iniciar sesión de Windows. No hace falta Tarea programada
    // aparte (a diferencia del intento descartado con PowerShell): Electron ya sabe registrar esto.
    if (!isDev) app.setLoginItemSettings({ openAtLogin: true });

    // TODO: llamar a require("electron-updater").autoUpdater.checkForUpdatesAndNotify() una vez el
    // pipeline de release publique un artefacto de Windows (latest.yml) en GitHub Releases.
  });
}

app.on("window-all-closed", () => {
  quitting = true;
  stopBackend();
  app.quit();
});

app.on("before-quit", stopBackend);
