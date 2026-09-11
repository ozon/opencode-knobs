import { describe, expect, test } from "bun:test";
import { applyPatch, detectIndent, pointerToOffset } from "../src/web/state/patch";

describe("detectIndent", () => {
  test("finds leading spaces", () => {
    expect(detectIndent('{\n    "a": 1\n}')).toEqual({ insertSpaces: true, tabSize: 4 });
  });
  test("finds leading tab", () => {
    expect(detectIndent('{\n\t"a": 1\n}')).toEqual({ insertSpaces: false, tabSize: 1 });
  });
  test("defaults to 2 spaces", () => {
    expect(detectIndent('{}')).toEqual({ insertSpaces: true, tabSize: 2 });
  });
});

describe("applyPatch", () => {
  const raw = [
    "{",
    "  // top comment",
    '  "model": "anthropic/claude-2",',
    '  "provider": {',
    '    "anthropic": {',
    '      "options": {',
    '        "apiKey": "{env:ANTHROPIC_API_KEY}"',
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");

  test("edits only the target path, preserves comments and placeholders", () => {
    const out = applyPatch(raw, ["model"], "openai/gpt-4o");
    expect(out).toContain('"model": "openai/gpt-4o"');
    expect(out).toContain("// top comment");
    expect(out).toContain("{env:ANTHROPIC_API_KEY}");
    const a = raw.split("\n"), b = out.split("\n");
    expect(b.length).toBe(a.length);
    const changed = a.filter((l, i) => l !== b[i]);
    expect(changed).toEqual(["  \"model\": \"anthropic/claude-2\","]);
  });

  test("removes key when value is undefined", () => {
    const out = applyPatch(raw, ["model"], undefined);
    expect(out).not.toContain('"model"');
    expect(out).toContain("// top comment");
  });

  test("removes key from single-line object without corrupting braces", () => {
    const out = applyPatch('{"a": 1}', ["a"], undefined);
    expect(JSON.parse(out)).toEqual({});
  });

  test("removes first key from single-line object and fixes commas", () => {
    const out = applyPatch('{"a": 1, "b": 2}', ["a"], undefined);
    expect(JSON.parse(out)).toEqual({ b: 2 });
  });

  test("removes array element via index path", () => {
    const out = applyPatch('{"items": ["x", "y"]}', ["items", 1], undefined);
    expect(JSON.parse(out)).toEqual({ items: ["x"] });
  });

  test("handles nested object addition", () => {
    const src = '{\n  "a": 1\n}';
    const out = applyPatch(src, ["b"], 2);
    expect(out).toContain('"b": 2');
  });

  test("handles array index patch", () => {
    const src = '{\n  "items": [\n    "x",\n    "y"\n  ]\n}';
    const out = applyPatch(src, ["items", 1], "z");
    expect(out).toContain('"z"');
    expect(out).not.toContain('"y"');
  });

  test("creates empty object when patching into missing parent", () => {
    const src = '{\n  "a": 1\n}';
    const out = applyPatch(src, ["b", "c"], "d");
    expect(out).toContain('"b"');
    expect(out).toContain('"c": "d"');
  });

  test("inserts new key into object", () => {
    const src = '{\n  "a": 1\n}';
    const out = applyPatch(src, ["b"], true);
    expect(out).toContain('"b": true');
    expect(out).toContain('"a": 1');
  });
});

describe("pointerToOffset", () => {
  const raw = '{\n  "a": 1,\n  "b": {\n    "c": 3\n  }\n}';
  test("returns 0 for empty pointer", () => {
    expect(pointerToOffset(raw, "")).toBe(0);
  });
  test("finds root-level key", () => {
    const off = pointerToOffset(raw, "/a");
    expect(off).toBeGreaterThanOrEqual(0);
    expect(raw.slice(off, off + 3)).toBe('"a"');
  });
  test("finds nested key", () => {
    const off = pointerToOffset(raw, "/b/c");
    expect(off).toBeGreaterThanOrEqual(0);
    expect(raw.slice(off, off + 3)).toBe('"c"');
  });
  test("returns 0 for nonexistent path", () => {
    expect(pointerToOffset(raw, "/x")).toBe(0);
  });
});
