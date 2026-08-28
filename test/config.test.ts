import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDir, docPath, loadDoc, validateDoc } from "../src/server/config";

import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { saveDoc, createBackup, rotateBackups } from "../src/server/config";

const VALID_CONFIG = '{\n  "model": "anthropic/claude-haiku-4-5"\n}\n';

test("saveDoc writes valid doc and creates parent dirs", () => {
  const result = saveDoc("config", VALID_CONFIG, false);
  expect(result.status).toBe("ok");
  expect(readFileSync(docPath("config"), "utf8")).toBe(VALID_CONFIG);
});

test("saveDoc writes received raw text verbatim (no reformat)", () => {
  const odd = '{\n      "model":   "anthropic/claude-haiku-4-5" ,  "snapshot": false\n   }\n';
  const result = saveDoc("config", odd, false);
  expect(result.status).toBe("ok");
  expect(readFileSync(docPath("config"), "utf8")).toBe(odd);
});

test("saveDoc rejects syntax errors even with force (HTTP 400 case)", () => {
  const result = saveDoc("config", '{\n  "model": \n}\n', true);
  expect(result.status).toBe("syntax");
  expect(existsSync(docPath("config"))).toBe(false);
});

test("saveDoc rejects schema-invalid without force (HTTP 422 case)", () => {
  const result = saveDoc("config", '{\n  "not_a_real_key": 1\n}\n', false);
  expect(result.status).toBe("schema");
  if (result.status === "schema") expect(result.errors.length).toBeGreaterThan(0);
  expect(existsSync(docPath("config"))).toBe(false);
});

test("saveDoc writes schema-invalid with force and backs up existing file", () => {
  saveDoc("config", VALID_CONFIG, false);
  const result = saveDoc("config", '{\n  "not_a_real_key": 1\n}\n', true);
  expect(result.status).toBe("ok");
  if (result.status === "ok") expect(result.backupPath).toContain(".bak-");
  const backups = readdirSync(configDir()).filter((f) => f.includes(".bak-"));
  expect(backups.length).toBe(1);
  expect(readFileSync(docPath("config"), "utf8")).toContain("not_a_real_key");
});

test("createBackup names file with timestamp and rotateBackups keeps newest 5", () => {
  mkdirSync(configDir(), { recursive: true });
  const p = docPath("config");
  writeFileSync(p, "{}");
  for (let i = 1; i <= 7; i++) {
    copyFileSync(p, `${p}.bak-2026010${i}-000000`);
  }
  rotateBackups(p, 5);
  const remaining = readdirSync(configDir()).filter((f) => f.includes(".bak-")).sort();
  expect(remaining.length).toBe(5);
  expect(remaining).not.toContain("opencode.json.bak-20260101-000000");
  expect(remaining).not.toContain("opencode.json.bak-20260102-000000");
  const backupPath = createBackup(p);
  expect(backupPath).toMatch(/opencode\.json\.bak-\d{8}-\d{6}$/);
});

test("saveDoc round-trip preserves comments and placeholders outside edited path", () => {
  mkdirSync(configDir(), { recursive: true });
  const original = [
    "{",
    "  // keep me",
    '  "model": "anthropic/claude-haiku-4-5",',
    '  "provider": {',
    '    "anthropic": { "options": { "apiKey": "{env:ANTHROPIC_API_KEY}" } }',
    "  }",
    "}",
  ].join("\n");
  writeFileSync(docPath("config"), original);
  const doc = loadDoc("config");
  expect(doc.valid).toBe(true);
  const result = saveDoc("config", doc.raw, false);
  expect(result.status).toBe("ok");
  expect(readFileSync(docPath("config"), "utf8")).toBe(original);
});

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
