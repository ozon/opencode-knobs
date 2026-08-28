# opencode-knobs — Project Brief & Implementation Directives

> **Project name:** `opencode-knobs` — *every knob and dial opencode exposes, in one UI.*
> **Audience:** autonomous coding agent. Your job: refine this brief into specs where needed, then implement the application.
> **Language:** UI, code, comments, and docs in English.
> **Hard rule:** Never invent configuration keys. The vendored opencode JSON Schemas are the single source of truth for every setting the UI exposes.

---

## 1. Mission

Build a small, fast, modern standalone web app that lets a developer configure [opencode](https://github.com/sst/opencode) through a browser UI:

- The developer starts the app locally, a one-time login code is printed to the terminal, they open the URL, enter the code, and edit their config.
- The app reads and writes exactly two files:
  - `~/.config/opencode/opencode.json` (runtime/server config)
  - `~/.config/opencode/tui.json` (terminal UI config)
- The UI offers both a **raw JSON editor** and a **structured GUI** with dedicated sections (Providers incl. model config, Agents, MCP, …), kept in sync from a single document state.
- JSONC (comments) and variable placeholders (`{env:VAR}`, `{file:path}`) must survive a save round-trip byte-identical unless the user explicitly edits them.

## 2. Ground-Truth References

Fetch and vendor these at build time (see §8):

| Artifact | URL | Covers |
|---|---|---|
| Config JSON Schema | `https://opencode.ai/config.json` | All `opencode.json` settings (JSON Schema draft 2020-12, `additionalProperties: false` at root) |
| TUI JSON Schema | `https://opencode.ai/tui.json` | All `tui.json` settings |

Upstream source files (for context only, do not parse them):

- `packages/opencode/src/config/config.ts` — Zod schema the config schema is generated from
- `packages/opencode/src/config/tui.ts` — TUI schema source
- `packages/opencode/src/config/variable.ts` — `{env:…}` / `{file:…}` substitution semantics

Config behavior to respect (from opencode docs):

- opencode accepts JSON **and** JSONC (comments, trailing commas).
- opencode merges many config layers (remote, global, env vars, project, `.opencode/` dirs, managed). **This app deliberately ignores all layers except the two global files.** Do not read project configs, `OPENCODE_CONFIG`, `OPENCODE_TUI_CONFIG`, or `OPENCODE_CONFIG_CONTENT`.

## 3. Tech Stack (fixed)

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Bun** (current stable) | Same ecosystem as opencode; fast startup |
| Server | **Hono** v4.13+ | Tiny (~14 kB), web-standard, Bun-native |
| Frontend build | **Vite** 8 | Current major, Rolldown-based, fast |
| Frontend framework | **Svelte** 5 + TypeScript | Compiles away, small bundle, ergonomic forms |
| Raw editor | **CodeMirror** 6 | JSONC mode + lint integration; Monaco is too heavy |
| Schema validation | **Ajv** (draft 2020-12) | Validates against vendored schemas |
| JSONC read/write | **`jsonc-parser`** (Microsoft) | Parse with comments; `modify()`/`applyEdits()` for comment-preserving writes |
| Tests | `bun test` (+ one e2e smoke test) | Zero extra deps |

Everything TypeScript end-to-end. Keep the dependency list short — this tool must stay small and fast.

## 4. Architecture

Single Bun process:

1. **Server (Hono)** serves the built Svelte frontend (static assets) plus a small JSON API.
2. **Config service** (server-side) owns all file I/O: load, parse (JSONC), validate (Ajv), patch, backup, write.
3. **Frontend** holds one in-memory document state per file (`opencode.json`, `tui.json`), rendered both as raw editor and as section forms.

Suggested API surface (REST, JSON bodies, session-protected):

```
POST /api/login            { code } → sets session cookie
POST /api/logout
GET  /api/config/:doc      doc ∈ {config, tui} → { raw, json, valid, errors[], schemaVersion }
PUT  /api/config/:doc      { raw } → validate, backup, atomic write → { valid, errors[], backupPath }
GET  /api/schema/:doc      vendored JSON schema
GET  /api/meta/providers   models.dev snapshot (see §10) or { available: false }
GET  /api/health           liveness (also resets idle timer)
```

The frontend may also send structured patches instead of full raw text; whichever the implementation chooses, the server must always persist via the JSONC-preserving pipeline in §7.

## 5. CLI & Startup

Package/binary name: **`opencode-knobs`** (`package.json` name, repository name, terminal title).

Entry point: `bun run start` (dev workflow: local clone first; npm/`bunx opencode-knobs` packaging is backlog, see §12).

Flags (all optional):

| Flag | Default | Meaning |
|---|---|---|
| `--host` | `127.0.0.1` | Bind address. `0.0.0.0` enables LAN access (login code mandatory, see §6) |
| `--port` | `4789` | Port (4096 is opencode's own server port — avoid) |
| `--idle-timeout` | `30` | Minutes without any authenticated request → graceful auto-shutdown. `0` disables |

Startup sequence:

1. Parse flags, generate one-time code + session secret.
2. Print to terminal: local URL(s), the one-time code, and the idle timeout.
3. Open the browser automatically (`http://<host>:<port>`).
4. Kick off the models.dev fetch in the background (non-blocking, §10).
5. Arm the idle timer: any authenticated HTTP request resets it; on expiry, log a message and exit cleanly. The frontend must **not** send keep-alive pings; an open but idle tab does not prevent shutdown. If the server is gone, the UI shows a "server stopped" state instead of failing silently.

## 6. Authentication & Security

- **AUTH-1** One-time code: 8 characters from an unambiguous alphabet (`A–Z`, `2–9`, excluding `0`, `O`, `1`, `I`); generated fresh on every start.
- **AUTH-2** Successful login sets an `httpOnly`, `SameSite=Strict` session cookie backed by an in-memory session store. Session lives until server restart; a restart invalidates all sessions (new code, new secret).
- **AUTH-3** Rate limiting on `/api/login`: 5 failed attempts → 30 s lockout per client IP; constant-time code comparison.
- **AUTH-4** All `/api/*` endpoints except `/api/login` require a valid session.
- **AUTH-5** CSRF / DNS-rebinding hardening: mutating endpoints must require a custom header (e.g. `X-Requested-With: fetch`) and validate the `Host` header against the bound host/port.
- **AUTH-6** The code is mandatory in every mode, including default localhost. Never log the session secret; the one-time code is printed to the terminal only, never exposed via API.

## 7. Config Files & Data Handling

- **CFG-1** Exactly two documents: `~/.config/opencode/opencode.json` and `~/.config/opencode/tui.json`. No other config layer is read or displayed.
- **CFG-2** Parse with `jsonc-parser` (allow comments + trailing commas). If parsing fails, surface errors in the UI; the raw editor stays usable, the GUI sections show a "fix JSON first" state.
- **CFG-3** Writes are minimal, path-based patches via `jsonc-parser`'s `modify()`/`applyEdits()`. Untouched regions of the file — comments, formatting, placeholders, secrets — must remain byte-identical.
- **CFG-4** Preserve the file's existing indentation (detect via `jsonc-parser` formatting options); default for new files: 2 spaces, UTF-8, trailing newline.
- **CFG-5** If a file does not exist: show an empty-document state in the UI; create it only on first save, initialized with the matching `$schema` key (`https://opencode.ai/config.json` resp. `https://opencode.ai/tui.json`).
- **CFG-6** Backup before every write: copy current file to `<name>.bak-<YYYYMMDD-HHMMSS>` next to the original; keep the newest 5 backups per file, delete older ones.
- **CFG-7** Atomic write: write to a temp file in the same directory, then rename.
- **CFG-8** No file watcher (explicitly out of scope).
- **CFG-9** Placeholders `{env:VAR_NAME}` and `{file:/path}` are displayed literally and must never be resolved, expanded, or rewritten.
- **CFG-10** Secret handling: sensitive values (at minimum `provider.*.options.apiKey`) are masked in the GUI (`••••••`). An untouched secret field emits no patch — the original value stays in the file. Clearing a secret must be an explicit user action.

## 8. Schema Management & Validation

- **VAL-1** Vendor both schemas into the repo at build time (`scripts/update-schemas.ts` re-downloads them; record the fetch date / opencode version in a comment or small manifest). Runtime must work fully offline.
- **VAL-2** Validate with Ajv (draft 2020-12) on the server before every save, and in the frontend for live feedback.
- **VAL-3** GUI sections: invalid documents **block saving** and show inline field-level errors.
- **VAL-4** Raw editor: validation errors appear as CodeMirror lint markers; saving invalid JSON is allowed only via an explicit "Save anyway" confirmation with a warning.
- **VAL-5** Deprecated keys are hidden from the GUI. Rule: any schema property whose description/metadata marks it as deprecated is not rendered (known examples today: `mode`, `autoshare`, `layout`, `reference`/`references`, `agent.*.tools`). They still round-trip untouched in raw mode.

## 9. UI Specification

English UI. Clean, dense, developer-oriented. Dark theme default. Tab bar across the top:

`General · Providers · Agents · MCP · Permissions · Formatter & LSP · TUI · Misc · Raw`

One global **Save** button (visible dirty-state badge per document); saving writes all dirty documents (each with its own backup). Warn on page unload with unsaved changes. A toggle or sub-tabs separates **opencode.json** vs **tui.json** content (TUI section + Raw tab need a file switcher).

### 9.1 Sync model (core requirement)

- One canonical document state per file. The raw editor and the GUI are two views onto it.
- Switching GUI → Raw: raw shows the current state serialized immediately.
- Switching Raw → GUI with invalid JSON: blocked; show the parse/validation errors and stay in raw.
- A GUI edit produces a path-based patch applied to the document (not a full re-serialization), so comments survive.

### 9.2 Raw editor

CodeMirror 6 with JSONC language support, schema-driven lint markers, error list panel, "Save anyway" escape hatch (VAL-4).

### 9.3 Sections (GUI forms)

Forms are generated from the vendored schemas where sensible, with hand-built widgets for the complex areas below. Every control shows the schema description as help text.

**General** — `model`, `small_model`, `default_agent`, `username`, `shell`, `logLevel` (enum select), `autoupdate` (boolean/"notify"), `share` (enum), `snapshot`, `subagent_depth`, `instructions` (string list), `skills`, `plugin` (string list), `watcher.ignore`, `server` (hostname/port/mdns/cors), `compaction` (auto/prune/summary), `attachment`, `tool_output`.

**Providers** — structured form per provider (see §10 for dropdown data):
- Known option fields as proper controls: `apiKey` (masked, CFG-10), `baseURL`, `timeout`, `chunkTimeout`, `headers` (key-value list), region/project/etc.
- `models.<id>`: full model config — `name`, `cost` (input/output/cache), `limit` (context/output), `options`, `variants`, `reasoning`, `temperature`, `tool_call`, `attachment`, `status` (enum), `headers`.
- Unknown/custom option keys: editable key-value raw list.
- `enabled_providers` / `disabled_providers` as lists.

**Agents** — complete support: both overrides for built-in agents (build, plan, general, explore, title, summary, compaction) and custom agents. Fields per agent: `description`, `mode` (primary/subagent/all), `model`, `variant`, `temperature`, `top_p`, `maxTokens`, `prompt`, `color` (color picker), `steps`, `hidden`, `disable`, `permission` (per-agent overrides). Built-ins are shown as "override" cards; custom agents can be added/removed. (`tools` is deprecated → hidden per VAL-5.)

**MCP** — per server entry:
- `type: local`: `command` (string list), `environment` (key-value), `enabled`, `timeout`.
- `type: remote`: `url`, `headers` (key-value), `oauth` (boolean or object), `enabled`, `timeout`.
- Type switcher when creating a new entry.

**Permissions** — `permission.*`: each capability (`read`, `edit`, `bash`, `glob`, `grep`, `list`, `task`, `skill`, `lsp`, `webfetch`, `websearch`, `codesearch`, `todoread`, `todowrite`, `question`, `external_directory`, `doom_loop`) gets an ask/allow/deny control; capabilities that support pattern rules (`bash`, `edit`, `read`, `external_directory`) get a pattern list editor (pattern → decision). `tools.*` boolean map lives here too ("Permissions & Tools").

**Formatter & LSP** — global `formatter`/`lsp` booleans plus per-tool overrides: each entry is either a boolean or an object (`disabled`, `command`, `extensions`, `env`) — render a boolean toggle that expands into the object form.

**TUI** — `theme` (text with known-theme suggestions if available), `leader_timeout`, `scroll_speed` (min 1), `scroll_acceleration`, `diff_style` (enum: auto/stacked/split), `cursor`, `mouse`, `attention` (pattern/notification/command). **Keybinds:** v1 shows an info box "Keybindings can only be edited in the Raw tab" — the full visual keybind editor is explicitly backlog (§12).

**Misc / Experimental** — `enterprise.url`, `experimental.*` (collapsible group of toggles/inputs per schema).

## 10. Provider & Model Metadata (models.dev)

- **META-1** On startup, fetch `https://models.dev/api.json` (5 s timeout, non-blocking). Cache in memory for the process lifetime.
- **META-2** Use it to offer searchable dropdowns: known providers (with id, name, npm package, env-var hint) and, per provider, known models with metadata display (context limit, cost) when a model is selected.
- **META-3** Free text must always remain possible (custom providers/models).
- **META-4** If the fetch fails (offline): silently fall back to free-text entry; show a subtle "provider catalog unavailable" hint. Never block startup or editing.

## 11. Non-Functional Requirements

- Small and fast: cold start < 1 s locally; production frontend bundle served by the same Bun process (no separate dev server needed at runtime).
- Fully offline-capable except the optional models.dev catalog.
- No telemetry, no external calls beyond models.dev and the build-time schema fetch.
- Works on macOS and Linux (primary dev targets for opencode users); honor `XDG_CONFIG_HOME` when resolving `~/.config` if set, falling back to `~/.config`.

## 12. Out of Scope (v1) / Backlog

Explicitly **not** in v1:

- Editing markdown-based definitions (`agents/`, `commands/`, `plugins/` directories)
- Visual keybind editor for `tui.json` (raw-only in v1) — **top backlog item**
- File watcher / external-change detection
- Project-level configs, env-var config layers, managed/remote configs
- npm packaging / `bunx opencode-knobs` distribution
- Multi-language UI

## 13. Testing Requirements

- **TEST-1** Unit tests (`bun test`) for the config pipeline: JSONC round-trip preserves comments/formatting/placeholders; path-based patching only touches the edited path; backup creation + rotation to 5; create-on-first-save includes `$schema`; validation blocks/allows per VAL-3/VAL-4; secret masking emits no patch for untouched secrets.
- **TEST-2** Unit tests for auth: code alphabet/length, constant-time compare, rate-limit lockout, session invalidation on restart.
- **TEST-3** One e2e smoke test: start server on a random port → read code from stdout → log in → GET config → PUT a change → verify file + backup on disk.

## 14. Acceptance Criteria

1. `bun run start` prints URL + one-time code, opens the browser, login works, wrong codes get rate-limited.
2. An `opencode.json` with comments and `{env:…}` placeholders: edit one value in the GUI, save → file diff shows exactly that one change; comments and placeholders untouched; a `*.bak-*` backup exists.
3. Schema-invalid change in the GUI cannot be saved; same change in Raw requires "Save anyway".
4. A provider `apiKey` is shown masked and is not rewritten when other provider fields are edited.
5. `tui.json` is editable in the TUI section and in Raw; keybinds show the raw-only info box.
6. Offline mode: app starts, models.dev hint appears, everything still editable/saveable.
7. With `--idle-timeout 1` and no requests, the server shuts down after ~1 minute.
8. All tests in §13 pass.
