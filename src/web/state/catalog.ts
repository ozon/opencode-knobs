import { api, type MetaResponse } from "../api";

let snapshot: MetaResponse = { available: false };

export async function loadCatalog() {
  try {
    snapshot = await api.getMeta();
  } catch {
    snapshot = { available: false };
  }
}

export function getCatalog(): MetaResponse {
  return snapshot;
}
