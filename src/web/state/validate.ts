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
  try {
    ajv.addSchema(modelSchema, "https://models.dev/model-schema.json");
  } catch (e) {
    console.error("model schema add failed", e);
  }
  try {
    configValidator = ajv.compile(configSchema);
  } catch (e) {
    console.error("config schema compile failed", e);
  }
  try {
    tuiValidator = ajv.compile(tuiSchema);
  } catch (e) {
    console.error("tui schema compile failed", e);
  }
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
