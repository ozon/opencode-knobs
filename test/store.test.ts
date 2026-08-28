import { describe, expect, test, mock, beforeEach } from "bun:test";
import { DocStore } from "../src/web/state/doc-store";

function createStore(id: "config" | "tui" = "config") {
  return new DocStore(id);
}

describe("DocStore", () => {
  test("constructor sets id", () => {
    const store = createStore("config");
    expect(store.id).toBe("config");
    expect(store.raw).toBe("");
    expect(store.json).toBeNull();
    expect(store.exists).toBe(false);
    expect(store.dirty).toBe(false);
    expect(store.parseErrors).toEqual([]);
    expect(store.schemaErrors).toEqual([]);
    expect(store.loaded).toBe(false);
  });

  test("setText parses valid JSON", () => {
    const store = createStore();
    store.setText('{ "a": 1 }');
    expect(store.json).toEqual({ a: 1 });
    expect(store.parseErrors).toEqual([]);
    expect(store.dirty).toBe(true);
  });

  test("setText sets parseErrors for invalid JSON", () => {
    const store = createStore();
    store.setText("{ invalid }");
    expect(store.parseErrors.length).toBeGreaterThan(0);
    expect(store.parseErrors[0].source).toBe("parse");
    expect(store.dirty).toBe(true);
  });

  test("setText with dirty:false does not set dirty", () => {
    const store = createStore();
    store.setText('{ "a": 1 }', { dirty: false });
    expect(store.dirty).toBe(false);
  });

  test("setText parses JSONC with comments", () => {
    const store = createStore();
    store.setText('{ "a": 1, // comment\n}');
    expect(store.json).toEqual({ a: 1 });
    expect(store.parseErrors).toEqual([]);
  });

  test("setText parses JSONC with trailing comma", () => {
    const store = createStore();
    store.setText('{ "a": 1, }');
    expect(store.json).toEqual({ a: 1 });
    expect(store.parseErrors).toEqual([]);
  });

  test("valid returns true when no errors", () => {
    const store = createStore();
    store.setText('{ "a": 1 }');
    expect(store.valid).toBe(true);
  });

  test("valid returns false when parse errors", () => {
    const store = createStore();
    store.setText("{ bad }");
    expect(store.valid).toBe(false);
  });

  test("allErrors combines parseErrors and schemaErrors", () => {
    const store = createStore();
    store.parseErrors = [{ path: "/a", message: "parse err", source: "parse" }];
    store.schemaErrors = [{ path: "/b", message: "schema err", source: "schema" }];
    expect(store.allErrors).toHaveLength(2);
    expect(store.allErrors[0].source).toBe("parse");
    expect(store.allErrors[1].source).toBe("schema");
  });

  test("patch applies a value", () => {
    const store = createStore();
    store.setText('{ "a": 1 }');
    store.patch(["a"], 2);
    expect(store.json).toEqual({ a: 2 });
  });

  test("patch creates missing parent objects", () => {
    const store = createStore();
    store.setText('{ "a": 1 }');
    store.patch(["b", "c"], "d");
    expect(store.json).toEqual({ a: 1, b: { c: "d" } });
  });

  test("patch on empty raw creates empty object", () => {
    const store = createStore();
    store.raw = "";
    store.patch(["x"], 1);
    expect(store.json).toEqual({ x: 1 });
  });

  test("patch sets dirty", () => {
    const store = createStore();
    store.setText('{ "a": 1 }', { dirty: false });
    expect(store.dirty).toBe(false);
    store.patch(["a"], 2);
    expect(store.dirty).toBe(true);
  });

  test("save returns ok:true when not dirty", async () => {
    const store = createStore();
    store.setText('{ "a": 1 }', { dirty: false });
    const result = await store.save();
    expect(result.ok).toBe(true);
  });

  test("save returns 422 when invalid and not force", async () => {
    const store = createStore();
    store.parseErrors = [{ path: "", message: "bad", source: "parse" }];
    store.dirty = true;
    const result = await store.save();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
  });
});
