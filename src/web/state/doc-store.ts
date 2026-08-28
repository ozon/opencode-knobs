import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { applyPatch } from "./patch";
import { api } from "../api";
import { clientValidate, ensureValidators } from "./validate";
import type { DocId, DocError } from "../../shared/types";

export class DocStore {
  id: DocId;
  raw = "";
  json: any = null;
  exists = false;
  dirty = false;
  parseErrors: DocError[] = [];
  schemaErrors: DocError[] = [];
  loaded = false;
  serverVersion = "";
  schema: any = null;
  defs: Record<string, any> = {};
  defName = "";

  get valid(): boolean {
    return this.parseErrors.length === 0 && this.schemaErrors.length === 0;
  }

  get allErrors(): DocError[] {
    return [...this.parseErrors, ...this.schemaErrors];
  }

  constructor(id: DocId) {
    this.id = id;
  }

  setText(raw: string, opts: { dirty?: boolean } = {}) {
    this.raw = raw;
    const parseErrs: ParseError[] = [];
    this.json = parse(raw, parseErrs, { allowTrailingComma: true, disallowComments: false });
    this.parseErrors = parseErrs.map((e) => ({
      path: "",
      message: `${printParseErrorCode(e.error)} at offset ${e.offset}`,
      source: "parse" as const,
      offset: e.offset,
      length: e.length,
    }));
    this.schemaErrors = this.parseErrors.length === 0 && this.json !== null ? clientValidate(this.id, this.json) : [];
    if (opts.dirty !== false) this.dirty = true;
  }

  patch(path: (string | number)[], value: unknown) {
    const trimmed = this.raw.trim() === "" ? "{}" : this.raw;
    this.setText(applyPatch(trimmed, path, value));
  }

  async load() {
    const [configRes, schemaRes] = await Promise.all([api.getConfig(this.id), api.getSchema(this.id)]);
    this.schema = schemaRes;
    this.defs = (schemaRes as any).$defs ?? {};
    this.raw = configRes.raw;
    this.exists = configRes.exists;
    this.serverVersion = configRes.schemaVersion;
    if (configRes.raw) {
      await ensureValidators();
      this.setText(configRes.raw, { dirty: false });
    }
    this.dirty = false;
    this.loaded = true;
  }

  async save(force = false): Promise<{ ok: boolean; status: number; errors?: DocError[] }> {
    if (!this.dirty) return { ok: true, status: 200 };
    if (!this.valid && !force) return { ok: false, status: 422, errors: this.allErrors };
    try {
      const res = await api.saveConfig(this.id, this.raw, force);
      this.dirty = false;
      return { ok: true, status: 200 };
    } catch (e: any) {
      return { ok: false, status: e.status, errors: e.body?.errors };
    }
  }
}
