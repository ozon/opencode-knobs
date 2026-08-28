# opencode-knobs — Design Document

Date: 2026-08-28
Status: Approved
Companion spec: `SPEC.md` (project brief & implementation directives)

This document refines SPEC.md with the architectural decisions agreed during brainstorming. Where SPEC.md is already prescriptive (flags, API surface, auth rules, CFG/VAL/META/TEST requirements), this design defers to it and fills in the open decisions.

## Decisions made

| # | Decision | Choice |
|---|---|---|
| D1 | Where path-based JSONC patches are applied | **Client-side** — frontend holds canonical raw text, runs `jsonc-parser` `modify()`/`applyEdits()` in the browser; PUT sends full raw text; server re-validates and writes |
| D2 | GUI form strategy | **Hybrid** — generic schema-driven renderer for simple sections; hand-built Svelte components for Providers, Agents, MCP, Formatter & LSP, and permission pattern lists |
| D3 | Repo layout | **Single package**, server in `src/server`, frontend in `src/web` (Vite root) |
| D4 | Styling | **Plain CSS** — Svelte scoped `<style>` blocks + one global stylesheet with CSS custom properties (dark theme default) |

## 1. Architecture & Layout

```
opencode-knobs/
├── package.json                # single package, bun scripts
├── scripts/update-schemas.ts   # vendors schemas → schemas/ + manifest
├── schemas/                    # config.json, tui.json, manifest.json (fetch date)
├── src/
│   ├── server/                 # Bun + Hono
│   │   ├── index.ts            # CLI flags, startup, idle timer, browser open
│   │   ├── app.ts              # Hono app: static serving + API routes
│   │   ├── auth.ts             # code gen, sessions, rate limit, CSRF/Host checks
│   │   ├── config.ts           # JSONC load/validate/backup/atomic-write pipeline
│   │   └── models.ts           # models.dev fetch + in-memory cache
│   ├── web/                    # Svelte 5 + Vite (Vite root)
│   │   ├── App.svelte          # tab bar, doc switcher, save button
│   │   ├── state/              # doc store: raw text + parsed JSON + dirty flags
│   │   ├── patch.ts            # jsonc-parser modify() wrapper (client-side)
│   │   ├── schema/             # schema walker for generic form renderer
│   │   ├── sections/           # General, Providers, Agents, MCP, Permissions,
│   │   │                       # FormatterLsp, Tui, Misc, Raw
│   │   └── components/         # Field, EnumSelect, KVList, MaskedSecret, …
│   └── shared/                 # types shared by server & web (API shapes, doc ids)
└── test/                       # bun test: config pipeline, auth, validation, e2e
```

Single Bun process serves the built frontend (static assets from `dist/`) plus the JSON API. No separate dev server needed at runtime.

## 2. Data flow & sync model

1. Frontend holds one canonical state per document (`config`, `tui`): `{ raw: string, json: object | null, parseErrors, validationErrors, dirty, exists }`.
2. GUI edit → `modify(raw, path, value, formattingOptions)` → `applyEdits()` → new raw text → re-parse (jsonc-parser) → re-validate (Ajv, browser) → both views update. Deleting a value uses `modify(raw, path, undefined)`.
3. Raw editor (CodeMirror 6) edits update the raw text directly → same re-parse/validate cycle.
4. Save → for each dirty doc: `PUT /api/config/:doc { raw }` → server re-parses, Ajv-validates, backs up, atomic-writes → returns `{ valid, errors[], backupPath }`. Raw-tab "Save anyway" (VAL-4) sends `force: true`, which bypasses schema errors only, never syntax errors (§3.3).
5. Sync rules (SPEC §9.1):
   - GUI → Raw: raw always reflects current store immediately.
   - Raw → GUI: blocked while parse errors exist; errors shown, stay in Raw.
   - Validation errors: CM lint markers in Raw; inline field-level errors in GUI keyed by Ajv `instancePath`.

Consequence of D1: the server never derives patches; it persists exactly the raw text it receives via the JSONC-preserving write pipeline (which, since the client already applied minimal `modify()` edits, keeps untouched regions byte-identical).

## 3. Server

### 3.1 Auth (AUTH-1..6)

- One-time code: 8 chars from alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (A–Z, 2–9 minus 0/O/1/I), generated with `crypto.randomInt`, fresh per start.
- Session: 32-byte random token → in-memory `Map<token, createdAt>`; cookie `knobs_session` with `HttpOnly; SameSite=Strict; Path=/`. All sessions die on restart (new code, new secret).
- Rate limit on `/api/login`: per-IP failure counter; 5 failures → 30 s lockout (HTTP 429). Code comparison via `timingSafeEqual` over SHA-256 digests (constant-time, length-safe).
- CSRF / DNS-rebinding (AUTH-5): mutating endpoints require header `X-Requested-With: fetch`; Host header validation is mandatory in both modes but depends on the bind address: bound to `127.0.0.1` → accept only `127.0.0.1:<port>` or `localhost:<port>`; bound to `0.0.0.0` → validate the port only (LAN clients send their own host IP). Mismatch → 403.
- `/api/login` is the only unauthenticated route. The code is printed to the terminal only; the session secret is never logged.

### 3.2 Config pipeline (CFG-1..10)

- Path resolution: `$XDG_CONFIG_HOME/opencode/` if set, else `~/.config/opencode/`. Files: `opencode.json`, `tui.json`. No other layer is read.
- Load: read file (missing → `{ exists: false, raw: "" }`); `parseTree` for diagnostics, `parse` (comments + trailing commas allowed) for JSON.
- Write: Ajv validate (draft 2020-12; `force` semantics in §3.3) → backup current file to `<name>.bak-<YYYYMMDD-HHMMSS>` next to the original, rotate to newest 5 → write temp file in same directory → `rename()` (atomic). The server writes the received raw text **verbatim** and never re-formats.
- Indentation detection (CFG-4) is client-side: since `modify()` runs in the browser (D1), `src/web/state/patch.ts` detects the file's indentation (first indented line's leading whitespace; fallback 2 spaces) and passes it as `modify()` formatting options.
- Missing-file flow (CFG-5): GET reports `exists: false` → client initializes the doc store with the template `{ "$schema": "<matching schema URL>" }`, so the first save produces a valid file including `$schema`. The server creates the file on PUT, creating `~/.config/opencode/` recursively if missing.
- Secret masking (CFG-10) is a frontend concern; the server persists raw text verbatim. Untouched secrets emit no patch because client patches are path-based.
- No file watcher (CFG-8).

### 3.3 API

| Route | Behavior |
|---|---|
| `POST /api/login` | `{code}` → session cookie; 429 during lockout |
| `POST /api/logout` | drop session |
| `GET /api/config/:doc` | `{ raw, json, valid, errors[], schemaVersion, exists }`; missing file → `{ exists: false, raw: "" }` |
| `PUT /api/config/:doc` | `{ raw, force?: boolean }` → validate, backup, atomic write → `{ valid, errors[], backupPath }` |
| `GET /api/schema/:doc` | vendored JSON schema |
| `GET /api/meta/providers` | models.dev snapshot or `{ available: false }` |
| `GET /api/health` | liveness; resets idle timer (authenticated only) |

PUT semantics (VAL-4 "Save anyway"):

- Syntax-invalid JSON → always HTTP 400, never written. `force` does NOT bypass syntax errors (opencode could not read the file).
- Schema-invalid, `force` absent/false → HTTP 422 + `errors[]`, no write.
- Schema-invalid, `force: true` → write (backup as usual).

### 3.4 Idle timer & startup

- Flags: `--host` (default `127.0.0.1`), `--port` (default `4789`), `--idle-timeout` minutes (default `30`, `0` disables).
- Any authenticated request resets the timer; on expiry log and `process.exit(0)`. Frontend sends no keep-alive pings; an open idle tab does not prevent shutdown.
- Startup: parse flags → generate code + session secret → print URL(s), code, idle timeout → open browser (`xdg-open`/`open` via `Bun.spawn`, failure ignored) → background models.dev fetch (5 s timeout, non-blocking) → serve.

## 4. Frontend

### 4.1 State

- Svelte 5 runes. `createDocStore(docId)` per document with the state from §2. When GET reports `exists: false`, the store initializes with the template `{ "$schema": "<matching schema URL>" }` (CFG-5).
- Single mutation entry point `applyPatch(path, value)` in `state/patch.ts` → client-side indentation detection + `modify()`/`applyEdits()` → re-parse → re-validate → set dirty.
- Ajv runs in the browser against the schema fetched from `/api/schema/:doc`; compiled validators cached per doc.
- Error shape (shared by GUI inline errors and CodeMirror lint markers): `{ path: string /* Ajv instancePath / JSON Pointer */, message: string, source: "parse" | "schema" }`.
- CodeMirror 6 as controlled view: external store changes pushed via editor transactions; user typing updates the store (debounced re-parse). JSONC language mode + schema-driven lint source.

### 4.2 Layout

```
[General][Providers][Agents][MCP][Permissions][Formatter & LSP][TUI][Misc][Raw]
                                                      [opencode.json | tui.json]
[Save ●●]   ← dirty badge per document
```

- General..Misc operate on `opencode.json`; TUI tab operates on `tui.json`; Raw tab has the file switcher.
- One global Save button writes all dirty docs (each gets its own backup); per-doc failure → error toast, doc stays dirty. `beforeunload` warning while dirty.
- Server-gone detection: failed fetch → "server stopped" overlay state.

### 4.3 Sections (hybrid rendering, D2)

Generic schema renderer (`schema/` walker) — walks schema properties, skips deprecated properties (VAL-5: case-insensitive match on "deprecated" in schema `description`/`markdownDescription`, with the explicit known list from SPEC §VAL-5 — `mode`, `autoshare`, `layout`, `reference`/`references`, `agent.*.tools` — as fallback for unmarked properties), renders by type: string → text input, enum → select, boolean → toggle, number → number input (respecting min/max), string array → list editor, object → nested group. Schema `description` shown as help text on every control. Used for: **General**, **TUI**, **Misc/experimental**, and the ask/allow/deny selects of **Permissions**.

Hand-built components:

- **Providers** — provider cards; known option fields as proper controls (`apiKey` masked, `baseURL`, `timeout`, `chunkTimeout`, `headers` KV list, region/project/etc.); `models.<id>` sub-form (name, cost, limit, options, variants, reasoning, temperature, tool_call, attachment, status, headers); unknown option keys as raw KV list; `enabled_providers`/`disabled_providers` lists; models.dev searchable dropdowns with free-text fallback (META-3).
- **Agents** — built-in agents (build, plan, general, explore, title, summary, compaction) as override cards; custom agents add/remove; fields: description, mode, model, variant, temperature, top_p, maxTokens, prompt, color (color picker), steps, hidden, disable, permission overrides. `tools` hidden (deprecated, VAL-5).
- **MCP** — per-server entry with local/remote type switcher on create; local: command list, environment KV, enabled, timeout; remote: url, headers KV, oauth, enabled, timeout.
- **Formatter & LSP** — global booleans plus per-tool entries rendered as boolean toggle that expands into object form (`disabled`, `command`, `extensions`, `env`).
- **Permissions** — per-capability ask/allow/deny controls; pattern-rule list editors (pattern → decision) for `bash`, `edit`, `read`, `external_directory`; `tools.*` boolean map.
- **TUI** — generic-rendered (theme, leader_timeout, scroll_speed, scroll_acceleration, diff_style, cursor, mouse, attention) plus an info box: "Keybindings can only be edited in the Raw tab" (backlog item).

### 4.4 Secret masking (CFG-10)

Masked fields (at minimum `provider.*.options.apiKey`) display `••••••`. An explicit "edit" action reveals an input with placeholder "leave blank to keep unchanged"; submitting blank emits **no patch**. An explicit "clear" action emits a patch removing/emptying the value. Untouched secrets never rewrite the file.

### 4.5 models.dev metadata (META-1..4)

Server fetches `https://models.dev/api.json` at startup (5 s timeout, in-memory cache, process lifetime). `/api/meta/providers` feeds searchable comboboxes for provider ids (with name/npm/env-var hint) and per-provider model ids (context limit, cost shown as hints). Fetch failure → free-text entry only + subtle "provider catalog unavailable" badge. Never blocks startup or editing.

## 5. Schema vendoring & build

- `scripts/update-schemas.ts` (`bun run update-schemas`): downloads `https://opencode.ai/config.json` and `https://opencode.ai/tui.json` into `schemas/`, writes `schemas/manifest.json` with `fetchedAt` and opencode version when detectable. Schemas are committed → runtime works fully offline (VAL-1).
- Frontend consumes schemas via `/api/schema/:doc` (single source of truth, no bundle duplication).
- Scripts: `bun run build` → `vite build` (outDir `dist/`); `bun run start` → builds if `dist/` missing, then serves; `bun run dev` → Vite dev server proxying `/api` to the Bun server.

## 6. Testing (TEST-1..3, `bun test`)

- `test/config.test.ts` — JSONC round-trip preserves comments/formatting/`{env:…}` placeholders byte-identical; path patch touches only the edited path; backup creation + rotation to 5; create-on-first-save includes `$schema` (dir created recursively); indentation detection (client helper); atomic write; server writes received raw text verbatim.
- `test/auth.test.ts` — code alphabet/length; constant-time compare; 5 failures → lockout → 429; lockout expiry; session invalidation on restart; Host header rules per bind mode (localhost strict, 0.0.0.0 port-only); missing `X-Requested-With` on mutating routes → 403.
- `test/validation.test.ts` — invalid doc blocked on PUT → 422 (VAL-3); `force: true` writes schema-invalid doc + backup; syntax-invalid doc → 400 and never written even with `force`; valid doc accepted; deprecated-property detection helper.
- `test/e2e.test.ts` — spawn server on a random port with temp `XDG_CONFIG_HOME` → read code from stdout → login → GET config → PUT change → verify file content + `.bak-*` backup on disk.

## 7. Acceptance criteria

SPEC.md §14 items 1–8 all apply; items 3, 4, 5, 8 are covered by automated tests, items 1, 2, 6, 7 by manual verification during development.
