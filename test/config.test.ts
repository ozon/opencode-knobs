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
    '{\n  // a comment\n  "model": "anthropic/claude-haiku-4-5",\n}\n',
  );
  const doc = loadDoc("config");
  expect(doc.exists).toBe(true);
  expect(doc.json).toEqual({ model: "anthropic/claude-haiku-4-5" });
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
  expect(validateDoc("config", { model: "anthropic/claude-haiku-4-5" })).toEqual([]);
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
