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
