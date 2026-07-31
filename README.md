# POS — arquitectura

## Resumen
- **backend/**: Node + TypeScript + Hono + Prisma + MySQL. Corre 100% local
  (127.0.0.1). Actúa como CACHÉ de productos/categorías (sincronizados desde
  el admin) + cola de ventas (generadas localmente, subidas al admin cuando
  hay internet). Ver `backend/src/sync/`.
- **frontend/**: Vue 3 + Tailwind + Pinia, empaquetado con Tauri (`frontend/src-tauri`).
  Le habla al backend local vía HTTP (`VITE_API_BASE_URL`).

## Para levantar el backend
```
cd backend
npm install
copy .env.example .env
# edita .env: DATABASE_URL, ADMIN_API_BASE_URL, ADMIN_API_TOKEN, JWT_SECRET
npx prisma migrate dev
npx prisma db seed
npm run dev
```

## Para levantar el frontend (modo desarrollo, en navegador)
```
cd frontend
npm install
copy .env.example .env
npm run dev
```

## Para levantar dentro de Tauri (app de escritorio real)
```
cd frontend
npm install
npm run tauri dev
```

### Pendiente antes de compilar Tauri en serio
1. **Iconos**: `src-tauri/icons/` está vacío. Genera los iconos desde un PNG
   fuente con: `npx tauri icon ruta/a/tu-logo.png` (crea todos los tamaños
   automáticamente).
2. **Clave del auto-updater**: `tauri.conf.json -> plugins.updater.pubkey`
   tiene un placeholder. Genera el par de claves con:
   `npx tauri signer generate -w ~/.tauri/pos.key`
   y reemplaza el `pubkey` con la clave pública generada (la privada NUNCA
   se sube al repo, se usa solo para firmar releases).
3. **Endpoint del updater**: cambia `https://updates.tudominio.com/...` por
   tu servidor real de actualizaciones.
4. **No validado por compilador**: el `Cargo.toml`/`main.rs`/`tauri.conf.json`
   fueron escritos a mano (el sandbox de validación no tiene Rust instalado).
   Corre `cargo check` dentro de `src-tauri/` en tu máquina antes de
   confiarles un build de producción — si `cargo` marca algo, probablemente
   sea un ajuste menor de versión de alguna dependencia.

## Ya validado (compilador + build reales)
- Backend: `npm install` + `tsc --noEmit` limpio.
- Frontend: `npm install` + `vue-tsc --noEmit` limpio + `vite build` exitoso
  (Tailwind compilando correctamente).
