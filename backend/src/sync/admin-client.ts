// Cliente HTTP hacia tu admin central. Ajusta las rutas exactas
// (`/products`, `/sales`, etc.) a como las expone tu API real —
// aquí quedan como convención razonable, fáciles de cambiar en un solo lugar.

const BASE_URL = process.env.ADMIN_API_BASE_URL ?? "";
const TOKEN = process.env.ADMIN_API_TOKEN ?? "";
const TERMINAL_ID = process.env.TERMINAL_ID ?? "pos-desconocido";

class AdminApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL) {
    throw new AdminApiError("ADMIN_API_BASE_URL no configurado en .env");
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      "X-Terminal-Id": TERMINAL_ID,
      ...(init?.headers ?? {}),
    },
    // Si el admin no responde rápido, no queremos que la sesión de sync
    // se quede colgada — mejor fallar rápido y reintentar en el próximo ciclo.
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AdminApiError(`Admin API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export interface RemoteProduct {
  id: number;
  sku?: string | null;
  barcode?: string | null;
  name: string;
  description?: string | null;
  price: number;
  cost?: number | null;
  stock: number;
  unit?: string;
  active: boolean;
  categoryId?: number | null;
  categoryName?: string | null;
}

export interface RemoteCategory {
  id: number;
  name: string;
}

// GET /products?updatedSince=ISO — pull incremental para no traer el catálogo
// completo cada vez. Si tu admin no soporta este filtro todavía, quita el
// query param y siempre traerá todo (funciona, solo es menos eficiente).
export async function fetchRemoteProducts(updatedSince?: Date): Promise<RemoteProduct[]> {
  const qs = updatedSince ? `?updatedSince=${updatedSince.toISOString()}` : "";
  return request<RemoteProduct[]>(`/products${qs}`);
}

export async function fetchRemoteCategories(): Promise<RemoteCategory[]> {
  return request<RemoteCategory[]>(`/categories`);
}

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
    productRemoteId: number | null;
    sku: string | null;
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }>;
}

// POST /sales — sube una venta local. Se espera que el admin devuelva
// { id: number } con el id que le asignó, para guardarlo como remoteId.
export async function pushRemoteSale(payload: PushSalePayload): Promise<{ id: number }> {
  return request<{ id: number }>(`/sales`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
