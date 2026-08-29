import type { DocError, DocId } from "../../shared/types";
import type { ValidateFunction } from "ajv";

let configValidator: ValidateFunction | null = null;
let tuiValidator: ValidateFunction | null = null;

async function loadValidators() {
  const [{ default: Ajv2020 }, configSchema, tuiSchema, modelSchema] = await Promise.all([
    import("ajv/dist/2020.js"),
    fetch("/api/schema/config").then((r) => r.json()),
    fetch("/api/schema/tui").then((r) => r.json()),
    fetch("/api/schema/model").then((r) => r.json()).catch(() => ({ $defs: { Model: { type: "string" } } })),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(modelSchema);
  configValidator = ajv.compile(configSchema);
  tuiValidator = ajv.compile(tuiSchema);
}

let validatorsReady: Promise<void> | null = null;

export async function ensureValidators() {
  if (!validatorsReady) validatorsReady = loadValidators();
  await validatorsReady;
}

export function clientValidate(doc: DocId, json: unknown): DocError[] {
  const validator = doc === "config" ? configValidator : tuiValidator;
  if (!validator) return [];
  if (validator(json)) return [];
  return (validator.errors ?? []).map((e) => ({
    path: e.instancePath ?? "",
    message: `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
    source: "schema" as const,
  }));
}
