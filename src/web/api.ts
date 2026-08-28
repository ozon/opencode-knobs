export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`API ${status}`);
    this.status = status;
    this.body = body;
  }
}

const BASE = "";

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined || method !== "GET") {
    headers["content-type"] = "application/json";
    headers["x-requested-with"] = "fetch";
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "same-origin",
    headers: { ...headers, ...init?.headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export interface LoginResponse { ok: true }
export interface ConfigResponse {
  raw: string;
  json: unknown;
  exists: boolean;
  valid: boolean;
  errors: Array<{ path: string; message: string; source: "parse" | "schema"; offset?: number; length?: number }>;
  schemaVersion: string;
}
export interface SaveResponse { valid: boolean; errors: ConfigResponse["errors"]; backupPath?: string }
export interface HealthResponse { ok: true }
export interface SchemaResponse { $defs?: Record<string, unknown>; properties?: Record<string, unknown>; [key: string]: unknown }
export interface ModelInfo { id: string; name?: string; limit?: { context?: number }; cost?: { input?: number; output?: number; cache?: number } }
export interface ProviderInfo { id: string; name?: string; npm?: string; env?: string[]; models: ModelInfo[] }
export interface MetaResponse { available: boolean; fetchedAt?: string; providers?: ProviderInfo[] }

export const api = {
  login: (code: string) => request<LoginResponse>("POST", "/api/login", { code }),
  logout: () => request<{ ok: true }>("POST", "/api/logout"),
  health: () => request<HealthResponse>("GET", "/api/health"),
  getConfig: (doc: "config" | "tui") => request<ConfigResponse>("GET", `/api/config/${doc}`),
  saveConfig: (doc: "config" | "tui", raw: string, force = false) => request<SaveResponse>("PUT", `/api/config/${doc}`, { raw, force }),
  getSchema: (doc: "config" | "tui") => request<SchemaResponse>("GET", `/api/schema/${doc}`),
  getMeta: () => request<MetaResponse>("GET", "/api/meta/providers"),
};
