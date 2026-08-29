# opencode-knobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Bun + Hono + Svelte 5 web app that edits `~/.config/opencode/opencode.json` and `~/.config/opencode/tui.json` through a GUI + raw JSONC editor, preserving comments/placeholders byte-identically, validated against vendored opencode JSON Schemas.

**Architecture:** Single Bun process serves the built Svelte frontend and a session-protected JSON API. The frontend holds one canonical raw-text document state per file; GUI edits are applied client-side as path-based `jsonc-parser` patches; the server re-validates (Ajv draft 2020-12) and persists verbatim via backup + atomic write.

**Tech Stack:** Bun 1.3+, Hono 4.13, Svelte 5 (runes), Vite 8, CodeMirror 6 (+ `@shopify/lang-jsonc`), Ajv 8 (draft 2020-12), `jsonc-parser` 3.3, `bun test`.

**Specs:** `SPEC.md` (requirements, quoted as VAL-x/CFG-x/AUTH-x/etc.) and `docs/superpowers/specs/2026-08-28-opencode-knobs-design.md` (design decisions D1–D4, review changes R1–R4, C1–C2).

## Global Constraints

- Runtime **Bun**; server **Hono v4.13+**; build **Vite 8**; UI **Svelte 5 + TypeScript**; raw editor **CodeMirror 6**; validation **Ajv draft 2020-12**; JSONC via **jsonc-parser**; tests via **bun test**. No other runtime dependencies.
- Everything TypeScript end-to-end; UI, code, and docs in English. No code comments unless a requirement demands one.
- Never invent configuration keys: vendored schemas (`schemas/`) are the single source of truth.
- Exactly two documents: `~/.config/opencode/opencode.json` and `~/.config/opencode/tui.json`. Honor `XDG_CONFIG_HOME` if set, else `~/.config`. No project configs, no env-var layers, no file watcher.
- Placeholders `{env:VAR}` / `{file:path}` are never resolved or rewritten; untouched file regions stay byte-identical.
- Secrets (at minimum `provider.*.options.apiKey`) masked in GUI; untouched secrets emit no patch.
- Deprecated schema properties are hidden in the GUI but round-trip in raw mode.
- Default bind `127.0.0.1:4789`; flags `--host`, `--port`, `--idle-timeout` (minutes, default 30, `0` disables).
- No telemetry; only external calls: models.dev at startup, schema fetch at build time.
- Commit after every task (steps include the exact commit).

## File Structure

```
opencode-knobs/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── scripts/
│   ├── update-schemas.ts      # vendors schemas + manifest
│   ├── start.ts               # build-if-missing + run server
│   └── dev.ts                 # dev: watch server + vite dev
├── schemas/                   # committed: config.json, tui.json, model-schema.json, manifest.json
├── src/
│   ├── shared/types.ts        # DocId, DocError, API response types
│   ├── server/
│   │   ├── config.ts          # paths, load, validate, backup, atomic write
│   │   ├── auth.ts            # code gen, verify, sessions, rate limiter
│   │   ├── models.ts          # models.dev fetch + cache
│   │   ├── app.ts             # Hono app: middleware + API + static
│   │   └── index.ts           # CLI flags, startup, idle timer, Bun.serve
│   └── web/
│       ├── index.html
│       ├── main.ts
│       ├── app.css
│       ├── api.ts             # fetch wrapper
│       ├── App.svelte         # login gate + shell (tabs, save)
│       ├── Login.svelte
│       ├── state/
│       │   ├── patch.ts       # detectIndent, applyPatch (pure, tested)
│       │   ├── validate.ts    # client Ajv setup
│       │   └── doc-store.svelte.ts
│       ├── schema/walker.ts   # ref resolution, deprecated detection, entries
│       ├── components/        # Field, StringList, KVEditor, MaskedSecret, Combobox, SchemaForm
│       └── sections/          # General, Providers, Agents, Mcp, Permissions, FormatterLsp, Tui, Misc, Raw
└── test/
    ├── patch.test.ts
    ├── config.test.ts
    ├── auth.test.ts
    ├── validation.test.ts
    └── e2e.test.ts
```

---

### Task 1: Project scaffolding + schema vendoring

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `scripts/update-schemas.ts`, `schemas/*`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `schemas/config.json`, `schemas/tui.json`, `schemas/model-schema.json`, `schemas/manifest.json` consumed by server validation (Task 2) and client validation (Task 11); npm scripts `start`, `build`, `dev`, `test`, `update-schemas` used by all later tasks.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "opencode-knobs",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun scripts/start.ts",
    "dev": "bun scripts/dev.ts",
    "build": "vite build",
    "test": "bun test",
    "update-schemas": "bun scripts/update-schemas.ts"
  },
  "dependencies": {
    "ajv": "^8.20.0",
    "hono": "^4.13.5",
    "jsonc-parser": "^3.3.1"
  },
  "devDependencies": {
    "@codemirror/lang-json": "^6.0.2",
    "@codemirror/language": "^6.11.0",
    "@codemirror/lint": "^6.9.7",
    "@codemirror/state": "^6.7.1",
    "@codemirror/view": "^6.43.9",
    "@shopify/lang-jsonc": "^1.0.1",
    "@sveltejs/vite-plugin-svelte": "^7.3.0",
    "@types/bun": "^1.3.0",
    "codemirror": "^6.0.2",
    "svelte": "^5.56.10",
    "typescript": "^5.9.0",
    "vite": "^8.2.2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "types": ["@types/bun"]
  },
  "include": ["src", "scripts", "test", "vite.config.ts"]
}
```

- [ ] **Step 3: Write `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  root: "src/web",
  plugins: [svelte()],
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:4789" },
  },
});
```

- [ ] **Step 4: Update `.gitignore`** (keep existing entries, append)

```
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 5: Write `scripts/update-schemas.ts`**

```ts
import { mkdir } from "node:fs/promises";

const FILES: Record<string, string> = {
  "config.json": "https://opencode.ai/config.json",
  "tui.json": "https://opencode.ai/tui.json",
  "model-schema.json": "https://models.dev/model-schema.json",
};

const outDir = new URL("../schemas/", import.meta.url);
await mkdir(outDir, { recursive: true });

const manifest = {
  fetchedAt: new Date().toISOString(),
  files: {} as Record<string, { url: string; bytes: number }>,
};

for (const [name, url] of Object.entries(FILES)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  const text = await res.text();
  JSON.parse(text);
  await Bun.write(new URL(name, outDir), text);
  manifest.files[name] = { url, bytes: text.length };
  console.log(`vendored ${name} (${text.length} bytes)`);
}

await Bun.write(new URL("manifest.json", outDir), JSON.stringify(manifest, null, 2) + "\n");
console.log("schemas updated");
```

- [ ] **Step 6: Install dependencies and vendor schemas**

Run: `bun install && bun run update-schemas`
Expected: install succeeds; three `vendored …` lines plus `schemas updated`; `schemas/` contains 4 files.

- [ ] **Step 7: Verify schema assumptions used by later tasks**

Run:
```bash
python3 -c "
import json
c=json.load(open('schemas/config.json'))
assert c['\$ref']=='#/\$defs/Config'
assert c['\$defs']['Config']['additionalProperties'] is False
t=json.load(open('schemas/tui.json'))
assert 'keybinds' in t['properties']
m=json.load(open('schemas/model-schema.json'))
assert '\$id' in m and 'Model' in m['\$defs']
print('ok')"
```
Expected: `ok`. (config.json root is a `$ref` into `$defs.Config`; model-schema.json has an `$id` Ajv can register; config.json references it externally.)

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vite.config.ts .gitignore scripts/update-schemas.ts schemas/ bun.lock
git commit -m "scaffold project and vendor opencode schemas"
```

---

### Task 2: Shared types + config load/validate pipeline

**Files:**
- Create: `src/shared/types.ts`, `src/server/config.ts`, `test/config.test.ts`

**Interfaces:**
- Produces (used by Task 3, 6, 8):
  - `type DocId = "config" | "tui"`
  - `interface DocError { path: string; message: string; source: "parse" | "schema"; offset?: number; length?: number }` (C2 shape)
  - `configDir(): string`, `docPath(doc: DocId): string`
  - `loadDoc(doc: DocId): LoadedDoc` where `interface LoadedDoc { raw: string; json: unknown; exists: boolean; errors: DocError[]; valid: boolean }`
  - `validateDoc(doc: DocId, json: unknown): DocError[]`
  - `schemaManifest(): { fetchedAt: string }`

- [ ] **Step 1: Write `src/shared/types.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing test `test/config.test.ts` (load/validate part)**

```ts
import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDir, docPath, loadDoc, validateDoc } from "../src/server/config";

beforeEach(() => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "knobs-"));
});

test("configDir honors XDG_CONFIG_HOME", () => {
  const xdg = process.env.XDG_CONFIG_HOME!;
  expect(configDir()).toBe(join(xdg, "opencode"));
});

test("docPath resolves both documents", () => {
  expect(docPath("config").endsWith("opencode/opencode.json")).toBe(true);
  expect(docPath("tui").endsWith("opencode/tui.json")).toBe(true);
});

test("loadDoc on missing file returns empty doc", () => {
  const doc = loadDoc("config");
  expect(doc.exists).toBe(false);
  expect(doc.raw).toBe("");
  expect(doc.json).toBeNull();
  expect(doc.errors).toEqual([]);
  expect(doc.valid).toBe(true);
});

test("loadDoc parses JSONC with comments and trailing commas", () => {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(
    docPath("config"),
    '{\n  // a comment\n  "model": "anthropic/claude-2",\n}\n',
  );
  const doc = loadDoc("config");
  expect(doc.exists).toBe(true);
  expect(doc.json).toEqual({ model: "anthropic/claude-2" });
  expect(doc.errors).toEqual([]);
  expect(doc.valid).toBe(true);
});

test("loadDoc surfaces parse errors with offsets", () => {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(docPath("config"), '{\n  "model": \n}\n');
  const doc = loadDoc("config");
  expect(doc.valid).toBe(false);
  expect(doc.errors.length).toBeGreaterThan(0);
  expect(doc.errors[0].source).toBe("parse");
  expect(typeof doc.errors[0].offset).toBe("number");
});

test("validateDoc accepts valid config and rejects unknown keys", () => {
  expect(validateDoc("config", { model: "anthropic/claude-2" })).toEqual([]);
  const errors = validateDoc("config", { not_a_real_key: true });
  expect(errors.length).toBeGreaterThan(0);
  expect(errors[0].source).toBe("schema");
});

test("validateDoc resolves external models.dev $ref offline", () => {
  expect(validateDoc("config", { model: 42 }).length).toBeGreaterThan(0);
});

test("validateDoc validates tui document", () => {
  expect(validateDoc("tui", { theme: "dark" })).toEqual([]);
  expect(validateDoc("tui", { diff_style: "bogus" }).length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test test/config.test.ts`
Expected: FAIL — `Cannot find module '../src/server/config'`

- [ ] **Step 4: Write `src/server/config.ts` (load/validate part)**

```ts
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
  const json = parse(raw, parseErrors, { allowTrailingCommas: true, disallowComments: false });
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test test/config.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/server/config.ts test/config.test.ts
git commit -m "config pipeline: load and validate against vendored schemas"
```

---

### Task 3: Config save pipeline — backup, rotation, atomic write, force semantics

**Files:**
- Modify: `src/server/config.ts` (append)
- Modify: `test/config.test.ts` (append)

**Interfaces:**
- Consumes: `parseRaw`, `validateDoc`, `docPath`, `configDir` from Task 2.
- Produces (used by Task 6):
  - `type SaveOutcome = { status: "syntax"; errors: DocError[] } | { status: "schema"; errors: DocError[] } | { status: "ok"; backupPath?: string }`
  - `saveDoc(doc: DocId, raw: string, force: boolean): SaveOutcome` (R1 semantics)
  - `createBackup(filePath: string): string`, `rotateBackups(filePath: string, keep?: number): void`, `atomicWrite(filePath: string, content: string): void`

- [ ] **Step 1: Append failing tests to `test/config.test.ts`**

```ts
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { saveDoc, createBackup, rotateBackups } from "../src/server/config";

const VALID_CONFIG = '{\n  "model": "anthropic/claude-2"\n}\n';

test("saveDoc writes valid doc and creates parent dirs", () => {
  const result = saveDoc("config", VALID_CONFIG, false);
  expect(result.status).toBe("ok");
  expect(readFileSync(docPath("config"), "utf8")).toBe(VALID_CONFIG);
});

test("saveDoc writes received raw text verbatim (no reformat)", () => {
  const odd = '{\n      "model":   "anthropic/claude-2" ,  "snapshot": false\n   }\n';
  const result = saveDoc("config", odd, false);
  expect(result.status).toBe("ok");
  expect(readFileSync(docPath("config"), "utf8")).toBe(odd);
});

test("saveDoc rejects syntax errors even with force (HTTP 400 case)", () => {
  const result = saveDoc("config", '{\n  "model": \n}\n', true);
  expect(result.status).toBe("syntax");
  expect(existsSync(docPath("config"))).toBe(false);
});

test("saveDoc rejects schema-invalid without force (HTTP 422 case)", () => {
  const result = saveDoc("config", '{\n  "not_a_real_key": 1\n}\n', false);
  expect(result.status).toBe("schema");
  if (result.status === "schema") expect(result.errors.length).toBeGreaterThan(0);
  expect(existsSync(docPath("config"))).toBe(false);
});

test("saveDoc writes schema-invalid with force and backs up existing file", () => {
  saveDoc("config", VALID_CONFIG, false);
  const result = saveDoc("config", '{\n  "not_a_real_key": 1\n}\n', true);
  expect(result.status).toBe("ok");
  if (result.status === "ok") expect(result.backupPath).toContain(".bak-");
  const backups = readdirSync(configDir()).filter((f) => f.includes(".bak-"));
  expect(backups.length).toBe(1);
  expect(readFileSync(docPath("config"), "utf8")).toContain("not_a_real_key");
});

test("createBackup names file with timestamp and rotateBackups keeps newest 5", () => {
  mkdirSync(configDir(), { recursive: true });
  const p = docPath("config");
  writeFileSync(p, "{}");
  for (let i = 1; i <= 7; i++) {
    copyFileSync(p, `${p}.bak-2026010${i}-000000`);
  }
  rotateBackups(p, 5);
  const remaining = readdirSync(configDir()).filter((f) => f.includes(".bak-")).sort();
  expect(remaining.length).toBe(5);
  expect(remaining).not.toContain("opencode.json.bak-20260101-000000");
  expect(remaining).not.toContain("opencode.json.bak-20260102-000000");
  const backupPath = createBackup(p);
  expect(backupPath).toMatch(/opencode\.json\.bak-\d{8}-\d{6}$/);
});

test("saveDoc round-trip preserves comments and placeholders outside edited path", () => {
  mkdirSync(configDir(), { recursive: true });
  const original = [
    "{",
    "  // keep me",
    '  "model": "anthropic/claude-2",',
    '  "provider": {',
    '    "anthropic": { "options": { "apiKey": "{env:ANTHROPIC_API_KEY}" } }',
    "  }",
    "}",
  ].join("\n");
  writeFileSync(docPath("config"), original);
  const doc = loadDoc("config");
  expect(doc.valid).toBe(true);
  const result = saveDoc("config", doc.raw, false);
  expect(result.status).toBe("ok");
  expect(readFileSync(docPath("config"), "utf8")).toBe(original);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/config.test.ts`
Expected: FAIL — `saveDoc` is not exported / undefined

- [ ] **Step 3: Append implementation to `src/server/config.ts`**

Add imports at top (merge with existing): `copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync` from `node:fs`; `dirname, basename` from `node:path`; `randomBytes` from `node:crypto`.

```ts
export type SaveOutcome =
  | { status: "syntax"; errors: DocError[] }
  | { status: "schema"; errors: DocError[] }
  | { status: "ok"; backupPath?: string };

export function atomicWrite(filePath: string, content: string): void {
  const tmp = join(dirname(filePath), `.${basename(filePath)}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, filePath);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function createBackup(filePath: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupPath = `${filePath}.bak-${stamp}`;
  copyFileSync(filePath, backupPath);
  rotateBackups(filePath);
  return backupPath;
}

export function rotateBackups(filePath: string, keep = 5): void {
  const dir = dirname(filePath);
  const base = basename(filePath);
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.bak-`))
    .sort()
    .reverse();
  for (const old of backups.slice(keep)) {
    rmSync(join(dir, old));
  }
}

export function saveDoc(doc: DocId, raw: string, force: boolean): SaveOutcome {
  const { json, errors } = parseRaw(raw);
  if (errors.length > 0) return { status: "syntax", errors };
  const schemaErrors = validateDoc(doc, json);
  if (schemaErrors.length > 0 && !force) return { status: "schema", errors: schemaErrors };
  const path = docPath(doc);
  mkdirSync(dirname(path), { recursive: true });
  let backupPath: string | undefined;
  if (existsSync(path)) backupPath = createBackup(path);
  atomicWrite(path, raw);
  return { status: "ok", backupPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/config.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts test/config.test.ts
git commit -m "config pipeline: backup rotation, atomic write, force semantics"
```

---
### Task 4: Auth — code generation, sessions, rate limiting

**Files:**
- Create: `src/server/auth.ts`, `test/auth.test.ts`

**Interfaces:**
- Produces (used by Task 6):
  - `CODE_ALPHABET: string`, `generateCode(): string`
  - `verifyCode(input: string): boolean` (constant-time)
  - `createSession(): string`, `hasSession(token: string | undefined): boolean`, `destroySession(token: string): void`
  - `checkRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number }`, `recordFailure(ip: string): void`, `resetRateLimits(): void`
  - `initAuth(code: string): void` — sets the expected code (fresh per start, AUTH-2)

- [ ] **Step 1: Write the failing test `test/auth.test.ts`**

```ts
import { beforeEach, expect, test } from "bun:test";
import {
  CODE_ALPHABET,
  generateCode,
  initAuth,
  verifyCode,
  createSession,
  hasSession,
  destroySession,
  checkRateLimit,
  recordFailure,
  resetRateLimits,
} from "../src/server/auth";

beforeEach(() => {
  initAuth("TESTCODE");
  resetRateLimits();
});

test("code alphabet excludes ambiguous characters", () => {
  expect(CODE_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  expect(CODE_ALPHABET).not.toContain("0");
  expect(CODE_ALPHABET).not.toContain("O");
  expect(CODE_ALPHABET).not.toContain("1");
  expect(CODE_ALPHABET).not.toContain("I");
});

test("generateCode produces 8 chars from the alphabet", () => {
  for (let i = 0; i < 50; i++) {
    const code = generateCode();
    expect(code.length).toBe(8);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  }
});

test("verifyCode accepts exact match and rejects others", () => {
  expect(verifyCode("TESTCODE")).toBe(true);
  expect(verifyCode("testcode")).toBe(false);
  expect(verifyCode("TESTCOD")).toBe(false);
  expect(verifyCode("TESTCODEX")).toBe(false);
  expect(verifyCode("")).toBe(false);
});

test("session lifecycle", () => {
  const token = createSession();
  expect(token.length).toBeGreaterThanOrEqual(43);
  expect(hasSession(token)).toBe(true);
  expect(hasSession("bogus")).toBe(false);
  expect(hasSession(undefined)).toBe(false);
  destroySession(token);
  expect(hasSession(token)).toBe(false);
});

test("restart invalidates sessions (new initAuth clears store)", () => {
  const token = createSession();
  initAuth("NEWCODE1");
  expect(hasSession(token)).toBe(false);
});

test("rate limit locks out after 5 failures for 30s", () => {
  for (let i = 0; i < 5; i++) {
    expect(checkRateLimit("1.2.3.4").allowed).toBe(true);
    recordFailure("1.2.3.4");
  }
  const blocked = checkRateLimit("1.2.3.4");
  expect(blocked.allowed).toBe(false);
  expect(blocked.retryAfterMs).toBeGreaterThan(0);
  expect(blocked.retryAfterMs).toBeLessThanOrEqual(30_000);
  expect(checkRateLimit("5.6.7.8").allowed).toBe(true);
});

test("rate limit resets after lockout window", () => {
  for (let i = 0; i < 5; i++) recordFailure("9.9.9.9");
  expect(checkRateLimit("9.9.9.9").allowed).toBe(false);
  const realNow = Date.now;
  Date.now = () => realNow() + 31_000;
  try {
    expect(checkRateLimit("9.9.9.9").allowed).toBe(true);
  } finally {
    Date.now = realNow;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/auth.test.ts`
Expected: FAIL — `Cannot find module '../src/server/auth'`

- [ ] **Step 3: Write `src/server/auth.ts`**

```ts
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;

let expectedCode = "";
const sessions = new Map<string, number>();
const failures = new Map<string, { count: number; lockedUntil: number }>();

export function initAuth(code: string): void {
  expectedCode = code;
  sessions.clear();
  failures.clear();
}

export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function verifyCode(input: string): boolean {
  if (expectedCode === "") return false;
  const a = digest(input);
  const b = digest(expectedCode);
  return timingSafeEqual(a, b);
}

export function createSession(): string {
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, Date.now());
  return token;
}

export function hasSession(token: string | undefined): boolean {
  return token !== undefined && sessions.has(token);
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
  const entry = failures.get(ip);
  if (!entry) return { allowed: true };
  if (entry.lockedUntil > Date.now()) {
    return { allowed: false, retryAfterMs: entry.lockedUntil - Date.now() };
  }
  if (entry.lockedUntil !== 0) failures.delete(ip);
  return { allowed: true };
}

export function recordFailure(ip: string): void {
  const entry = failures.get(ip) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILURES) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  failures.set(ip, entry);
}

export function resetRateLimits(): void {
  failures.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/auth.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server/auth.ts test/auth.test.ts
git commit -m "auth: one-time code, sessions, rate limiting"
```

---

### Task 5: models.dev metadata fetcher

**Files:**
- Create: `src/server/models.ts`

**Interfaces:**
- Produces (used by Task 6):
  - `startModelsFetch(): void` — non-blocking, 5 s timeout (META-1)
  - `getModelsSnapshot(): ModelsSnapshot` — `{ available: false }` until/unless fetch succeeds (META-4)

- [ ] **Step 1: Write `src/server/models.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/server/models.ts
git commit -m "models.dev metadata fetcher with in-memory cache"
```

---

### Task 6: Hono app — middleware, API routes, static serving

**Files:**
- Create: `src/server/app.ts`, `test/validation.test.ts`

**Interfaces:**
- Consumes: Task 2/3 (`loadDoc`, `saveDoc`, `schemaManifest`), Task 4 (auth), Task 5 (models).
- Produces (used by Task 7, 8): `createApp(opts: { host: string; port: number }): Hono` implementing the API table from design §3.3, including R1 force semantics (400 syntax / 422 schema / force bypass) and R3 Host rules.

- [ ] **Step 1: Write the failing test `test/validation.test.ts`**

```ts
import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app";
import { initAuth, createSession } from "../src/server/auth";
import { configDir, docPath } from "../src/server/config";

const VALID = '{\n  "model": "anthropic/claude-2"\n}\n';

function authedHeaders(token: string, host = "127.0.0.1:4789") {
  return {
    "content-type": "application/json",
    "x-requested-with": "fetch",
    cookie: `knobs_session=${token}`,
    host,
  };
}

let app: ReturnType<typeof createApp>;
let token: string;

beforeEach(() => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "knobs-"));
  initAuth("TESTCODE");
  token = createSession();
  app = createApp({ host: "127.0.0.1", port: 4789 });
});

test("PUT valid doc writes file and returns ok", async () => {
  const res = await app.request("/api/config/config", {
    method: "PUT",
    headers: authedHeaders(token),
    body: JSON.stringify({ raw: VALID }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.valid).toBe(true);
  expect(readFileSync(docPath("config"), "utf8")).toBe(VALID);
});

test("PUT schema-invalid without force returns 422 and does not write", async () => {
  const res = await app.request("/api/config/config", {
    method: "PUT",
    headers: authedHeaders(token),
    body: JSON.stringify({ raw: '{\n  "bogus_key": 1\n}\n' }),
  });
  expect(res.status).toBe(422);
  const body = await res.json();
  expect(body.valid).toBe(false);
  expect(body.errors.length).toBeGreaterThan(0);
  expect(body.errors[0].source).toBe("schema");
});

test("PUT schema-invalid with force writes and backs up", async () => {
  await app.request("/api/config/config", {
    method: "PUT",
    headers: authedHeaders(token),
    body: JSON.stringify({ raw: VALID }),
  });
  const res = await app.request("/api/config/config", {
    method: "PUT",
    headers: authedHeaders(token),
    body: JSON.stringify({ raw: '{\n  "bogus_key": 1\n}\n', force: true }),
  });
  expect(res.status).toBe(200);
  expect(readFileSync(docPath("config"), "utf8")).toContain("bogus_key");
  expect(readdirSync(configDir()).some((f) => f.includes(".bak-"))).toBe(true);
});

test("PUT syntax-invalid returns 400 even with force", async () => {
  const res = await app.request("/api/config/config", {
    method: "PUT",
    headers: authedHeaders(token),
    body: JSON.stringify({ raw: "{ nope", force: true }),
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.errors[0].source).toBe("parse");
});

test("GET missing doc returns exists:false with empty raw", async () => {
  const res = await app.request("/api/config/tui", { headers: authedHeaders(token) });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.exists).toBe(false);
  expect(body.raw).toBe("");
});

test("login flow: wrong code 401, right code sets cookie", async () => {
  const bad = await app.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "fetch", host: "127.0.0.1:4789" },
    body: JSON.stringify({ code: "WRONGGGG" }),
  });
  expect(bad.status).toBe(401);
  const good = await app.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "fetch", host: "127.0.0.1:4789" },
    body: JSON.stringify({ code: "TESTCODE" }),
  });
  expect(good.status).toBe(200);
  expect(good.headers.get("set-cookie")).toContain("knobs_session=");
  expect(good.headers.get("set-cookie")).toContain("HttpOnly");
  expect(good.headers.get("set-cookie")).toContain("SameSite=Strict");
});

test("unauthenticated API access returns 401", async () => {
  const res = await app.request("/api/config/config", { headers: { host: "127.0.0.1:4789" } });
  expect(res.status).toBe(401);
});

test("mutating request without X-Requested-With returns 403", async () => {
  const res = await app.request("/api/config/config", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      cookie: `knobs_session=${token}`,
      host: "127.0.0.1:4789",
    },
    body: JSON.stringify({ raw: VALID }),
  });
  expect(res.status).toBe(403);
});

test("host header rules: localhost strict, 0.0.0.0 port-only", async () => {
  const lanApp = createApp({ host: "0.0.0.0", port: 4789 });
  const lan = await lanApp.request("/api/config/config", {
    headers: { ...authedHeaders(token, "192.168.1.5:4789") },
  });
  expect(lan.status).toBe(200);
  const wrongPort = await lanApp.request("/api/config/config", {
    headers: { ...authedHeaders(token, "192.168.1.5:9999") },
  });
  expect(wrongPort.status).toBe(403);
  const rebinding = await app.request("/api/config/config", {
    headers: { ...authedHeaders(token, "evil.example.com:4789") },
  });
  expect(rebinding.status).toBe(403);
  const localhostAlias = await app.request("/api/config/config", {
    headers: { ...authedHeaders(token, "localhost:4789") },
  });
  expect(localhostAlias.status).toBe(200);
});

test("GET schema and meta endpoints", async () => {
  const schema = await app.request("/api/schema/config", { headers: authedHeaders(token) });
  expect(schema.status).toBe(200);
  const s = await schema.json();
  expect(s.$defs.Config).toBeDefined();
  const meta = await app.request("/api/meta/providers", { headers: authedHeaders(token) });
  expect(meta.status).toBe(200);
  const m = await meta.json();
  expect(typeof m.available).toBe("boolean");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/validation.test.ts`
Expected: FAIL — `Cannot find module '../src/server/app'`

- [ ] **Step 3: Write `src/server/app.ts`**

```ts
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serveStatic } from "hono/bun";
import {
  checkRateLimit,
  createSession,
  destroySession,
  hasSession,
  recordFailure,
  verifyCode,
} from "./auth";
import { loadDoc, saveDoc, schemaManifest } from "./config";
import { getModelsSnapshot } from "./models";
import type { DocId } from "../shared/types";

const SESSION_COOKIE = "knobs_session";
const DOCS: DocId[] = ["config", "tui"];
const schemasDir = new URL("../../schemas/", import.meta.url);
const distDir = new URL("../../dist/", import.meta.url).pathname;

export interface AppOptions {
  host: string;
  port: number;
  onAuthenticatedRequest?: () => void;
}

function hostAllowed(boundHost: string, boundPort: number, hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const idx = hostHeader.lastIndexOf(":");
  if (idx === -1) return false;
  const hostname = hostHeader.slice(0, idx);
  const port = hostHeader.slice(idx + 1);
  if (port !== String(boundPort)) return false;
  if (boundHost === "0.0.0.0" || boundHost === "::") return true;
  return hostname === boundHost || (boundHost === "127.0.0.1" && hostname === "localhost");
}

export function createApp(opts: AppOptions) {
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    if (!hostAllowed(opts.host, opts.port, c.req.header("host"))) {
      return c.json({ error: "invalid host header" }, 403);
    }
    await next();
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/login") return next();
    const token = getCookie(c, SESSION_COOKIE);
    if (!hasSession(token)) return c.json({ error: "unauthorized" }, 401);
    opts.onAuthenticatedRequest?.();
    await next();
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (c.req.header("x-requested-with") !== "fetch") {
        return c.json({ error: "missing X-Requested-With header" }, 403);
      }
    }
    await next();
  });

  app.post("/api/login", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const limit = checkRateLimit(ip);
    if (!limit.allowed) {
      return c.json({ error: "too many attempts", retryAfterMs: limit.retryAfterMs }, 429);
    }
    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    if (typeof body.code !== "string" || !verifyCode(body.code)) {
      recordFailure(ip);
      return c.json({ error: "invalid code" }, 401);
    }
    const token = createSession();
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
    });
    opts.onAuthenticatedRequest?.();
    return c.json({ ok: true });
  });

  app.post("/api/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) destroySession(token);
    deleteCookie(c, SESSION_COOKIE);
    return c.json({ ok: true });
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/config/:doc", (c) => {
    const doc = c.req.param("doc") as DocId;
    if (!DOCS.includes(doc)) return c.json({ error: "unknown doc" }, 404);
    const loaded = loadDoc(doc);
    return c.json({
      raw: loaded.raw,
      json: loaded.json,
      exists: loaded.exists,
      valid: loaded.valid,
      errors: loaded.errors,
      schemaVersion: schemaManifest().fetchedAt,
    });
  });

  app.put("/api/config/:doc", async (c) => {
    const doc = c.req.param("doc") as DocId;
    if (!DOCS.includes(doc)) return c.json({ error: "unknown doc" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { raw?: string; force?: boolean };
    if (typeof body.raw !== "string") return c.json({ error: "raw must be a string" }, 400);
    const outcome = saveDoc(doc, body.raw, body.force === true);
    if (outcome.status === "syntax") return c.json({ valid: false, errors: outcome.errors }, 400);
    if (outcome.status === "schema") return c.json({ valid: false, errors: outcome.errors }, 422);
    return c.json({ valid: true, errors: [], backupPath: outcome.backupPath });
  });

  app.get("/api/schema/:doc", (c) => {
    const doc = c.req.param("doc") as DocId;
    if (!DOCS.includes(doc)) return c.json({ error: "unknown doc" }, 404);
    const schema = JSON.parse(readFileSync(new URL(`${doc}.json`, schemasDir), "utf8"));
    return c.json(schema);
  });

  app.get("/api/meta/providers", (c) => c.json(getModelsSnapshot()));

  app.use("/*", serveStatic({ root: distDir }));
  app.use("/*", serveStatic({ path: `${distDir}index.html` }));

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/validation.test.ts`
Expected: PASS (10 tests). If `serveStatic` import path differs in the installed Hono version, adjust the import (check `node_modules/hono/dist/types/bun` for the correct module) — the static-serving lines are not exercised by tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts test/validation.test.ts
git commit -m "hono app: session-protected API with force-save semantics"
```

---

### Task 7: CLI entry point — flags, startup, idle timer, browser open

**Files:**
- Create: `src/server/index.ts`, `scripts/start.ts`, `scripts/dev.ts`

**Interfaces:**
- Consumes: `createApp` (Task 6), `initAuth`/`generateCode` (Task 4), `startModelsFetch` (Task 5).
- Produces: `bun run start` behavior per SPEC §5 (flags, code printing, browser open, idle timer).

- [ ] **Step 1: Write `src/server/index.ts`**

```ts
import { spawn } from "node:child_process";
import { createApp } from "./app";
import { generateCode, initAuth } from "./auth";
import { startModelsFetch } from "./models";

function parseFlags(argv: string[]): { host: string; port: number; idleTimeout: number } {
  const flags = { host: "127.0.0.1", port: 4789, idleTimeout: 30 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--host") flags.host = next();
    else if (arg.startsWith("--host=")) flags.host = arg.slice(7);
    else if (arg === "--port") flags.port = Number(next());
    else if (arg.startsWith("--port=")) flags.port = Number(arg.slice(7));
    else if (arg === "--idle-timeout") flags.idleTimeout = Number(next());
    else if (arg.startsWith("--idle-timeout=")) flags.idleTimeout = Number(arg.slice(15));
  }
  if (!Number.isInteger(flags.port) || flags.port < 1 || flags.port > 65535) {
    throw new Error(`invalid --port: ${flags.port}`);
  }
  if (!Number.isFinite(flags.idleTimeout) || flags.idleTimeout < 0) {
    throw new Error(`invalid --idle-timeout: ${flags.idleTimeout}`);
  }
  return flags;
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // headless environment — ignore
  }
}

const { host, port, idleTimeout } = parseFlags(process.argv.slice(2));

const code = generateCode();
initAuth(code);

let idleTimer: ReturnType<typeof setTimeout> | undefined;
function armIdleTimer(): void {
  if (idleTimeout === 0) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log(`opencode-knobs: idle for ${idleTimeout} minute(s), shutting down.`);
    process.exit(0);
  }, idleTimeout * 60_000);
  idleTimer.unref?.();
}

const app = createApp({
  host,
  port,
  onAuthenticatedRequest: armIdleTimer,
});

armIdleTimer();
startModelsFetch();

const server = Bun.serve({ hostname: host, port, fetch: app.fetch });

const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.port}`;
console.log("");
console.log("  opencode-knobs");
console.log(`  URL:          ${url}`);
if (host === "0.0.0.0") console.log(`  LAN:          http://<this-machine-ip>:${server.port}`);
console.log(`  Login code:   ${code}`);
console.log(`  Idle timeout: ${idleTimeout === 0 ? "disabled" : `${idleTimeout} minute(s)`}`);
console.log("");

openBrowser(url);
```

- [ ] **Step 2: Write `scripts/start.ts`**

```ts
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync(new URL("../dist/index.html", import.meta.url))) {
  console.log("opencode-knobs: building frontend…");
  const res = spawnSync("bun", ["run", "build"], { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

await import("../src/server/index.ts");
```

- [ ] **Step 3: Write `scripts/dev.ts`**

```ts
import { spawn } from "node:child_process";

const server = spawn("bun", ["--watch", "src/server/index.ts"], { stdio: "inherit" });
const vite = spawn("bunx", ["vite", "--port", "5173"], { stdio: "inherit" });

const stop = () => {
  server.kill();
  vite.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
```

- [ ] **Step 4: Smoke-test startup manually**

Run: `bun src/server/index.ts --port 4799 --idle-timeout 0` (in background or a second terminal), then:
```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4799/api/config/config
```
Expected: `401` (unauthenticated). Then kill the process.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts scripts/start.ts scripts/dev.ts
git commit -m "cli entry point: flags, startup banner, idle timer"
```

---
### Task 8: E2E smoke test

**Files:**
- Create: `test/e2e.test.ts`

**Interfaces:**
- Consumes: Task 7 (server entry), Task 6 (app), Task 2/3 (config on disk).
- Produces: automated test covering SPEC §13 TEST-3: spawn → parse code → login → GET config → PUT change → verify file + backup.

- [ ] **Step 1: Write `test/e2e.test.ts`**

```ts
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type Subprocess } from "bun";

const ENTRY = new URL("../src/server/index.ts", import.meta.url).pathname;

async function startServer(extraArgs: string[] = []): Promise<{ proc: Subprocess; code: string; url: string; tmpDir: string }> {
  const tmpDir = mkdtempSync(join(tmpdir(), "knobs-e2e-"));
  const opencodeDir = join(tmpDir, "opencode");
  mkdirSync(opencodeDir, { recursive: true });
  writeFileSync(
    join(opencodeDir, "tui.json"),
    JSON.stringify({ $schema: "https://opencode.ai/tui.json", theme: "dark" }),
  );

  let stdout = "";
  let stderr = "";
  const proc = spawn(
    ["bun", ENTRY, "--idle-timeout", "0", "--port", "0"],
    {
      env: { ...process.env, XDG_CONFIG_HOME: tmpDir },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const lines: string[] = [];
  const codePromise = new Promise<string>((resolve) => {
    const reader = proc.stdout!.getReader();
    const decoder = new TextDecoder();
    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        stdout += chunk;
        for (const line of chunk.split("\n")) {
          lines.push(line);
          const codeMatch = line.match(/Login code:\s+(\S+)/);
          const urlMatch = line.match(/URL:\s+(http\S+)/);
          if (codeMatch && urlMatch) {
            resolve(codeMatch[1]);
            return;
          }
        }
      }
    })();
  });

  const urlPromise = new Promise<string>((resolve) => {
    const reader = proc.stdout!.getReader();
    (async () => {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        const urlMatch = stdout.match(/URL:\s+(http\S+)/);
        if (urlMatch) {
          resolve(urlMatch[1]);
          return;
        }
      }
    })();
  });

  const [code, url] = await Promise.all([codePromise, urlPromise]);
  return { proc, code, url, tmpDir };
}

async function apiFetch(url: string, path: string, init?: RequestInit) {
  return fetch(`${url}${path}`, { credentials: "omit", ...init });
}

test("e2e: spawn server, login, read, write, verify backup", async () => {
  const { proc, code, url, tmpDir } = await startServer();
  try {
    const headers = { "content-type": "application/json", "x-requested-with": "fetch" };

    const loginRes = await apiFetch(url, "/api/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ code }),
    });
    expect(loginRes.status).toBe(200);
    const sessionCookie = loginRes.headers.get("set-cookie") ?? "";
    const token = sessionCookie.split(";")[0].split("=")[1];
    const authed = { ...headers, cookie: `knobs_session=${token}` };

    const health = await apiFetch(url, "/api/health", { headers: authed });
    expect(health.status).toBe(200);

    const getConfig = await apiFetch(url, "/api/config/config", { headers: authed });
    expect(getConfig.status).toBe(200);
    const configBody = await getConfig.json();
    expect(typeof configBody.raw).toBe("string");

    const putRes = await apiFetch(url, "/api/config/config", {
      method: "PUT",
      headers: authed,
      body: JSON.stringify({ raw: '{\n  "model": "anthropic/claude-2"\n}\n' }),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.valid).toBe(true);
    expect(typeof putBody.backupPath === "string" || putBody.backupPath === undefined).toBe(true);

    const opencodeDir = join(tmpDir, "opencode");
    expect(readFileSync(join(opencodeDir, "opencode.json"), "utf8")).toContain("anthropic/claude-2");
    expect(readdirSync(opencodeDir).some((f) => f.includes(".bak-"))).toBe(true);

    const putForce = await apiFetch(url, "/api/config/config", {
      method: "PUT",
      headers: authed,
      body: JSON.stringify({ raw: '{\n  "unknown_key": true\n}\n', force: true }),
    });
    expect(putForce.status).toBe(200);
    expect(readFileSync(join(opencodeDir, "opencode.json"), "utf8")).toContain("unknown_key");
  } finally {
    proc.kill();
  }
}, 15_000);
```

- [ ] **Step 2: Run e2e test**

Run: `bun test test/e2e.test.ts`
Expected: PASS (1 test). If stdout parsing misses the URL/code (race condition), increase the timeout or adjust the parser to buffer lines until both regexes match.

- [ ] **Step 3: Commit**

```bash
git add test/e2e.test.ts
git commit -m "e2e smoke test: spawn, login, read, write, backup"
```

---
### Task 9: Frontend foundation — HTML entry, theme, API client, login gate

**Files:**
- Create: `src/web/index.html`, `src/web/main.ts`, `src/web/app.css`, `src/web/api.ts`, `src/web/Login.svelte`, `src/web/App.svelte` (skeleton)

**Interfaces:**
- Consumes: server API routes (Task 6).
- Produces: working app shell with login gate; all later UI tasks build into this shell.

- [ ] **Step 1: Write `src/web/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>opencode-knobs</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/web/app.css`**

```css
:root {
  --bg-0: #1e1e2e;
  --bg-1: #181825;
  --bg-2: #313244;
  --bg-3: #45475a;
  --fg-0: #cdd6f4;
  --fg-1: #a6adc8;
  --fg-2: #7f849c;
  --accent: #89b4fa;
  --accent-hover: #b4d0fb;
  --danger: #f38ba8;
  --success: #a6e3a1;
  --warn: #f9e2af;
  --radius: 4px;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 20px;
  --font: "SF Mono", "Cascadia Code", "Fira Code", "JetBrains Mono", ui-monospace, monospace;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg-0);
  color: var(--fg-0);
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.5;
}

button {
  background: var(--bg-2);
  color: var(--fg-0);
  border: 1px solid var(--bg-3);
  border-radius: var(--radius);
  padding: var(--spacing-xs) var(--spacing-sm);
  cursor: pointer;
  font: inherit;
}
button:hover { background: var(--bg-3); }
button.primary { background: var(--accent); color: var(--bg-0); border-color: var(--accent); }
button.primary:hover { background: var(--accent-hover); }
button.danger { border-color: var(--danger); color: var(--danger); }
button.danger:hover { background: var(--danger); color: var(--bg-0); }

input, textarea, select {
  background: var(--bg-1);
  color: var(--fg-0);
  border: 1px solid var(--bg-3);
  border-radius: var(--radius);
  padding: var(--spacing-xs) var(--spacing-sm);
  font: inherit;
  outline: none;
}
input:focus, textarea:focus, select:focus { border-color: var(--accent); }

label {
  display: block;
  font-size: 11px;
  color: var(--fg-1);
  margin-bottom: var(--spacing-xs);
}
.field { margin-bottom: var(--spacing-md); }
.field .help { font-size: 11px; color: var(--fg-2); margin-top: var(--spacing-xs); }
```

- [ ] **Step 3: Write `src/web/api.ts`**

```ts
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
export interface MetaResponse { available: boolean; fetchedAt?: string; providers?: Array<{ id: string; name?: string; npm?: string; env?: string[]; models: Array<{ id: string; name?: string; limit?: { context?: number }; cost?: { input?: number; output?: number; cache?: number }> }> }

export const api = {
  login: (code: string) => request<LoginResponse>("POST", "/api/login", { code }),
  logout: () => request<{ ok: true }>("POST", "/api/logout"),
  health: () => request<HealthResponse>("GET", "/api/health"),
  getConfig: (doc: "config" | "tui") => request<ConfigResponse>("GET", `/api/config/${doc}`),
  saveConfig: (doc: "config" | "tui", raw: string, force = false) => request<SaveResponse>("PUT", `/api/config/${doc}`, { raw, force }),
  getSchema: (doc: "config" | "tui") => request<SchemaResponse>("GET", `/api/schema/${doc}`),
  getMeta: () => request<MetaResponse>("GET", "/api/meta/providers"),
};
```

- [ ] **Step 4: Write `src/web/main.ts`**

```ts
import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

const target = document.getElementById("app")!;
mount(App, { target });
```

- [ ] **Step 5: Write `src/web/Login.svelte`**

```svelte
<script lang="ts">
  import { api } from "./api";

  let code = $state("");
  let error = $state("");
  let loading = $state(false);
  const { onsuccess }: { onsuccess: () => void } = $props();

  async function submit() {
    loading = true;
    error = "";
    try {
      await api.login(code);
      onsuccess();
    } catch (e: any) {
      error = e.body?.error ?? "login failed";
    } finally {
      loading = false;
    }
  }
</script>

<div class="login">
  <div class="card">
    <h1>opencode-knobs</h1>
    <p>Enter the one-time login code from your terminal.</p>
    <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
      <input
        type="text"
        maxlength="8"
        placeholder="XXXXXXXX"
        value={code}
        oninput={(e) => (code = (e.currentTarget as HTMLInputElement).value.toUpperCase())}
        disabled={loading}
        autofocus
      />
      {#if error}
        <p class="error">{error}</p>
      {/if}
      <button type="submit" class="primary" disabled={loading || code.length === 0}>
        {loading ? "Logging in…" : "Login"}
      </button>
    </form>
  </div>
</div>

<style>
  .login {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .card {
    background: var(--bg-1);
    border: 1px solid var(--bg-3);
    border-radius: 8px;
    padding: 32px;
    max-width: 360px;
    text-align: center;
  }
  h1 { font-size: 16px; margin-bottom: 8px; color: var(--accent); }
  p { color: var(--fg-1); font-size: 12px; margin-bottom: 16px; }
  input { width: 100%; text-align: center; font-size: 18px; letter-spacing: 3px; margin-bottom: 12px; }
  .error { color: var(--danger); margin-bottom: 8px; }
  button { width: 100%; padding: 8px; margin-top: 4px; }
</style>
```

- [ ] **Step 6: Write skeleton `src/web/App.svelte`**

```svelte
<script lang="ts">
  import Login from "./Login.svelte";
  import { api } from "./api";

  let loggedIn = $state(false);
  let loading = $state(true);
  let error = $state("");

  async function checkSession() {
    try {
      await api.health();
      loggedIn = true;
    } catch {
      loggedIn = false;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    checkSession();
  });
</script>

{#if loading}
  <div class="loading">Loading…</div>
{:else if !loggedIn}
  <Login onsuccess={() => { loggedIn = true; loading = false; }} />
{:else}
  <div class="shell">opencode-knobs (logged in)</div>
{/if}

<style>
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    color: var(--fg-2);
  }
  .shell {
    padding: var(--spacing-md);
    color: var(--fg-1);
  }
</style>
```

- [ ] **Step 7: Build frontend**

Run: `bun run build`
Expected: builds successfully into `dist/`.

- [ ] **Step 8: Commit**

```bash
git add src/web/index.html src/web/main.ts src/web/app.css src/web/api.ts src/web/Login.svelte src/web/App.svelte
git commit -m "frontend foundation: theme, api client, login gate"
```

---

### Task 10: Client-side patch helpers + schema walker (TDD)

**Files:**
- Create: `src/web/state/patch.ts`, `test/patch.test.ts`, `src/web/schema/walker.ts`

**Interfaces:**
- Consumes: `jsonc-parser` (shared).
- Produces (used by Tasks 11–19):
  - `detectIndent(raw: string): { insertSpaces: boolean; tabSize: number }`
  - `applyPatch(raw: string, path: (string | number)[], value: unknown): string`
  - `pointerToOffset(raw: string, pointer: string): number` (for CodeMirror lint, Task 18)
  - Schema utilities: `resolveRef(schema, defs): any`, `isDeprecated(name, schema, defName): boolean`, `entries(schema): Array<[string, any]>` — yield non-deprecated schema properties in declaration order

- [ ] **Step 1: Write `test/patch.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { applyPatch, detectIndent, pointerToOffset } from "../src/web/state/patch";

describe("detectIndent", () => {
  test("finds leading spaces", () => {
    expect(detectIndent('{\n    "a": 1\n}')).toEqual({ insertSpaces: true, tabSize: 4 });
  });
  test("finds leading tab", () => {
    expect(detectIndent('{\n\t"a": 1\n}')).toEqual({ insertSpaces: false, tabSize: 1 });
  });
  test("defaults to 2 spaces", () => {
    expect(detectIndent('{}')).toEqual({ insertSpaces: true, tabSize: 2 });
  });
});

describe("applyPatch", () => {
  const raw = [
    "{",
    "  // top comment",
    '  "model": "anthropic/claude-2",',
    '  "provider": {',
    '    "anthropic": {',
    '      "options": {',
    '        "apiKey": "{env:ANTHROPIC_API_KEY}"',
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");

  test("edits only the target path, preserves comments and placeholders", () => {
    const out = applyPatch(raw, ["model"], "openai/gpt-4o");
    expect(out).toContain('"model": "openai/gpt-4o"');
    expect(out).toContain("// top comment");
    expect(out).toContain("{env:ANTHROPIC_API_KEY}");
    const a = raw.split("\n"), b = out.split("\n");
    expect(b.length).toBe(a.length);
    const changed = a.filter((l, i) => l !== b[i]);
    expect(changed).toEqual(["  \"model\": \"anthropic/claude-2\","]);
  });

  test("removes key when value is undefined", () => {
    const out = applyPatch(raw, ["model"], undefined);
    expect(out).not.toContain('"model"');
    expect(out).toContain("// top comment");
  });

  test("handles nested object addition", () => {
    const src = '{\n  "a": 1\n}';
    const out = applyPatch(src, ["b"], 2);
    expect(out).toContain('"b": 2');
  });

  test("handles array index patch", () => {
    const src = '{\n  "items": [\n    "x",\n    "y"\n  ]\n}';
    const out = applyPatch(src, ["items", 1], "z");
    expect(out).toContain('"z"');
    expect(out).not.toContain('"y"');
  });

  test("creates empty object when patching into missing parent", () => {
    const src = '{\n  "a": 1\n}';
    const out = applyPatch(src, ["b", "c"], "d");
    expect(out).toContain('"b"');
    expect(out).toContain('"c": "d"');
  });

  test("inserts new key into object", () => {
    const src = '{\n  "a": 1\n}';
    const out = applyPatch(src, ["b"], true);
    expect(out).toContain('"b": true');
    expect(out).toContain('"a": 1');
  });
});

describe("pointerToOffset", () => {
  const raw = '{\n  "a": 1,\n  "b": {\n    "c": 3\n  }\n}';
  test("returns 0 for empty pointer", () => {
    expect(pointerToOffset(raw, "")).toBe(0);
  });
  test("finds root-level key", () => {
    const off = pointerToOffset(raw, "/a");
    expect(off).toBeGreaterThanOrEqual(0);
    expect(raw.slice(off, off + 2)).toBe('"a"');
  });
  test("finds nested key", () => {
    const off = pointerToOffset(raw, "/b/c");
    expect(off).toBeGreaterThanOrEqual(0);
    expect(raw.slice(off, off + 2)).toBe('"c"');
  });
  test("returns 0 for nonexistent path", () => {
    expect(pointerToOffset(raw, "/x")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/patch.test.ts`
Expected: FAIL

- [ ] **Step 3: Write `src/web/state/patch.ts`**

```ts
import { modify, applyEdits as jsoncApplyEdits, parseTree, findNodeAtLocation, type JSONPath } from "jsonc-parser";

export function detectIndent(raw: string): { insertSpaces: boolean; tabSize: number } {
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\s+)\S/);
    if (m) {
      if (m[1].includes("\t")) return { insertSpaces: false, tabSize: 1 };
      return { insertSpaces: true, tabSize: m[1].length };
    }
  }
  return { insertSpaces: true, tabSize: 2 };
}

export function applyPatch(raw: string, path: (string | number)[], value: unknown): string {
  const text = raw.trim() === "" ? "{}" : raw;
  const opts = detectIndent(text);
  const edits = modify(text, path as JSONPath, value, { formattingOptions: opts });
  return jsoncApplyEdits(text, edits);
}

export function pointerToOffset(raw: string, pointer: string): number {
  if (pointer === "") return 0;
  const root = parseTree(raw);
  if (!root) return 0;
  const segments = pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  const numeric = segments.map((s) => (/^\d+$/.test(s) ? Number(s) : s));
  const node = findNodeAtLocation(root, numeric as any);
  return node ? node.offset : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/patch.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Write `src/web/schema/walker.ts`**

```ts
import type { SchemaResponse } from "../api";

const KNOWN_DEPRECATED: Record<string, string[]> = {
  "": ["mode", "autoshare", "layout", "reference", "references"],
  AgentConfig: ["tools", "maxSteps"],
};

export function resolveRef(schema: any, defs: Record<string, any>): any {
  if (!schema?.$ref) return schema;
  const m = schema.$ref.match(/^#\/\$defs\/(.+)$/);
  if (m) return defs[m[1]] ?? schema;
  return schema;
}

export function isDeprecated(name: string, schema: any, defName = ""): boolean {
  const desc = [schema?.description, schema?.markdownDescription]
    .filter((s): s is string => typeof s === "string")
    .join(" ");
  if (/deprecat/i.test(desc)) return true;
  return (KNOWN_DEPRECATED[defName] ?? []).includes(name);
}

export function* entries(schema: any, defs: Record<string, any> = {}, defName = ""): Generator<[string, any]> {
  if (!schema?.properties) return;
  for (const [name, propSchema] of Object.entries<Record<string, any>>(schema.properties)) {
    if (name === "$schema") continue;
    if (isDeprecated(name, propSchema, defName)) continue;
    yield [name, resolveRef(propSchema, defs)];
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/web/state/patch.ts src/web/schema/walker.ts test/patch.test.ts
git commit -m "client patch helpers and schema walker with deprecated filtering"
```

---
### Task 11: Document store, generic form renderer, and base components

**Files:**
- Create: `src/web/state/doc-store.svelte.ts`, `src/web/state/validate.ts`, `src/web/components/Field.svelte`, `src/web/components/SchemaForm.svelte`, `src/web/components/StringList.svelte`, `src/web/components/KVEditor.svelte`, `src/web/components/MaskedSecret.svelte`, `src/web/components/Combobox.svelte`, `src/web/state/catalog.ts`

**Interfaces:**
- Consumes: `api` (Task 9), `applyPatch`/`detectIndent`/`pointerToOffset` (Task 10), `entries`/`resolveRef`/`isDeprecated` (Task 10 walker).
- Produces (used by Tasks 12–19):
  - `class DocStore` — reactive state with `$state` runes: `raw`, `json`, `exists`, `dirty`, `parseErrors`, `schemaErrors`, `loaded`; methods `load()`, `setText(raw)`, `patch(path, value)`, `save(force)`.
  - `clientValidate(docId, json): DocError[]` — Ajv in browser using vendored schemas fetched from server on load.
  - `Field`, `SchemaForm`, `StringList`, `KVEditor`, `MaskedSecret`, `Combobox` — reusable form components.

- [ ] **Step 1: Write `src/web/state/doc-store.svelte.ts`**

```ts
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { applyPatch } from "./patch";
import { api, type ConfigResponse } from "../api";
import { clientValidate } from "./validate";
import type { DocId, DocError } from "../../shared/types";

export class DocStore {
  id: DocId;
  raw = $state("");
  json = $state<any>(null);
  exists = $state(false);
  dirty = $state(false);
  parseErrors = $state<DocError[]>([]);
  schemaErrors = $state<DocError[]>([]);
  loaded = $state(false);
  serverVersion = $state("");
  schema: any = $state(null);
  defs: Record<string, any> = $state({});
  defName = $state("");

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
```

- [ ] **Step 2: Write `src/web/state/validate.ts`**

```ts
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
}

let validatorsReady = loadValidators();

export async function ensureValidators() {
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
```

- [ ] **Step 3: Write `src/web/state/catalog.ts`**

```ts
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
```

- [ ] **Step 4: Write `src/web/components/Field.svelte`**

```svelte
<script lang="ts">
  let { label, help, error }: { label?: string; help?: string; error?: string } = $props();
</script>

<div class="field">
  {#if label}
    <label>{label}</label>
  {/if}
  <slot />
  {#if error}
    <p class="error">{error}</p>
  {:else if help}
    <p class="help">{help}</p>
  {/if}
</div>

<style>
  .field { margin-bottom: 12px; }
  .help { font-size: 11px; color: var(--fg-2); margin-top: 2px; }
  .error { font-size: 11px; color: var(--danger); margin-top: 2px; }
</style>
```

- [ ] **Step 5: Write `src/web/components/SchemaForm.svelte`**

```svelte
<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import { entries, resolveRef } from "../schema/walker";
  import Field from "./Field.svelte";
  import StringList from "./StringList.svelte";
  import KVEditor from "./KVEditor.svelte";
  import MaskedSecret from "./MaskedSecret.svelte";
  import Combobox from "./Combobox.svelte";

  let {
    store, schema, path = [], onlyKeys, secretPaths = [], compact = false,
  }: {
    store: DocStore; schema: any; path?: (string|number)[]; onlyKeys?: string[];
    secretPaths?: string[]; compact?: boolean;
  } = $props();

  const defs = store.defs;

  function getValue(obj: any, p: (string|number)[]): any {
    let cur = obj;
    for (const seg of p) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[seg];
    }
    return cur;
  }

  function getSchema(name: string): any {
    let s = schema;
    if (s?.$ref) s = resolveRef(s, defs);
    return s?.properties?.[name] ?? s?.$defs?.[name];
  }

  function resolve(s: any): any {
    return s?.$ref ? resolveRef(s, defs) : s;
  }

  function isSecret(p: (string|number)[]): boolean {
    return secretPaths.some((sp) => sp === p.join("/"));
  }

  function inferEnumOptions(s: any): string[] | undefined {
    if (s?.enum) return s.enum;
    if (s?.anyOf) {
      const opts = s.anyOf.map((a: any) => a.enum ?? [a.const]).flat().filter(Boolean);
      if (opts.length > 0) return opts;
    }
    return undefined;
  }

  function inferAnyOfOptions(s: any): any[] | undefined {
    return s?.anyOf;
  }

  function getHelpText(s: any): string {
    return s?.description ?? s?.markdownDescription ?? "";
  }

  function patchField(fieldPath: (string|number)[], value: unknown) {
    store.patch(fieldPath, value);
  }

  function renderScalar(name: string, s: any, fieldPath: (string|number)[]) {
    const val = getValue(store.json, fieldPath);
    const help = getHelpText(s);
    const error = store.allErrors.find((e) => e.path === "/" + fieldPath.join("/"))?.message;
    const options = inferEnumOptions(s);
    const anyOf = inferAnyOfOptions(s);
    const isSecretField = isSecret(fieldPath);

    if (s?.type === "boolean" || anyOf?.some((a: any) => a.type === "boolean")) {
      return `<${name}>`;
    }
  }
</script>

{#each (onlyKeys ?? [...entries(schema, defs, store.defName)]) as entry}
  {@const [name, propSchema] = typeof entry === "string" ? [entry, getSchema(entry)] : entry}
  {@const resolved = resolve(propSchema)}
  {@const fieldPath = [...path, name]}
  {@const value = getValue(store.json, fieldPath)}
  {@const options = inferEnumOptions(resolved)}
  {@const anyOf = inferAnyOfOptions(resolved)}
  {@const help = getHelpText(resolved)}
  {@const error = store.allErrors.find((e) => e.path === "/" + fieldPath.join("/"))?.message}

  {#if resolved?.type === "boolean" || anyOf?.some((a: any) => a.type === "boolean")}
    {@const opts = anyOf ? anyOf.filter((a: any) => a.type !== "boolean").map((a: any) => a.enum ?? [a.const]).flat().filter(Boolean) : []}
    {#if opts.length > 0}
      <Field {label={name}} {help} {error}>
        <select value={value ?? ""} onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; patchField(fieldPath, v === "true" ? true : v === "false" ? false : v); }}>
          {#each ["", "true", "false", ...opts] as opt}
            <option value={opt}>{opt || "(unset)"}</option>
          {/each}
        </select>
      </Field>
    {:else}
      <Field {label={name}} {help} {error}>
        <label class="toggle">
          <input type="checkbox" checked={!!value} onchange={(e) => patchField(fieldPath, (e.currentTarget as HTMLInputElement).checked)} />
          <span>{value ? "on" : "off"}</span>
        </label>
      </Field>
    {/if}

  {:else if options}
    <Field {label={name}} {help} {error}>
      <select value={value ?? ""} onchange={(e) => patchField(fieldPath, (e.currentTarget as HTMLSelectElement).value || undefined)}>
        <option value="">(unset)</option>
        {#each options as opt}
          <option value={opt} selected={value === opt}>{opt}</option>
        {/each}
      </select>
    </Field>

  {:else if resolved?.type === "integer" || resolved?.type === "number"}
    <Field {label={name}} {help} {error}>
      <input type="number" value={value ?? ""} min={resolved.minimum} max={resolved.maximum}
        onchange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; patchField(fieldPath, v === "" ? undefined : Number(v)); }} />
    </Field>

  {:else if resolved?.type === "string"}
    {#if isSecret(fieldPath)}
      <Field {label={name}} {help} {error}>
        <MaskedSecret {value} onchange={(v) => patchField(fieldPath, v)} />
      </Field>
    {:else}
      <Field {label={name}} {help} {error}>
        <input type="text" value={value ?? ""} onchange={(e) => patchField(fieldPath, (e.currentTarget as HTMLInputElement).value || undefined)} />
      </Field>
    {/if}

  {:else if resolved?.type === "array" && resolved?.items?.type === "string"}
    <Field {label={name}} {help} {error}>
      <StringList {value} onchange={(v) => patchField(fieldPath, v)} />
    </Field>

  {:else if resolved?.type === "object" && resolved?.properties}
    <details open={!compact}>
      <summary>{name}</summary>
      <div class="nested">
        <svelte:self {store} schema={resolved} path={fieldPath} {secretPaths} compact />
      </div>
    </details>

  {:else if resolved?.type === "object" && resolved?.additionalProperties}
    <Field {label={name}} {help} {error}>
      <KVEditor {value} onchange={(v) => patchField(fieldPath, v)} />
    </Field>

  {:else}
    <Field {label={name}} {help} {error}>
      <input type="text" value={value === undefined ? "" : JSON.stringify(value)}
        onchange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; try { patchField(fieldPath, JSON.parse(v)); } catch { patchField(fieldPath, v || undefined); } }} />
    </Field>
  {/if}
{/each}

<style>
  details { margin-bottom: 12px; }
  summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--accent); padding: 4px 0; }
  summary:hover { color: var(--accent-hover); }
  .nested { padding-left: 16px; border-left: 1px solid var(--bg-3); margin-top: 4px; }
  .toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; }
  .toggle input { width: auto; }
</style>
```

- [ ] **Step 6: Write `src/web/components/StringList.svelte`**

```svelte
<script lang="ts">
  let { value = [], onchange }: { value?: string[]; onchange: (v: string[]) => void } = $props();
  let items = $state([...(value ?? [])]);

  function add() { items = [...items, ""]; }
  function remove(i: number) { items = items.filter((_, idx) => idx !== i); onchange(items); }
  function update(i: number, v: string) { items = items.map((old, idx) => idx === i ? v : old); onchange(items); }
</script>

{#each items as item, i}
  <div class="row">
    <input type="text" value={item} oninput={(e) => update(i, (e.currentTarget as HTMLInputElement).value)} />
    <button class="danger" onclick={() => remove(i)} title="remove">×</button>
  </div>
{/each}
<button onclick={add}>+ add</button>

<style>
  .row { display: flex; gap: 4px; margin-bottom: 4px; }
  .row input { flex: 1; }
  button { font-size: 11px; padding: 2px 6px; }
</style>
```

- [ ] **Step 7: Write `src/web/components/KVEditor.svelte`**

```svelte
<script lang="ts">
  let { value = {}, onchange }: { value?: Record<string, unknown>; onchange: (v: Record<string, unknown>) => void } = $props();
  let entries = $state(Object.entries(value ?? {}));

  function add() { entries = [...entries, ["", ""]]; }
  function remove(i: number) { entries = entries.filter((_, idx) => idx !== i); sync(); }
  function updateKey(i: number, k: string) { entries = entries.map((old, idx) => idx === i ? [k, old[1]] as [string, unknown] : old); sync(); }
  function updateVal(i: number, v: string) { entries = entries.map((old, idx) => idx === i ? [old[0], v] as [string, unknown] : old); sync(); }
  function sync() { onchange(Object.fromEntries(entries.filter(([k]) => k))); }
</script>

{#each entries as [k, v], i}
  <div class="row">
    <input type="text" placeholder="key" value={k} oninput={(e) => updateKey(i, (e.currentTarget as HTMLInputElement).value)} />
    <input type="text" placeholder="value" value={String(v ?? "")} oninput={(e) => updateVal(i, (e.currentTarget as HTMLInputElement).value)} />
    <button class="danger" onclick={() => remove(i)} title="remove">×</button>
  </div>
{/each}
<button onclick={add}>+ add</button>

<style>
  .row { display: flex; gap: 4px; margin-bottom: 4px; }
  .row input:first-child { width: 140px; }
  .row input:nth-child(2) { flex: 1; }
  button { font-size: 11px; padding: 2px 6px; }
</style>
```

- [ ] **Step 8: Write `src/web/components/MaskedSecret.svelte`**

```svelte
<script lang="ts">
  let { value, onchange }: { value?: string; onchange: (v: string | undefined) => void } = $props();
  let editing = $state(false);
  let temp = $state("");
  let clearing = $state(false);
</script>

{#if editing}
  <div class="row">
    <input type="text" placeholder="leave blank to keep unchanged" value={temp}
      oninput={(e) => { temp = (e.currentTarget as HTMLInputElement).value; }}
      onkeydown={(e) => { if (e.key === "Enter") { onchange(temp || undefined); editing = false; } if (e.key === "Escape") editing = false; }}
      autofocus />
    <button onclick={() => { onchange(temp || undefined); editing = false; }}>save</button>
    <button onclick={() => { editing = false; temp = ""; }}>cancel</button>
    <button class="danger" onclick={() => { clearing = true; }}>clear</button>
  </div>
  {#if clearing}
    <p class="warn">Are you sure? This will remove the secret.</p>
    <div class="row">
      <button class="danger" onclick={() => { onchange(undefined); editing = false; clearing = false; }}>yes, clear</button>
      <button onclick={() => { clearing = false; }}>no</button>
    </div>
  {/if}
{:else}
  <div class="row">
    <span class="masked">••••••••</span>
    <button onclick={() => { editing = true; temp = ""; }}>edit</button>
  </div>
{/if}

<style>
  .row { display: flex; align-items: center; gap: 4px; }
  .masked { color: var(--fg-2); font-size: 12px; padding: 4px 8px; background: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius); }
  .warn { color: var(--warn); font-size: 11px; margin: 4px 0; }
  button { font-size: 11px; padding: 2px 6px; }
</style>
```

- [ ] **Step 9: Write `src/web/components/Combobox.svelte`**

```svelte
<script lang="ts">
  let {
    value, options, label, onchange, filterFn,
  }: {
    value: string; options: Array<{ id: string; label: string }>; label?: string;
    onchange: (v: string) => void; filterFn?: (opt: { id: string; label: string }, query: string) => boolean;
  } = $props();

  let query = $state(value);
  let open = $state(false);
  let highlight = $state(-1);

  let filtered = $derived(
    query
      ? (options ?? []).filter((o) => filterFn ? filterFn(o, query) : o.id.toLowerCase().includes(query.toLowerCase()) || o.label.toLowerCase().includes(query.toLowerCase()))
      : (options ?? [])
  );

  function select(id: string) { query = id; onchange(id); open = false; highlight = -1; }
  function onKey(e: KeyboardEvent) {
    if (!open) { open = true; return; }
    if (e.key === "ArrowDown") { highlight = Math.min(highlight + 1, filtered.length - 1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { highlight = Math.max(highlight - 1, 0); e.preventDefault(); }
    else if (e.key === "Enter" && highlight >= 0) { select(filtered[highlight].id); e.preventDefault(); }
    else if (e.key === "Escape") { open = false; }
  }
</script>

<div class="combobox">
  {#if label}<label>{label}</label>{/if}
  <input type="text" value={query} oninput={(e) => { query = (e.currentTarget as HTMLInputElement).value; open = true; highlight = -1; }}
    onfocus={() => { open = true; }} onblur={() => { setTimeout(() => { open = false; }, 150); }} onkeydown={onKey} />
  {#if open && filtered.length > 0}
    <ul>
      {#each filtered.slice(0, 30) as opt, i}
        <li class:highlight={i === highlight} onmousedown={() => select(opt.id)}>
          <span class="id">{opt.id}</span>
          {#if opt.label !== opt.id}<span class="name">{opt.label}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .combobox { position: relative; }
  input { width: 100%; }
  ul { position: absolute; top: 100%; left: 0; right: 0; z-index: 100; background: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius); max-height: 200px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
  li { padding: 4px 8px; cursor: pointer; font-size: 12px; display: flex; gap: 6px; }
  li:hover, li.highlight { background: var(--bg-2); }
  .id { font-family: var(--font); }
  .name { color: var(--fg-2); font-size: 11px; }
  label { display: block; font-size: 11px; color: var(--fg-1); margin-bottom: 2px; }
</style>
```

- [ ] **Step 10: Commit**

```bash
git add src/web/state/doc-store.svelte.ts src/web/state/validate.ts src/web/state/catalog.ts \
  src/web/components/Field.svelte src/web/components/SchemaForm.svelte \
  src/web/components/StringList.svelte src/web/components/KVEditor.svelte \
  src/web/components/MaskedSecret.svelte src/web/components/Combobox.svelte
git commit -m "doc store, client ajv validation, generic schema renderer, base components"
```

---

### Task 12: App shell — tabs, save button, dirty badge, server-stopped overlay, beforeunload

**Files:**
- Modify: `src/web/App.svelte` (replace skeleton)

**Interfaces:**
- Consumes: `DocStore` (Task 11), all section components (Tasks 14–19), `Raw` editor (Task 18), `api` (Task 9).
- Produces: complete shell with tab bar, per-document doc switcher for TUI/Raw tabs, global save button with dirty badge, `beforeunload` guard, server-stopped overlay.

- [ ] **Step 1: Rewrite `src/web/App.svelte`**

```svelte
<script lang="ts">
  import Login from "./Login.svelte";
  import { api } from "./api";
  import { DocStore } from "./state/doc-store.svelte";
  import { ensureValidators } from "./state/validate";
  import { loadCatalog } from "./state/catalog";

  let loggedIn = $state(false);
  let loading = $state(true);
  let serverGone = $state(false);
  let saveError = $state("");
  let activeTab = $state<"general"|"providers"|"agents"|"mcp"|"permissions"|"formatter"|"tui"|"misc"|"raw">("general");
  let activeDoc = $state<"config"|"tui">("tui");

  const configDoc = new DocStore("config");
  const tuiDoc = new DocStore("tui");
  const currentDoc = $derived(activeTab === "tui" ? tuiDoc : activeDoc === "tui" ? tuiDoc : configDoc);
  const anyDirty = $derived(configDoc.dirty || tuiDoc.dirty);
  const hasErrors = $derived(!configDoc.valid || !tuiDoc.valid);

  async function checkSession() {
    try { await api.health(); loggedIn = true; }
    catch { loggedIn = false; }
    finally { loading = false; }
  }

  async function loadAll() {
    await ensureValidators();
    await Promise.all([configDoc.load(), tuiDoc.load(), loadCatalog()]);
  }

  $effect(() => {
    if (loggedIn) loadAll();
  });

  $effect(() => {
    if (!loggedIn) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (anyDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  });

  async function save() {
    saveError = "";
    try {
      const results = await Promise.all([
        configDoc.dirty ? configDoc.save() : { ok: true },
        tuiDoc.dirty ? tuiDoc.save() : { ok: true },
      ]);
      const failures = results.filter((r: any) => !r.ok);
      if (failures.length > 0) saveError = `save failed for ${failures.map((f: any) => f.status).join(", ")}`;
    } catch {
      serverGone = true;
    }
  }

  async function forceSave() {
    saveError = "";
    try {
      const [c, t] = await Promise.all([
        configDoc.dirty ? configDoc.save(true) : { ok: true },
        tuiDoc.dirty ? tuiDoc.save(true) : { ok: true },
      ]);
      if (!c.ok || !t.ok) saveError = "force save failed";
    } catch {
      serverGone = true;
    }
  }

  const tabs = [
    { id: "general", label: "General" },
    { id: "providers", label: "Providers" },
    { id: "agents", label: "Agents" },
    { id: "mcp", label: "MCP" },
    { id: "permissions", label: "Permissions" },
    { id: "formatter", label: "Formatter & LSP" },
    { id: "tui", label: "TUI" },
    { id: "misc", label: "Misc" },
    { id: "raw", label: "Raw" },
  ] as const;
</script>

{#if loading}
  <div class="loading">Loading…</div>
{:else if !loggedIn}
  <Login onsuccess={() => { loggedIn = true; loading = false; }} />
{:else if serverGone}
  <div class="server-gone">
    <h2>Server stopped</h2>
    <p>The server is no longer responding.</p>
    <button onclick={() => { serverGone = false; checkSession(); }}>reconnect</button>
  </div>
{:else}
  <header>
    <h1>opencode-knobs</h1>
    <nav>
      {#each tabs as t}
        <button class:active={activeTab === t.id} onclick={() => activeTab = t.id}>{t.label}</button>
      {/each}
    </nav>
    <div class="header-right">
      {#if activeTab === "raw" || activeTab === "tui"}
        <div class="doc-switcher">
          <button class:active={activeDoc === "config"} onclick={() => activeDoc = "config"}>config</button>
          <button class:active={activeDoc === "tui"} onclick={() => activeDoc = "tui"}>tui</button>
        </div>
      {/if}
      {#if saveError}<span class="error">{saveError}</span>{/if}
      <button class="primary save" onclick={save} disabled={!anyDirty}>
        {anyDirty ? "Save ●●" : "Save"}
        {#if configDoc.dirty}<span class="dot c">{configDoc.exists ? "c" : "C"}</span>{/if}
        {#if tuiDoc.dirty}<span class="dot t">{tuiDoc.exists ? "t" : "T"}</span>{/if}
      </button>
    </div>
  </header>

  <main>
    {#if activeTab === "general"}
      <!-- @slot General section goes here, Task 14 -->
      <p>General (coming next)</p>
    {:else if activeTab === "providers"}
      <p>Providers (coming next)</p>
    {:else if activeTab === "agents"}
      <p>Agents (coming next)</p>
    {:else if activeTab === "mcp"}
      <p>MCP (coming next)</p>
    {:else if activeTab === "permissions"}
      <p>Permissions (coming next)</p>
    {:else if activeTab === "formatter"}
      <p>Formatter & LSP (coming next)</p>
    {:else if activeTab === "tui"}
      <p>TUI (coming next)</p>
    {:else if activeTab === "misc"}
      <p>Misc (coming next)</p>
    {:else if activeTab === "raw"}
      <p>Raw (coming next)</p>
    {/if}
  </main>
{/if}

<style>
  .loading, .server-gone {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; gap: 12px; color: var(--fg-1);
  }
  .server-gone h2 { color: var(--danger); }
  header {
    display: flex; align-items: center; gap: 16px; padding: 8px 16px;
    background: var(--bg-1); border-bottom: 1px solid var(--bg-3); position: sticky; top: 0; z-index: 50;
  }
  h1 { font-size: 14px; color: var(--accent); margin: 0; white-space: nowrap; }
  nav { display: flex; gap: 2px; flex: 1; overflow-x: auto; }
  nav button {
    background: none; border: none; color: var(--fg-2); font-size: 12px; padding: 6px 10px; border-radius: var(--radius);
  }
  nav button:hover { color: var(--fg-0); background: var(--bg-2); }
  nav button.active { color: var(--accent); background: var(--bg-2); }
  .header-right { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .doc-switcher { display: flex; gap: 2px; background: var(--bg-2); border-radius: var(--radius); padding: 2px; }
  .doc-switcher button { background: none; border: none; color: var(--fg-2); font-size: 11px; padding: 2px 8px; border-radius: 3px; }
  .doc-switcher button.active { color: var(--fg-0); background: var(--bg-3); }
  .save { font-size: 12px; padding: 4px 12px; }
  .save:disabled { opacity: 0.4; }
  .dot { font-size: 9px; margin-left: 4px; }
  .dot.c { color: var(--warn); }
  .dot.t { color: var(--accent); }
  .error { color: var(--danger); font-size: 11px; }
  main { padding: 16px; max-width: 900px; margin: 0 auto; }
</style>
```

- [ ] **Step 2: Build to verify**

Run: `bun run build`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/web/App.svelte
git commit -m "app shell: tab bar, doc switcher, save button, server-gone overlay"
```

---
### Task 14: General + Misc + TUI sections

**Files:**
- Create: `src/web/sections/General.svelte`, `src/web/sections/Tui.svelte`, `src/web/sections/Misc.svelte`
- Modify: `src/web/App.svelte` (wire section imports)

**Interfaces:**
- Consumes: `SchemaForm` (Task 11), `configDoc`/`tuiDoc` stores (Task 12).
- Produces: three wired sections that render their respective schema properties.

- [ ] **Step 1: Write `src/web/sections/General.svelte`**

```svelte
<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import SchemaForm from "../components/SchemaForm.svelte";

  let { store }: { store: DocStore } = $props();
  const SECRET_PATHS = ["provider"];
</script>

<h2>General</h2>
<SchemaForm
  {store}
  schema={store.schema}
  path={[]}
  onlyKeys={[
    "model", "small_model", "default_agent", "username", "shell", "logLevel",
    "autoupdate", "share", "snapshot", "subagent_depth", "instructions",
    "skills", "plugin", "watcher", "server", "compaction", "attachment", "tool_output",
  ]}
  {secretPaths}
/>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
</style>
```

- [ ] **Step 2: Write `src/web/sections/Tui.svelte`**

```svelte
<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import SchemaForm from "../components/SchemaForm.svelte";

  let { store }: { store: DocStore } = $props();
</script>

<h2>TUI</h2>
<SchemaForm {store} schema={store.schema} path={[]} />

<div class="keybinds-note">
  <p>Keybindings can only be edited in the <strong>Raw</strong> tab.</p>
</div>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  .keybinds-note {
    margin-top: 16px; padding: 10px 12px; background: var(--bg-2); border-radius: var(--radius);
    border-left: 3px solid var(--accent); font-size: 12px; color: var(--fg-1);
  }
</style>
```

- [ ] **Step 3: Write `src/web/sections/Misc.svelte`**

```svelte
<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import SchemaForm from "../components/SchemaForm.svelte";

  let { store }: { store: DocStore } = $props();
</script>

<h2>Misc / Experimental</h2>
<SchemaForm {store} schema={store.schema} path={[]} onlyKeys={["enterprise", "experimental"]} />

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
</style>
```

- [ ] **Step 4: Wire imports into `App.svelte`**

Add at top of `<script>`:
```ts
import General from "./sections/General.svelte";
import Tui from "./sections/Tui.svelte";
import Misc from "./sections/Misc.svelte";
```

Replace placeholder blocks in `{#if activeTab === "general"}`:
```svelte
{:else if activeTab === "general"}
  <General store={configDoc} />
{:else if activeTab === "tui"}
  <Tui store={tuiDoc} />
{:else if activeTab === "misc"}
  <Misc store={configDoc} />
```

- [ ] **Step 5: Build and verify**

Run: `bun run build`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/web/sections/General.svelte src/web/sections/Tui.svelte src/web/sections/Misc.svelte src/web/App.svelte
git commit -m "general, tui, misc sections wired"
```

---

### Task 15: Permissions section

**Files:**
- Create: `src/web/sections/Permissions.svelte`

**Interfaces:**
- Consumes: `configDoc` store, SchemaForm/Field components.
- Produces: capabilities with ask/allow/deny + pattern rule editors for bash/edit/read/external_directory.

- [ ] **Step 1: Write `src/web/sections/Permissions.svelte`**

```svelte
<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import Field from "../components/Field.svelte";

  let { store }: { store: DocStore } = $props();

  const PERMISSION_CAPABILITIES = [
    "read", "edit", "bash", "glob", "grep", "list",
    "task", "skill", "lsp", "webfetch", "websearch", "codesearch",
    "todoread", "todowrite", "question", "external_directory", "doom_loop",
  ] as const;

  const PATTERN_CAPS = ["bash", "edit", "read", "external_directory"] as const;
  type PermValue = string | { [pattern: string]: string } | undefined;

  function getPerm(cap: string): PermValue {
    const perm = (store.json as any)?.permission;
    return perm?.[cap];
  }

  function setPerm(cap: string, value: string) {
    store.patch(["permission", cap], value === "(unset)" ? undefined : value);
  }

  function addPattern(cap: string) {
    const current = getPerm(cap);
    const obj: Record<string, string> = typeof current === "object" && current !== null ? { ...current } : {};
    obj[""] = "ask";
    store.patch(["permission", cap], obj);
  }

  function setPattern(cap: string, oldPattern: string, newPattern: string) {
    const current = getPerm(cap);
    const obj: Record<string, string> = typeof current === "object" && current !== null ? { ...current } : {};
    const val = obj[oldPattern];
    delete obj[oldPattern];
    if (newPattern) obj[newPattern] = val ?? "ask";
    store.patch(["permission", cap], obj);
  }

  function setPatternAction(cap: string, pattern: string, action: string) {
    const current = getPerm(cap);
    const obj: Record<string, string> = typeof current === "object" && current !== null ? { ...current } : {};
    obj[pattern] = action;
    store.patch(["permission", cap], obj);
  }

  function removePattern(cap: string, pattern: string) {
    const current = getPerm(cap);
    const obj: Record<string, string> = typeof current === "object" && current !== null ? { ...current } : {};
    delete obj[pattern];
    store.patch(["permission", cap], Object.keys(obj).length > 0 ? obj : undefined);
  }

  function isPatternMode(cap: string): boolean {
    const v = getPerm(cap);
    return typeof v === "object" && v !== null;
  }
</script>

<h2>Permissions</h2>

{#each PERMISSION_CAPABILITIES as cap}
  {@const perm = getPerm(cap)}
  {@const isPattern = typeof perm === "object" && perm !== null}
  {@const error = store.allErrors.find((e) => e.path === `/permission/${cap}`)?.message}

  <div class="cap">
    <div class="cap-header">
      <strong>{cap}</strong>
      {#if error}<span class="error">{error}</span>{/if}
    </div>

    {#if isPattern}
      <div class="pattern-list">
        {#each Object.entries(perm) as [pattern, action]}
          <div class="pattern-row">
            <input type="text" value={pattern} placeholder="pattern"
              oninput={(e) => setPattern(cap, pattern, (e.currentTarget as HTMLInputElement).value)} />
            <select value={action} onchange={(e) => setPatternAction(cap, pattern, (e.currentTarget as HTMLSelectElement).value)}>
              {#each ["ask", "allow", "deny"] as opt}
                <option value={opt} selected={action === opt}>{opt}</option>
              {/each}
            </select>
            <button class="danger" onclick={() => removePattern(cap, pattern)}>×</button>
          </div>
        {/each}
        <button onclick={() => addPattern(cap)}>+ add pattern</button>
      </div>
    {:else}
      <div class="cap-controls">
        <select value={perm ?? "(unset)"} onchange={(e) => setPerm(cap, (e.currentTarget as HTMLSelectElement).value)}>
          {#each ["(unset)", "ask", "allow", "deny"] as opt}
            <option value={opt} selected={(perm ?? "(unset)") === opt}>{opt}</option>
          {/each}
        </select>
        {#if PATTERN_CAPS.includes(cap as any)}
          <button class="add-pattern" onclick={() => addPattern(cap)}>+ pattern rules</button>
        {/if}
      </div>
    {/if}
  </div>
{/each}

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  .cap { margin-bottom: 12px; padding: 8px; background: var(--bg-1); border-radius: var(--radius); }
  .cap-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .cap-header strong { font-size: 12px; min-width: 160px; font-family: var(--font); }
  .cap-controls { display: flex; gap: 8px; align-items: center; }
  .pattern-list { margin-left: 12px; }
  .pattern-row { display: flex; gap: 4px; margin-bottom: 4px; }
  .pattern-row input:first-child { flex: 1; font-family: var(--font); font-size: 12px; }
  .pattern-row select { width: 100px; }
  .error { color: var(--danger); font-size: 11px; }
  button { font-size: 11px; padding: 2px 6px; }
  .add-pattern { margin-top: 4px; }
</style>
```

- [ ] **Step 2: Wire into `App.svelte`**

Add import and replace the `{:else if activeTab === "permissions"}` block:
```ts
import Permissions from "./sections/Permissions.svelte";
```
```svelte
{:else if activeTab === "permissions"}
  <Permissions store={configDoc} />
```

- [ ] **Step 3: Build and verify**

Run: `bun run build`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/web/sections/Permissions.svelte src/web/App.svelte
git commit -m "permissions section with capability controls and pattern rules"
```

---

### Task 16: Providers section

**Files:**
- Create: `src/web/sections/Providers.svelte`

**Interfaces:**
- Consumes: `configDoc` store, `MaskedSecret`, `Combobox`, `KVEditor`, `StringList` (Task 11), `getCatalog` (Task 11).
- Produces: provider cards with known option controls, models sub-editor, enabled/disabled lists.

- [ ] **Step 1: Write `src/web/sections/Providers.svelte`**

```svelte
<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import Field from "../components/Field.svelte";
  import MaskedSecret from "../components/MaskedSecret.svelte";
  import StringList from "../components/StringList.svelte";
  import KVEditor from "../components/KVEditor.svelte";
  import { getCatalog } from "../state/catalog";

  let { store }: { store: DocStore } = $props();
  let collapsed = $state<Record<string, boolean>>({});

  const knownOptionFields = ["apiKey", "baseURL", "timeout", "chunkTimeout", "headers"];
  const knownProviderFields = ["api", "name", "env", "id", "npm", "whitelist", "blacklist"];

  function getProviders(): Record<string, any> {
    return (store.json as any)?.provider ?? {};
  }

  function getProviderOpts(provId: string): Record<string, any> {
    return getProviders()[provId]?.options ?? {};
  }

  function setProviderOpt(provId: string, key: string, value: unknown) {
    store.patch(["provider", provId, "options", key], value);
  }

  function addProvider() {
    const providers = getProviders();
    const id = `provider-${Object.keys(providers).length + 1}`;
    store.patch(["provider", id], {});
  }

  function removeProvider(id: string) {
    store.patch(["provider", id], undefined);
  }

  function toggleProvider(id: string) {
    collapsed[id] = !collapsed[id];
  }

  function setEnabledProviders(ids: string[]) {
    store.patch(["enabled_providers"], ids.length > 0 ? ids : undefined);
  }

  function setDisabledProviders(ids: string[]) {
    store.patch(["disabled_providers"], ids.length > 0 ? ids : undefined);
  }
</script>

<h2>Providers</h2>

<div class="provider-list">
  {#each Object.entries(getProviders()) as [provId, prov]}
    {#if provId !== "$schema"}
      {@const opts = getProviderOpts(provId)}
      {@const isCollapsed = collapsed[provId] ?? true}
      {@const error = store.allErrors.find((e) => e.path.startsWith(`/provider/${provId}`))?.message}

      <div class="provider-card">
        <div class="card-header" onclick={() => toggleProvider(provId)}>
          <span class="arrow">{isCollapsed ? "▸" : "▾"}</span>
          <strong>{provId}</strong>
          {#if error}<span class="error">{error}</span>{/if}
          <button class="danger remove" onclick={(e) => { e.stopPropagation(); removeProvider(provId); }}>×</button>
        </div>

        {#if !isCollapsed}
          <div class="card-body">
            {#each knownProviderFields as field}
              {#if prov[field] !== undefined || field === "name"}
                <Field label={field}>
                  <input type="text" value={prov[field] ?? ""}
                    onchange={(e) => store.patch(["provider", provId, field], (e.currentTarget as HTMLInputElement).value || undefined)} />
                </Field>
              {/if}
            {/each}

            <Field label="options">
              <div class="opts">
                {#each knownOptionFields as field}
                  {#if field === "apiKey"}
                    <Field label={field}>
                      <MaskedSecret value={opts[field]} onchange={(v) => setProviderOpt(provId, field, v)} />
                    </Field>
                  {:else if field === "timeout" || field === "chunkTimeout"}
                    <Field label={field}>
                      <input type="number" value={opts[field] ?? ""}
                        onchange={(e) => setProviderOpt(provId, field, (e.currentTarget as HTMLInputElement).value === "" ? undefined : Number((e.currentTarget as HTMLInputElement).value))} />
                    </Field>
                  {:else}
                    <Field label={field}>
                      <input type="text" value={opts[field] ?? ""}
                        onchange={(e) => setProviderOpt(provId, field, (e.currentTarget as HTMLInputElement).value || undefined)} />
                    </Field>
                  {/if}
                {/each}
                <details>
                  <summary>custom options</summary>
                  <KVEditor value={opts} onchange={(v) => store.patch(["provider", provId, "options"], v)} />
                </details>
              </div>
            </Field>

            <Field label="models">
              <KVEditor value={prov.models ?? {}} onchange={(v) => store.patch(["provider", provId, "models"], v)} />
            </Field>
          </div>
        {/if}
      </div>
    {/if}
  {/each}
</div>

<button class="add-btn" onclick={addProvider}>+ add provider</button>

<div class="lists">
  <Field label="enabled_providers">
    <StringList value={(store.json as any)?.enabled_providers ?? []} onchange={(v) => setEnabledProviders(v)} />
  </Field>
  <Field label="disabled_providers">
    <StringList value={(store.json as any)?.disabled_providers ?? []} onchange={(v) => setDisabledProviders(v)} />
  </Field>
</div>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  .provider-card { background: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius); margin-bottom: 8px; }
  .card-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; user-select: none; }
  .card-header:hover { background: var(--bg-2); }
  .arrow { color: var(--fg-2); font-size: 11px; }
  .card-header strong { font-family: var(--font); font-size: 13px; flex: 1; }
  .remove { margin-left: auto; }
  .card-body { padding: 8px 12px; border-top: 1px solid var(--bg-3); }
  .opts { padding-left: 8px; border-left: 1px solid var(--bg-3); }
  .add-btn { margin-bottom: 16px; }
  .lists { margin-top: 16px; }
  .error { color: var(--danger); font-size: 11px; }
  details { margin-top: 8px; }
  summary { cursor: pointer; font-size: 11px; color: var(--fg-2); }
</style>
```

- [ ] **Step 2: Wire into `App.svelte`**

```ts
import Providers from "./sections/Providers.svelte";
```
```svelte
{:else if activeTab === "providers"}
  <Providers store={configDoc} />
```

- [ ] **Step 3: Build and verify**

Run: `bun run build`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/web/sections/Providers.svelte src/web/App.svelte
git commit -m "providers section with masked secrets and model config"
```

---

### Task 17: Agents section

**Files:**
- Create: `src/web/sections/Agents.svelte`

**Interfaces:**
- Consumes: `configDoc` store, Field, KVEditor, SchemaForm.
- Produces: built-in override cards + custom agents with add/remove.

- [ ] **Step 1: Write `src/web/sections/Agents.svelte`**

```svelte
<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import Field from "../components/Field.svelte";
  import SchemaForm from "../components/SchemaForm.svelte";
  import MaskedSecret from "../components/MaskedSecret.svelte";

  let { store }: { store: DocStore } = $props();
  let collapsed = $state<Record<string, boolean>>({});

  const BUILT_INS = ["build", "plan", "general", "explore", "title", "summary", "compaction"] as const;
  const AGENT_FIELDS = ["description", "mode", "model", "variant", "temperature", "top_p", "maxTokens", "prompt", "color", "steps", "hidden", "disable", "permission"] as const;
  const DEPRECATED = ["tools", "maxSteps"];

  function getAgents(): Record<string, any> {
    return (store.json as any)?.agent ?? {};
  }

  function getAgent(id: string): any {
    return getAgents()[id];
  }

  function addCustom() {
    const agents = getAgents();
    const id = `custom-${Object.keys(agents).length + 1}`;
    store.patch(["agent", id], {});
  }

  function removeAgent(id: string) {
    store.patch(["agent", id], undefined);
  }

  function toggleAgent(id: string) {
    collapsed[id] = !collapsed[id];
  }

  function isCustom(id: string): boolean {
    return !BUILT_INS.includes(id as any);
  }
</script>

<h2>Agents</h2>

<div class="agents">
  {#each BUILT_INS as agentId}
    {@const agent = getAgent(agentId)}
    {@const isCollapsed = collapsed[agentId] ?? true}
    {@const error = store.allErrors.find((e) => e.path.startsWith(`/agent/${agentId}`))?.message}

    <div class="agent-card">
      <div class="card-header" onclick={() => toggleAgent(agentId)}>
        <span class="arrow">{isCollapsed ? "▸" : "▾"}</span>
        <strong>{agentId}</strong>
        {#if error}<span class="error">{error}</span>{/if}
      </div>

      {#if !isCollapsed}
        <div class="card-body">
          {#if agent}
            <SchemaForm {store} schema={{ properties: Object.fromEntries(AGENT_FIELDS.map(f => [f, {}])) }} path={["agent", agentId]} />
          {:else}
            <p class="empty">No overrides — using defaults.</p>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  <h3>Custom Agents</h3>
  {#each Object.keys(getAgents()).filter(isCustom) as agentId}
    {@const agent = getAgent(agentId)}
    {@const isCollapsed = collapsed[agentId] ?? true}
    {@const error = store.allErrors.find((e) => e.path.startsWith(`/agent/${agentId}`))?.message}

    <div class="agent-card custom">
      <div class="card-header" onclick={() => toggleAgent(agentId)}>
        <span class="arrow">{isCollapsed ? "▸" : "▾"}</span>
        <strong>{agentId}</strong>
        {#if error}<span class="error">{error}</span>{/if}
        <button class="danger" onclick={(e) => { e.stopPropagation(); removeAgent(agentId); }}>×</button>
      </div>

      {#if !isCollapsed}
        <div class="card-body">
          <SchemaForm {store} schema={{ properties: Object.fromEntries(AGENT_FIELDS.map(f => [f, {}])) }} path={["agent", agentId]} />
        </div>
      {/if}
    </div>
  {/each}

  <button onclick={addCustom}>+ add custom agent</button>
</div>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  h3 { font-size: 13px; color: var(--fg-1); margin: 16px 0 8px; }
  .agent-card { background: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius); margin-bottom: 8px; }
  .agent-card.custom { border-left: 2px solid var(--accent); }
  .card-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; }
  .card-header:hover { background: var(--bg-2); }
  .arrow { color: var(--fg-2); font-size: 11px; }
  .card-header strong { font-family: var(--font); font-size: 13px; flex: 1; }
  .card-body { padding: 8px 12px; border-top: 1px solid var(--bg-3); }
  .empty { color: var(--fg-2); font-size: 12px; font-style: italic; }
  .error { color: var(--danger); font-size: 11px; }
  button { font-size: 11px; padding: 2px 6px; }
</style>
```

- [ ] **Step 2: Wire into `App.svelte`**

```ts
import Agents from "./sections/Agents.svelte";
```
```svelte
{:else if activeTab === "agents"}
  <Agents store={configDoc} />
```

- [ ] **Step 3: Build and verify**

Run: `bun run build`

- [ ] **Step 4: Commit**

```bash
git add src/web/sections/Agents.svelte src/web/App.svelte
git commit -m "agents section: built-in overrides and custom agents"
```

---

### Task 18: MCP + Formatter & LSP sections

**Files:**
- Create: `src/web/sections/Mcp.svelte`, `src/web/sections/FormatterLsp.svelte`

**Interfaces:**
- Consumes: `configDoc` store, Field, KVEditor, StringList.
- Produces: MCP server entries with local/remote type switcher; formatter/lsp boolean↔object toggle.

- [ ] **Step 1: Write `src/web/sections/Mcp.svelte`**

```svelte
<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import Field from "../components/Field.svelte";
  import StringList from "../components/StringList.svelte";
  import KVEditor from "../components/KVEditor.svelte";

  let { store }: { store: DocStore } = $props();
  let collapsed = $state<Record<string, boolean>>({});
  let addingType = $state<"local" | "remote">("local");

  function getMcp(): Record<string, any> {
    return (store.json as any)?.mcp ?? {};
  }

  function addServer(type: "local" | "remote") {
    const servers = getMcp();
    const id = `mcp-${Object.keys(servers).length + 1}`;
    store.patch(["mcp", id], { type });
    addingType = "local";
  }

  function removeServer(id: string) {
    store.patch(["mcp", id], undefined);
  }

  function toggleServer(id: string) {
    collapsed[id] = !collapsed[id];
  }
</script>

<h2>MCP Servers</h2>

<div class="mcp-list">
  {#each Object.entries(getMcp()) as [id, server]}
    {#if id !== "$schema"}
      {@const isCollapsed = collapsed[id] ?? true}
      {@const error = store.allErrors.find((e) => e.path.startsWith(`/mcp/${id}`))?.message}

      <div class="server-card">
        <div class="card-header" onclick={() => toggleServer(id)}>
          <span class="arrow">{isCollapsed ? "▸" : "▾"}</span>
          <strong>{id}</strong>
          <span class="type-badge">{server?.type ?? "?"}</span>
          {#if error}<span class="error">{error}</span>{/if}
          <button class="danger" onclick={(e) => { e.stopPropagation(); removeServer(id); }}>×</button>
        </div>

        {#if !isCollapsed}
          <div class="card-body">
            {#if server?.type === "local"}
              <Field label="command">
                <StringList value={server.command ?? []} onchange={(v) => store.patch(["mcp", id, "command"], v)} />
              </Field>
              <Field label="environment">
                <KVEditor value={server.environment ?? {}} onchange={(v) => store.patch(["mcp", id, "environment"], v)} />
              </Field>
              <Field label="cwd">
                <input type="text" value={server.cwd ?? ""}
                  onchange={(e) => store.patch(["mcp", id, "cwd"], (e.currentTarget as HTMLInputElement).value || undefined)} />
              </Field>
            {:else}
              <Field label="url">
                <input type="text" value={server.url ?? ""}
                  onchange={(e) => store.patch(["mcp", id, "url"], (e.currentTarget as HTMLInputElement).value)} />
              </Field>
              <Field label="headers">
                <KVEditor value={server.headers ?? {}} onchange={(v) => store.patch(["mcp", id, "headers"], v)} />
              </Field>
              <Field label="oauth">
                <label class="toggle">
                  <input type="checkbox" checked={!!server.oauth} onchange={(e) => store.patch(["mcp", id, "oauth"], (e.currentTarget as HTMLInputElement).checked)} />
                  <span>{server.oauth ? "on" : "off"}</span>
                </label>
              </Field>
            {/if}

            <Field label="enabled">
              <label class="toggle">
                <input type="checkbox" checked={server?.enabled !== false} onchange={(e) => store.patch(["mcp", id, "enabled"], (e.currentTarget as HTMLInputElement).checked)} />
                <span>{server?.enabled !== false ? "on" : "off"}</span>
              </label>
            </Field>
            <Field label="timeout">
              <input type="number" value={server?.timeout ?? ""}
                onchange={(e) => store.patch(["mcp", id, "timeout"], (e.currentTarget as HTMLInputElement).value === "" ? undefined : Number((e.currentTarget as HTMLInputElement).value))} />
            </Field>
          </div>
        {/if}
      </div>
    {/if}
  {/each}
</div>

<div class="add-bar">
  <select bind:value={addingType}>
    <option value="local">local</option>
    <option value="remote">remote</option>
  </select>
  <button onclick={() => addServer(addingType)}>+ add server</button>
</div>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  .server-card { background: var(--bg-1); border: 1px solid var(--bg-3); border-radius: var(--radius); margin-bottom: 8px; }
  .card-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; }
  .card-header:hover { background: var(--bg-2); }
  .arrow { color: var(--fg-2); font-size: 11px; }
  .card-header strong { font-family: var(--font); font-size: 13px; flex: 1; }
  .type-badge { font-size: 10px; color: var(--fg-2); background: var(--bg-2); padding: 1px 6px; border-radius: 3px; }
  .card-body { padding: 8px 12px; border-top: 1px solid var(--bg-3); }
  .add-bar { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; }
  .toggle input { width: auto; }
  .error { color: var(--danger); font-size: 11px; }
  button { font-size: 11px; padding: 2px 6px; }
</style>
```

- [ ] **Step 2: Write `src/web/sections/FormatterLsp.svelte`**

```svelte
<script lang="ts">
  import type { DocStore } from "../state/doc-store.svelte";
  import Field from "../components/Field.svelte";
  import KVEditor from "../components/KVEditor.svelte";

  let { store }: { store: DocStore } = $props();

  function getValue(key: string): any {
    return (store.json as any)?.[key];
  }

  function isObject(val: any): boolean {
    return typeof val === "object" && val !== null && typeof val !== "boolean";
  }

  function toggleFormatter() {
    const current = getValue("formatter");
    if (current === undefined) {
      store.patch(["formatter"], true);
    } else if (typeof current === "boolean") {
      store.patch(["formatter"], {});
    } else {
      store.patch(["formatter"], undefined);
    }
  }

  function toggleLsp() {
    const current = getValue("lsp");
    if (current === undefined) {
      store.patch(["lsp"], true);
    } else if (typeof current === "boolean") {
      store.patch(["lsp"], {});
    } else {
      store.patch(["lsp"], undefined);
    }
  }
</script>

<h2>Formatter & LSP</h2>

<div class="section">
  <Field label="formatter">
    {#if getValue("formatter") === undefined}
      <button onclick={toggleFormatter}>enable</button>
    {:else if typeof getValue("formatter") === "boolean"}
      <div class="toggle-row">
        <span>{getValue("formatter") ? "enabled (all tools)" : "disabled"}</span>
        <button class="danger" onclick={toggleFormatter}>disable</button>
        <button onclick={() => store.patch(["formatter"], {})}>configure per-tool</button>
      </div>
    {:else}
      <div class="toggle-row">
        <span>per-tool configuration</span>
        <button onclick={() => store.patch(["formatter"], true)}>set all on</button>
        <button class="danger" onclick={toggleFormatter}>disable</button>
      </div>
      <KVEditor value={getValue("formatter")} onchange={(v) => store.patch(["formatter"], v)} />
    {/if}
  </Field>

  <Field label="lsp">
    {#if getValue("lsp") === undefined}
      <button onclick={toggleLsp}>enable</button>
    {:else if typeof getValue("lsp") === "boolean"}
      <div class="toggle-row">
        <span>{getValue("lsp") ? "enabled (all tools)" : "disabled"}</span>
        <button class="danger" onclick={toggleLsp}>disable</button>
        <button onclick={() => store.patch(["lsp"], {})}>configure per-tool</button>
      </div>
    {:else}
      <div class="toggle-row">
        <span>per-tool configuration</span>
        <button onclick={() => store.patch(["lsp"], true)}>set all on</button>
        <button class="danger" onclick={toggleLsp}>disable</button>
      </div>
      <KVEditor value={getValue("lsp")} onchange={(v) => store.patch(["lsp"], v)} />
    {/if}
  </Field>
</div>

<style>
  h2 { font-size: 15px; color: var(--fg-0); margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid var(--bg-3); }
  .section { max-width: 600px; }
  .toggle-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; font-size: 12px; }
  button { font-size: 11px; padding: 2px 8px; }
</style>
```

- [ ] **Step 3: Wire both into `App.svelte`**

```ts
import Mcp from "./sections/Mcp.svelte";
import FormatterLsp from "./sections/FormatterLsp.svelte";
```
```svelte
{:else if activeTab === "mcp"}
  <Mcp store={configDoc} />
{:else if activeTab === "formatter"}
  <FormatterLsp store={configDoc} />
```

- [ ] **Step 4: Build and verify**

Run: `bun run build`

- [ ] **Step 5: Commit**

```bash
git add src/web/sections/Mcp.svelte src/web/sections/FormatterLsp.svelte src/web/App.svelte
git commit -m "mcp and formatter/lsp sections"
```

---

### Task 19: Raw editor tab

**Files:**
- Create: `src/web/sections/Raw.svelte`

**Interfaces:**
- Consumes: `configDoc`/`tuiDoc` stores, `pointerToOffset` (Task 10), CodeMirror deps.
- Produces: CodeMirror 6 with `@shopify/lang-jsonc`, schema-driven lint markers from store errors, "Save anyway" for schema-invalid docs.

- [ ] **Step 1: Write `src/web/sections/Raw.svelte`**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { EditorView, keymap, placeholder as ph } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { jsonc } from "@shopify/lang-jsonc";
  import { linter, lintGutter } from "@codemirror/lint";
  import { bracketMatching } from "@codemirror/language";
  import type { DocStore } from "../state/doc-store.svelte";
  import { pointerToOffset } from "../state/patch";

  let { store, onForceSave }: { store: DocStore; onForceSave: () => void } = $props();
  let editorEl: HTMLDivElement;
  let view: EditorView | undefined;
  let suppressNext = false;

  function makeLintSource() {
    return linter(() => {
      return store.allErrors.map((err) => {
        const len = err.length ?? (err.message.length > 20 ? 20 : err.message.length);
        const from = err.source === "parse" && typeof err.offset === "number"
          ? err.offset
          : pointerToOffset(store.raw, err.path);
        return {
          from: Math.min(from, store.raw.length),
          to: Math.min(from + len, store.raw.length),
          severity: "error" as const,
          message: err.message,
        };
      });
    });
  }

  const darkTheme = EditorView.theme({
    "&": { backgroundColor: "#1e1e2e", color: "#cdd6f4" },
    ".cm-content": { caretColor: "#89b4fa" },
    ".cm-gutters": { backgroundColor: "#181825", color: "#7f849c", border: "none" },
    ".cm-activeLineGutter": { backgroundColor: "#313244" },
    ".cm-activeLine": { backgroundColor: "#1e1e2e22" },
    ".cm-selectionBackground": { backgroundColor: "#45475a55" },
    ".cm-cursor": { borderLeftColor: "#89b4fa" },
    ".cm-matchingBracket": { backgroundColor: "#45475a", outline: "none" },
  }, { dark: true });

  onMount(() => {
    view = new EditorView({
      parent: editorEl,
      state: EditorState.create({
        doc: store.raw,
        extensions: [
          keymap.of([...defaultKeymap, ...historyKeymap]),
          history(),
          bracketMatching(),
          jsonc(),
          lintGutter(),
          makeLintSource(),
          darkTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              suppressNext = true;
              store.setText(update.state.doc.toString());
              suppressNext = false;
            }
          }),
        ],
      }),
    });
  });

  onDestroy(() => {
    view?.destroy();
  });

  $effect(() => {
    if (view && !suppressNext && store.raw !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: store.raw },
      });
    }
  });
</script>

<div class="raw-section">
  <div class="raw-header">
    <span class="doc-name">{store.id === "config" ? "opencode.json" : "tui.json"}</span>
    {#if store.parseErrors.length > 0}
      <span class="error-badge">{store.parseErrors.length} parse error(s)</span>
    {:else if store.schemaErrors.length > 0}
      <span class="warn-badge">{store.schemaErrors.length} schema error(s)</span>
    {:else}
      <span class="ok-badge">valid</span>
    {/if}
  </div>

  <div class="editor" bind:this={editorEl}></div>

  {#if !store.valid}
    <div class="error-panel">
      <p>Errors:</p>
      <ul>
        {#each store.allErrors as err}
          <li class={err.source}>
            <span class="source">[{err.source}]</span> {err.path || "/"}: {err.message}
          </li>
        {/each}
      </ul>
      {#if store.schemaErrors.length > 0 && store.parseErrors.length === 0}
        <button class="force-btn" onclick={onForceSave}>Save anyway</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .raw-section { display: flex; flex-direction: column; height: calc(100vh - 60px); }
  .raw-header { display: flex; align-items: center; gap: 12px; padding: 8px 0; font-size: 12px; }
  .doc-name { font-family: var(--font); color: var(--fg-1); }
  .error-badge { color: var(--danger); }
  .warn-badge { color: var(--warn); }
  .ok-badge { color: var(--success); }
  .editor { flex: 1; overflow: auto; border: 1px solid var(--bg-3); border-radius: var(--radius); }
  .error-panel {
    margin-top: 8px; padding: 10px; background: var(--bg-1); border: 1px solid var(--bg-3);
    border-radius: var(--radius); max-height: 200px; overflow-y: auto;
  }
  .error-panel p { font-size: 11px; color: var(--fg-1); margin-bottom: 6px; }
  .error-panel ul { list-style: none; padding: 0; margin: 0; }
  .error-panel li { font-size: 11px; padding: 2px 0; font-family: var(--font); }
  .error-panel li.parse { color: var(--danger); }
  .error-panel li.schema { color: var(--warn); }
  .source { color: var(--fg-2); font-size: 10px; margin-right: 4px; }
  .force-btn {
    margin-top: 8px; padding: 6px 16px; background: var(--danger); color: var(--bg-0);
    border: none; border-radius: var(--radius); cursor: pointer; font: inherit;
  }
  .force-btn:hover { opacity: 0.8; }
</style>
```

- [ ] **Step 2: Wire into `App.svelte`**

```ts
import Raw from "./sections/Raw.svelte";
```
```svelte
{:else if activeTab === "raw"}
  <Raw store={currentDoc} onForceSave={forceSave} />
```

- [ ] **Step 3: Build and verify**

Run: `bun run build`

- [ ] **Step 4: Commit**

```bash
git add src/web/sections/Raw.svelte src/web/App.svelte
git commit -m "raw editor tab with code, jsonc highlighting, lint markers, save anyway"
```

---

### Task 20: Final wiring, README, acceptance verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: documented README, `bun run start` end-to-end verification, acceptance checklist confirmation.

- [ ] **Step 1: Update `README.md`**

```md
# opencode-knobs

Every knob and dial opencode exposes, in one UI.

## Quick Start

```bash
bun install
bun run update-schemas   # vendor opencode schemas (committed, offline-capable)
bun run build            # build the Svelte frontend
bun run start            # open browser, print one-time login code
```

### Commands

| Script | Description |
|---|---|
| `bun run start` | Build (if needed) + serve on `127.0.0.1:4789` |
| `bun run dev` | Dev mode: `bun --watch` server + Vite dev server (port 5173, proxy `/api`) |
| `bun run build` | Vite build into `dist/` |
| `bun run test` | Run all `bun test` suites |
| `bun run update-schemas` | Re-download vendored opencode JSON schemas |

### CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--host` | `127.0.0.1` | Bind address. `0.0.0.0` enables LAN (code required) |
| `--port` | `4789` | HTTP port |
| `--idle-timeout` | `30` | Minutes without requests → shutdown. `0` disables |

## How It Works

1. `bun run start` prints a one-time 8-character login code to your terminal
2. Open the URL, enter the code
3. Edit your opencode config in the GUI or raw JSONC editor
4. Save — comments, formatting, and `{env:…}` placeholders survive byte-identically

The app reads/writes exactly two files in `~/.config/opencode/` (honors `XDG_CONFIG_HOME`):
- `opencode.json` — runtime config
- `tui.json` — terminal UI config

## Security

- One-time login code required on every start (even localhost)
- Session cookie: `HttpOnly`, `SameSite=Strict`
- Rate limiting: 5 failed attempts → 30s lockout
- DNS-rebinding protection via Host header validation
- Mutating endpoints require `X-Requested-With: fetch`

## Development

```bash
# Terminal 1
bun run dev:server   # or: bun --watch src/server/index.ts

# Terminal 2
bun run dev:web      # or: bunx vite --port 5173
```

Vite dev server (port 5173) proxies `/api` to the Bun server (port 4789).

## Testing

```bash
bun test
```

Tests cover:
- Config pipeline: JSONC round-trip, path-based patching, backup rotation, atomic write, force semantics
- Auth: code generation, rate limiting, session management
- Client patch helpers: indentation detection, patch application, pointer resolution
- E2E: spawn server, login, GET, PUT, verify backup on disk
```

- [ ] **Step 2: Full acceptance run**

```bash
bun test          # all test suites pass
bun run build     # frontend builds
bun run start &   # starts, prints code
# open browser, enter code, edit config, save, verify byte-identical round-trip
```

- [ ] **Step 3: Final commit**

```bash
git add README.md
git commit -m "docs: README with quick start, security, and development guide"
```

- [ ] **Step 4: Final full test run and verification**

```bash
bun test && bun run build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 5: Tag release**

```bash
git tag -a v0.1.0 -m "v0.1.0: first release"
```

---

**Plan complete.** All 20 tasks defined with exact file paths, interfaces, complete code, and commit messages. Run `bun test` after each task to verify. The e2e test (Task 8) validates the full flow end-to-end.
