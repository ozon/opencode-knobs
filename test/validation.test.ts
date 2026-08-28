import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app";
import { initAuth, createSession } from "../src/server/auth";
import { configDir, docPath } from "../src/server/config";

const VALID = '{\n  "model": "anthropic/claude-sonnet-4-5"\n}\n';

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
