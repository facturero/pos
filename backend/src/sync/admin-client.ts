// Cliente HTTP hacia el gateway del CRM (api-gateway-node, puerto 8080 en dev).
// El gateway valida el JWT y reenvía X-User-Id / X-Organization-Id / X-Permissions
// a los servicios internos — el POS solo necesita mandar el Bearer token,
// no arma esas cabeceras a mano.
//
// Autenticación: YA NO usa email/password fijo en .env. Las credenciales
// nacen del emparejamiento (ver src/routes/setup.routes.ts): al parear con
// el código de 6 dígitos, organization-service devuelve un refreshToken que
// se guarda en la tabla PosConfig. Desde entonces, este módulo solo hace
// /auth/refresh (nunca /auth/login) y persiste el refreshToken rotado en
// cada uso — auth-service rota el refresh token en cada refresh.

import { prisma } from "../db.js";

const GATEWAY_URL = process.env.ADMIN_API_BASE_URL ?? "";

export class AdminApiError extends Error {}
export class NotPairedError extends AdminApiError {
  constructor() {
    super("El POS todavía no está emparejado (falta configurar con el código de 6 dígitos)");
  }
}

interface TokenResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number; // segundos
  refreshToken: string;
}

let accessToken: string | null = null;
let accessTokenExpiresAt = 0; // epoch ms
// Cache en memoria del refreshToken vigente; la fuente de verdad sigue
// siendo la fila en PosConfig (se relee al arrancar el proceso).
let refreshTokenCache: string | null = null;
// Single-flight: varios caminos refrescan (realtime + sync pueden coincidir),
// y auth-service ROTA el refresh token en cada uso. Si dos refrescan a la
// vez con el mismo token, el perdedor queda revocado y el pull falla hasta
// el siguiente reintento. Aquí todos esperan al mismo refresh en curso.
let refreshInFlight: Promise<void> | null = null;

async function loadRefreshTokenFromDb(): Promise<string | null> {
  if (refreshTokenCache) return refreshTokenCache;
  const config = await prisma.posConfig.findUnique({ where: { id: 1 } });
  refreshTokenCache = config?.refreshToken ?? null;
  return refreshTokenCache;
}

async function persistRefreshToken(newRefreshToken: string): Promise<void> {
  refreshTokenCache = newRefreshToken;
  await prisma.posConfig.update({
    where: { id: 1 },
    data: { refreshToken: newRefreshToken },
  });
}

async function refresh(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<void> {
  const currentRefreshToken = await loadRefreshTokenFromDb();
  if (!currentRefreshToken) {
    throw new NotPairedError();
  }

  const res = await fetch(`${GATEWAY_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: currentRefreshToken }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // No reintentamos con login: sin emparejamiento manual (o re-emparejar)
    // no hay forma de recuperar credenciales — el admin deberá desvincular
    // y regenerar el código desde el CRM, y volver a configurar este POS.
    throw new AdminApiError(
      `No se pudo renovar la sesión con el admin (${res.status}): ${body}. ` +
        `Puede que el refresh token haya sido revocado — re-empareja el POS.`,
    );
  }

  const data = (await res.json()) as TokenResponse;
  accessToken = data.accessToken;
  accessTokenExpiresAt = Date.now() + (data.expiresIn - 60) * 1000;
  await persistRefreshToken(data.refreshToken);
}

async function ensureValidToken(): Promise<string> {
  if (!accessToken || Date.now() >= accessTokenExpiresAt) {
    await refresh();
  }
  if (!accessToken) {
    throw new AdminApiError("No se pudo obtener un token válido del admin");
  }
  return accessToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!GATEWAY_URL) {
    throw new AdminApiError("ADMIN_API_BASE_URL no configurado en .env");
  }

  const token = await ensureValidToken();

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401) {
    accessToken = null;
    const retryToken = await ensureValidToken();
    const retryRes = await fetch(`${GATEWAY_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${retryToken}`,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!retryRes.ok) {
      const body = await retryRes.text().catch(() => "");
      throw new AdminApiError(`Admin API ${retryRes.status}: ${body}`);
    }
    return retryRes.json() as Promise<T>;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AdminApiError(`Admin API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// --- Emparejamiento (llamado desde setup.routes.ts, NO desde el scheduler) --

export interface PairResponse {
  organizationId: string;
  establishmentId: string;
  emissionPointId: string;
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken: string;
}

// Ruta pública en organization-service (vía gateway) — no lleva Bearer token,
// el propio código de 6 dígitos ES la autenticación. El deviceId es la
// identidad estable del equipo (ver src/device-identity.ts), con la que el
// CRM registra el pos_device y luego le enruta la desvinculación.
export async function pairWithCode(code: string, deviceId: string): Promise<PairResponse> {
  if (!GATEWAY_URL) {
    throw new AdminApiError("ADMIN_API_BASE_URL no configurado en .env");
  }

  const res = await fetch(`${GATEWAY_URL}/billing-points/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceId }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ message: "" }))) as { message?: string };
    throw new AdminApiError(body.message || `El código no es válido (${res.status})`);
  }

  return res.json() as Promise<PairResponse>;
}

// Se llama justo después de un pairWithCode exitoso, para que el resto del
// proceso (sin reiniciar) ya tenga el access token cacheado y no tenga que
// esperar al primer ciclo de sync para hacer su primer refresh.
export function primeTokenCache(accessTok: string, expiresIn: number, refreshTok: string): void {
  accessToken = accessTok;
  accessTokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
  refreshTokenCache = refreshTok;
}

// Token de acceso vigente (hace refresh si hace falta). Lo usa el cliente de
// socket.io para autenticarse en el hub del gateway — el mismo JWT con el
// claim org_id que usa el resto del API.
export async function getAccessToken(): Promise<string> {
  return ensureValidToken();
}

// Limpia toda la sesión en memoria (access + refresh). Se llama cuando el POS
// se desvincula solo (evento pos.unlink) o con /setup/forget, para que ningún
// token viejo siga cacheado tras desaparecer el emparejamiento.
export function clearSessionCache(): void {
  accessToken = null;
  accessTokenExpiresAt = 0;
  refreshTokenCache = null;
}

// --- Formas reales de product-service (ver openapi.yaml) -------------------

export interface RemoteProduct {
  id: string; // uuid
  sku: string | null;
  name: string;
  type: "good" | "service";
  categoryId: string | null; // uuid
  status: "active" | "inactive";
  price: string; // decimal como string, ej "19.99"
  priceCents: number;
  currencyCode: string;
  priceIncludesTax: boolean;
  imageFileId: string | null;
}

export interface RemoteCategory {
  id: string; // uuid
  name: string;
  description: string | null;
  parentId: string | null;
  status: "active" | "inactive";
}

// product-service no soporta filtro incremental (updatedSince) todavía —
// se trae el catálogo completo de productos activos del ESTABLECIMIENTO del
// punto de emisión emparejado (establecimiento del pos_config) cada vez.
// product-service filtra con `?establishmentId=` (asignación product_establishments).
// Si tu catálogo crece mucho, este es el primer lugar a optimizar.
export async function fetchRemoteProducts(establishmentId?: string): Promise<RemoteProduct[]> {
  const params = establishmentId
    ? `?status=active&establishmentId=${encodeURIComponent(establishmentId)}`
    : `?status=active`;
  return request<RemoteProduct[]>(`/products${params}`);
}

export async function fetchRemoteCategories(): Promise<RemoteCategory[]> {
  return request<RemoteCategory[]>(`/categories`);
}

// --- Usuarios (auth-service) y clientes (customer-service) ------------------

// Los usuarios del CRM son identidades de la organización activa del token del
// POS. El token de dispositivo lleva los permisos del rol Administrador, que
// incluye `user:read`. `username` es el código de 7 caracteres que auth-service
// genera por usuario (letras y números, mayúsculas) y con el que hace login en
// el POS; `remoteId` = uuid del user. `email` se guarda aparte para validar la
// contraseña contra /auth/login en el primer login.
export interface RemoteUser {
  id: string; // uuid
  username: string | null; // código de 7 caracteres (letras+números, mayúsculas)
  email: string;
  fullName: string | null;
  identification: { type: string; number: string } | null;
  status: "active" | "disabled";
  roles: string[]; // nombres de rol en la organización (ej. "Administrador")
  // Hash (argon2id) de la contraseña del CRM. Se baja para que el POS pueda
  // validar el login LOCALMENTE (offline). null = el usuario no tiene
  // contraseña en el CRM (p.ej. solo Google o invitación sin aceptar).
  passwordHash: string | null;
}

// customer-service devuelve el read-model plano; contactos/direcciones vienen
// en el detalle de cada cliente (GET /customers/{id}).
export interface RemoteCustomer {
  id: string; // uuid
  organizationId: string;
  countryCode: string | null;
  identificationTypeId: string | null;
  identification: string | null;
  businessName: string;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  type: "person" | "company";
  status: "active" | "inactive";
}

export interface RemoteContact {
  id: string;
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
}

export interface RemoteAddress {
  id: string;
  customerId: string;
  type: "billing" | "shipping" | "other";
  line1: string;
  line2: string | null;
  city: string | null;
  province: string | null;
  countryCode: string | null;
  postalCode: string | null;
  isPrimary: boolean;
}

export interface RemoteCustomerDetail extends RemoteCustomer {
  contacts: RemoteContact[];
  addresses: RemoteAddress[];
}

// Solo los usuarios (empleados) del ESTABLECIMIENTO del punto de emisión
// emparejado se bajan a este POS. auth-service filtra con `?establishmentId=`
// (asignación user_establishments). Sin el filtro se bajarían los usuarios de
// toda la organización.
export async function fetchRemoteUsers(establishmentId?: string): Promise<RemoteUser[]> {
  const params = establishmentId
    ? `?establishmentId=${encodeURIComponent(establishmentId)}`
    : '';
  return request<RemoteUser[]>(`/users${params}`);
}

export async function fetchRemoteCustomers(): Promise<RemoteCustomer[]> {
  return request<RemoteCustomer[]>(`/customers`);
}

export async function fetchRemoteCustomerDetail(id: string): Promise<RemoteCustomerDetail> {
  return request<RemoteCustomerDetail>(`/customers/${id}`);
}

// Valida las credenciales del OPERADOR contra auth-service (NO con el token de
// dispositivo del POS, sino con el email/contraseña que escribió en el login).
// Se usa para vincular la contraseña del CRM en el primer login de un usuario
// sincronizado: auth-service rota el refresh token en cada uso, y guardar el
// hash local permite validar offline después. Devuelve true si son válidas,
// false si el usuario existe pero la contraseña no coincide, y lanza
// AdminApiError si no se pudo contactar al admin (para distinguir "incorrecta"
// de "sin conexión").
export async function validateRemoteCredentials(email: string, password: string): Promise<boolean> {
  if (!GATEWAY_URL) {
    throw new AdminApiError("ADMIN_API_BASE_URL no configurado en .env");
  }

  const res = await fetch(`${GATEWAY_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.ok) return true;
  if (res.status === 401) return false;

  const body = await res.text().catch(() => "");
  throw new AdminApiError(`auth/login respondió ${res.status}: ${body}`);
}

// NOTA: billing-service (donde vivirían las facturas/ventas) todavía no está
// construido en el CRM — no hay endpoint real al que subir esto. Esta función
// queda lista para cuando exista; hasta entonces, pushToAdmin() simplemente
// fallará y las ventas quedarán en la cola local (sin pérdida de datos).
export interface PushSalePayload {
  terminalId: string;
  localSaleId: number;
  cashierUsername: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: string;
  createdAt: string;
  items: Array<{
    productRemoteId: string | null;
    sku: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
}

export async function pushRemoteSale(payload: PushSalePayload): Promise<{ id: string }> {
  // Placeholder: ajustar el path real cuando billing-service exponga
  // un endpoint de ingesta de ventas de POS/terminal.
  return request<{ id: string }>(`/invoices/from-pos`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
