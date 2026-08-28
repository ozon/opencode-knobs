import type { DocError, DocId } from "../../shared/types";

let configValidator: ((data: unknown) => boolean) | null = null;
let tuiValidator: ((data: unknown) => boolean) | null = null;
let configErrors: ((data: unknown) => any[]) | null = null;
let tuiErrors: ((data: unknown) => any[]) | null = null;

async function loadValidators() {
  const [{ default: Ajv2020 }, configSchema, tuiSchema, modelSchema] = await Promise.all([
    import("ajv/dist/2020.js"),
    fetch("/api/schema/config").then((r) => r.json()),
    fetch("/api/schema/tui").then((r) => r.json()),
    fetch("https://models.dev/model-schema.json").then((r) => r.json()).catch(() => ({ $defs: { Model: { type: "string" } } })),
  ]);
  const ajv = new Ajv2020.default({ allErrors: true, strict: false });
  ajv.addSchema(modelSchema);
  configValidator = ajv.compile(configSchema);
  tuiValidator = ajv.compile(tuiSchema);
  configErrors = (data) => configValidator!(data) ? [] : (configValidator!.errors ?? []);
  tuiErrors = (data) => tuiValidator!(data) ? [] : (tuiValidator!.errors ?? []);
}

let validatorsReady: Promise<void> | null = null;

export async function ensureValidators() {
  if (!validatorsReady) validatorsReady = loadValidators();
  await validatorsReady;
}

export function clientValidate(doc: DocId, json: unknown): DocError[] {
  if (doc === "config" && configValidator && configErrors) {
    return configValidator(json) ? [] : configErrors(json).map((e: any) => ({
      path: e.instancePath,
      message: `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
      source: "schema" as const,
    }));
  }
  if (doc === "tui" && tuiValidator && tuiErrors) {
    return tuiValidator(json) ? [] : tuiErrors(json).map((e: any) => ({
      path: e.instancePath,
      message: `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
      source: "schema" as const,
    }));
  }
  return [];
}
