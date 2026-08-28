import { describe, expect, test, mock, beforeEach, afterAll } from "bun:test";

// ---- ApiError ----

describe("ApiError", () => {
  test("is an instance of Error", async () => {
    const { ApiError } = await import("../src/web/api");
    const err = new ApiError(401, { error: "unauthorized" });
    expect(err).toBeInstanceOf(Error);
  });

  test("stores status and body", async () => {
    const { ApiError } = await import("../src/web/api");
    const body = { error: "invalid code" };
    const err = new ApiError(401, body);
    expect(err.status).toBe(401);
    expect(err.body).toEqual(body);
    expect(err.message).toBe("API 401");
  });
});

// ---- api object ----

describe("api object", () => {
  test("exports expected methods", async () => {
    const { api } = await import("../src/web/api");
    expect(typeof api.login).toBe("function");
    expect(typeof api.logout).toBe("function");
    expect(typeof api.health).toBe("function");
    expect(typeof api.getConfig).toBe("function");
    expect(typeof api.saveConfig).toBe("function");
    expect(typeof api.getSchema).toBe("function");
    expect(typeof api.getMeta).toBe("function");
  });
});

// ---- request function behaviour (via api methods) ----

describe("api.request", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("api.health calls GET /api/health", async () => {
    const fetchMock = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    globalThis.fetch = fetchMock as any;

    const { api } = await import("../src/web/api");
    const result = await api.health();
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/health");
    expect(init?.method).toBe("GET");
  });

  test("api.login calls POST /api/login with code", async () => {
    const fetchMock = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    globalThis.fetch = fetchMock as any;

    const { api } = await import("../src/web/api");
    const result = await api.login("ABC12345");
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/login");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ code: "ABC12345" });
  });

  test("throws ApiError on non-ok response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "invalid code" }), { status: 401, headers: { "content-type": "application/json" } })),
    ) as any;

    const { api, ApiError } = await import("../src/web/api");
    try {
      await api.login("WRONG");
      expect(true).toBe(false); // should not reach
    } catch (e: any) {
      expect(e).toBeInstanceOf(ApiError);
      expect(e.status).toBe(401);
      expect(e.body).toEqual({ error: "invalid code" });
    }
  });

  test("sets content-type and x-requested-with for POST", async () => {
    const fetchMock = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    globalThis.fetch = fetchMock as any;

    const { api } = await import("../src/web/api");
    await api.logout();
    const [, init] = fetchMock.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-requested-with"]).toBe("fetch");
  });

  test("uses credentials: same-origin", async () => {
    const fetchMock = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    globalThis.fetch = fetchMock as any;

    const { api } = await import("../src/web/api");
    await api.health();
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe("same-origin");
  });
});
