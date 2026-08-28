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

  const proc = spawn(
    ["bun", ENTRY, "--idle-timeout", "0", "--port", "0", ...extraArgs],
    {
      env: { ...process.env, XDG_CONFIG_HOME: tmpDir },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  let stdout = "";
  const reader = proc.stdout!.getReader();
  const decoder = new TextDecoder();
  const { code, url } = await new Promise<{ code: string; url: string }>((resolve, reject) => {
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { reject(new Error("server exited before printing URL and code")); return; }
          const chunk = decoder.decode(value, { stream: true });
          stdout += chunk;
          const codeMatch = stdout.match(/Login code:\s+(\S+)/);
          const urlMatch = stdout.match(/URL:\s+(http\S+)/);
          if (codeMatch && urlMatch) {
            resolve({ code: codeMatch[1], url: urlMatch[1] });
            return;
          }
        }
      } catch (e) { reject(e); }
    })();
  });

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

    writeFileSync(join(tmpDir, "opencode", "opencode.json"), '{"$schema":"https://opencode.ai/config.json"}\n', "utf8");

    const getConfig = await apiFetch(url, "/api/config/config", { headers: authed });
    expect(getConfig.status).toBe(200);
    const configBody = await getConfig.json();
    expect(typeof configBody.raw).toBe("string");

    const putRes = await apiFetch(url, "/api/config/config", {
      method: "PUT",
      headers: authed,
      body: JSON.stringify({ raw: '{\n  "model": "anthropic/claude-sonnet-4-5"\n}\n' }),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.valid).toBe(true);
    expect(typeof putBody.backupPath === "string" || putBody.backupPath === undefined).toBe(true);

    const opencodeDir = join(tmpDir, "opencode");
    expect(readFileSync(join(opencodeDir, "opencode.json"), "utf8")).toContain("anthropic/claude-sonnet-4-5");
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
