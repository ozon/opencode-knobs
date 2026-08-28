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
bun run dev
```

This runs `bun --watch src/server/index.ts` and `bunx vite --port 5173` together.
The Vite dev server (port 5173) proxies `/api` to the Bun server (port 4789).

## Testing

```bash
bun test
```

Tests cover:
- Config pipeline: JSONC round-trip, path-based patching, backup rotation, atomic write, force semantics
- Auth: code generation, rate limiting, session management
- Client patch helpers: indentation detection, patch application, pointer resolution
- E2E: spawn server, login, GET, PUT, verify backup on disk
