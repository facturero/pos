#!/usr/bin/env python3
"""Genera un logo PLACEHOLDER (cuadrado azul con una P) de 1024x1024 en PNG, sin dependencias.

Solo sirve para poder compilar la ventana. El logo real: `npx tauri icon logo.png` dentro de
frontend/ y commitear frontend/src-tauri/icons (entonces el Dockerfile ya no genera este placeholder).
uso: make-icons.py salida.png
"""
import struct
import sys
import zlib

N = 1024
BG = (37, 99, 235)  # azul de marca aproximado
FG = (255, 255, 255)


def in_p(x, y):
    # "P" en una rejilla de 1024: asta vertical + panza. Coordenadas por rectangulos.
    stem = 330 <= x < 450 and 250 <= y < 780
    top = 330 <= x < 660 and 250 <= y < 360
    mid = 330 <= x < 660 and 480 <= y < 590
    bowl = 560 <= x < 680 and 300 <= y < 550
    return stem or top or mid or bowl


rows = []
for y in range(N):
    row = bytearray(b"\x00")  # filtro 0
    for x in range(N):
        row += bytes(FG if in_p(x, y) else BG)
    rows.append(bytes(row))


def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 2, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
png += chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
