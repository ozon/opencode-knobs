import type { ModelsSnapshot, ProviderMeta } from "../shared/types";

const MODELS_URL = "https://models.dev/api.json";
const FETCH_TIMEOUT_MS = 5000;

let snapshot: ModelsSnapshot = { available: false };

export function getModelsSnapshot(): ModelsSnapshot {
  return snapshot;
}

export function startModelsFetch(): void {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  fetch(MODELS_URL, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`models.dev returned ${res.status}`);
      const data = (await res.json()) as Record<string, any>;
      const providers: ProviderMeta[] = Object.entries(data).map(([id, p]) => ({
        id,
        name: p?.name,
        npm: p?.npm,
        env: Array.isArray(p?.env) ? p.env : undefined,
        models: Object.values<any>(p?.models ?? {}).map((m) => ({
          id: m?.id,
          name: m?.name,
          limit: m?.limit,
          cost: m?.cost,
        })),
      }));
      snapshot = { available: true, fetchedAt: new Date().toISOString(), providers };
    })
    .catch(() => {
      snapshot = { available: false };
    })
    .finally(() => clearTimeout(timer));
}