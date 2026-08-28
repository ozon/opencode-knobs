export type DocId = "config" | "tui";

export const DOC_FILES: Record<DocId, string> = {
  config: "opencode.json",
  tui: "tui.json",
};

export const DOC_SCHEMA_URL: Record<DocId, string> = {
  config: "https://opencode.ai/config.json",
  tui: "https://opencode.ai/tui.json",
};

export interface DocError {
  path: string;
  message: string;
  source: "parse" | "schema";
  offset?: number;
  length?: number;
}

export interface ConfigResponse {
  raw: string;
  json: unknown;
  exists: boolean;
  valid: boolean;
  errors: DocError[];
  schemaVersion: string;
}

export interface SaveResponse {
  valid: boolean;
  errors: DocError[];
  backupPath?: string;
}

export interface ProviderModelMeta {
  id: string;
  name?: string;
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number; cache?: number };
}

export interface ProviderMeta {
  id: string;
  name?: string;
  npm?: string;
  env?: string[];
  models: ProviderModelMeta[];
}

export interface ModelsSnapshot {
  available: boolean;
  fetchedAt?: string;
  providers?: ProviderMeta[];
}
