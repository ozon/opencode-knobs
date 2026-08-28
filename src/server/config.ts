import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import Ajv2020 from "ajv/dist/2020.js";
import { DOC_FILES, type DocError, type DocId } from "../shared/types";

const schemasDir = new URL("../../schemas/", import.meta.url);

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== "" ? xdg : join(homedir(), ".config");
  return join(base, "opencode");
}

export function docPath(doc: DocId): string {
  return join(configDir(), DOC_FILES[doc]);
}

export function parseRaw(raw: string): { json: unknown; errors: DocError[] } {
  const parseErrors: ParseError[] = [];
  const json = parse(raw, parseErrors, { allowTrailingComma: true, disallowComments: false });
  const errors: DocError[] = parseErrors.map((e) => ({
    path: "",
    message: `${printParseErrorCode(e.error)} at offset ${e.offset}`,
    source: "parse",
    offset: e.offset,
    length: e.length,
  }));
  return { json: json ?? null, errors };
}

export interface LoadedDoc {
  raw: string;
  json: unknown;
  exists: boolean;
  errors: DocError[];
  valid: boolean;
}

export function loadDoc(doc: DocId): LoadedDoc {
  const path = docPath(doc);
  if (!existsSync(path)) {
    return { raw: "", json: null, exists: false, errors: [], valid: true };
  }
  const raw = readFileSync(path, "utf8");
  const { json, errors } = parseRaw(raw);
  if (errors.length === 0) errors.push(...validateDoc(doc, json));
  return { raw, json, exists: true, errors, valid: errors.length === 0 };
}

let ajv: InstanceType<typeof Ajv2020> | undefined;
const validators = new Map<DocId, ReturnType<InstanceType<typeof Ajv2020>["compile"]>>();

function getValidator(doc: DocId) {
  let v = validators.get(doc);
  if (v) return v;
  if (!ajv) {
    ajv = new Ajv2020({ allErrors: true, strict: false });
    const modelSchema = JSON.parse(readFileSync(new URL("model-schema.json", schemasDir), "utf8"));
    ajv.addSchema(modelSchema);
  }
  const schema = JSON.parse(readFileSync(new URL(`${doc}.json`, schemasDir), "utf8"));
  v = ajv.compile(schema);
  validators.set(doc, v);
  return v;
}

export function validateDoc(doc: DocId, json: unknown): DocError[] {
  const validate = getValidator(doc);
  if (validate(json)) return [];
  return (validate.errors ?? []).map((e) => ({
    path: e.instancePath,
    message: `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
    source: "schema" as const,
  }));
}

export function schemaManifest(): { fetchedAt: string } {
  return JSON.parse(readFileSync(new URL("manifest.json", schemasDir), "utf8"));
}
