import { spawn } from "node:child_process";
import { createApp } from "./app";
import { generateCode, initAuth } from "./auth";
import { startModelsFetch } from "./models";

export function parseFlags(argv: string[]): { host: string; port: number; idleTimeout: number } {
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
  if (!Number.isInteger(flags.port) || flags.port < 0 || flags.port > 65535) {
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
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
    child.unref();
    child.on("error", () => {});
  } catch {
    // headless environment — ignore
  }
}

if (import.meta.main) {
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

  const appOpts = { host, port, onAuthenticatedRequest: armIdleTimer };
  const app = createApp(appOpts);

  armIdleTimer();
  startModelsFetch();

  const server = Bun.serve({ hostname: host, port, fetch: app.fetch });
  appOpts.port = server.port;

  const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.port}`;
  console.log("");
  console.log("  opencode-knobs");
  console.log(`  URL:          ${url}`);
  if (host === "0.0.0.0") console.log(`  LAN:          http://<this-machine-ip>:${server.port}`);
  console.log(`  Login code:   ${code}`);
  console.log(`  Idle timeout: ${idleTimeout === 0 ? "disabled" : `${idleTimeout} minute(s)`}`);
  console.log("");

  openBrowser(url);
}
