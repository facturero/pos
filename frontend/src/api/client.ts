const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getToken(): string | null {
  return localStorage.getItem("pos_token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("pos_token", token);
  else localStorage.removeItem("pos_token");
}

// El backend corre en 127.0.0.1 en el mismo equipo, así que "sin conexión"
// acá casi siempre significa el backend caído (no internet — eso lo maneja
// el propio backend con su cola de sync), no el frontend.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("No se pudo conectar con el servicio local del POS", 0);
  }

  if (res.status === 401) {
    setToken(null);
    throw new ApiError("Sesión expirada, inicia sesión de nuevo", 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Error inesperado" }));
    throw new ApiError(body.error ?? "Error inesperado", res.status);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
