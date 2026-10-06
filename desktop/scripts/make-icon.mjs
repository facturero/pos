// Genera build/icon.ico (el icono del instalador y de la app): el chip azul "POS" de la marca, sin dependencias.
// electron-builder lo pide para el NSIS y exige al menos 256x256. Se dibuja a mano (letras en una rejilla 5x7,
// esquinas redondeadas, supersampling 4x para suavizar) y se guarda como ICO con entradas PNG: es el formato que
// Windows lee desde Vista. Se versiona el .ico generado; este script existe para poder rehacerlo.
//
//   node scripts/make-icon.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "build", "icon.ico");
const PRIMARY = [37, 99, 235]; // --c-primary de pos/frontend/src/style.css
const WHITE = [255, 255, 255];

const GLYPHS = {
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
};
const TEXT = "POS";
const COLS = 5 * 3 + 2 * 1; // tres letras de 5 columnas y dos huecos de 1
const ROWS = 7;

// ¿el punto (x, y) del lienzo unitario [0,1) cae sobre una letra?
function inText(x, y) {
  const cell = 0.66 / COLS; // el texto ocupa el 66% del ancho
  const w = cell * COLS;
  const h = cell * ROWS;
  const x0 = (1 - w) / 2;
  const y0 = (1 - h) / 2;
  const cx = Math.floor((x - x0) / cell);
  const cy = Math.floor((y - y0) / cell);
  if (x < x0 || y < y0 || cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return false;
  const letter = Math.floor(cx / 6);
  const inLetter = cx % 6;
  if (inLetter === 5) return false; // hueco entre letras
  return GLYPHS[TEXT[letter]][cy][inLetter] === "1";
}

// ¿dentro del cuadrado de esquinas redondeadas?
function inChip(x, y) {
  const r = 0.2;
  const dx = Math.max(r - x, x - (1 - r), 0);
  const dy = Math.max(r - y, y - (1 - r), 0);
  return dx * dx + dy * dy <= r * r;
}

function render(size) {
  const SS = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filtro "none"
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (!inChip(x, y)) continue;
          const c = inText(x, y) ? WHITE : PRIMARY;
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      if (a > 0) {
        raw[o] = Math.round(r / a);
        raw[o + 1] = Math.round(g / a);
        raw[o + 2] = Math.round(b / a);
      }
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return png(size, raw);
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(render);
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2); // tipo: icono
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; // 0 significa 256
  e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4); // planos
  e.writeUInt16LE(32, 6); // bits por píxel
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, ...entries, ...images]));
fs.writeFileSync(OUT.replace(/\.ico$/, ".png"), images[images.length - 1]);
console.log(`icono escrito: ${OUT} (${offset} bytes, tamaños ${sizes.join(", ")})`);
