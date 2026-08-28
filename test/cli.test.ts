import { expect, test } from "bun:test";
import { parseFlags } from "../src/server/index";

test("parseFlags returns defaults when no args given", () => {
  expect(parseFlags([])).toEqual({ host: "127.0.0.1", port: 4789, idleTimeout: 30 });
});

test("parseFlags --host flag", () => {
  expect(parseFlags(["--host", "0.0.0.0"])).toMatchObject({ host: "0.0.0.0" });
});

test("parseFlags --host= syntax", () => {
  expect(parseFlags(["--host=10.0.0.1"])).toMatchObject({ host: "10.0.0.1" });
});

test("parseFlags --port flag", () => {
  expect(parseFlags(["--port", "8080"])).toMatchObject({ port: 8080 });
});

test("parseFlags --port= syntax", () => {
  expect(parseFlags(["--port=3000"])).toMatchObject({ port: 3000 });
});

test("parseFlags --idle-timeout flag", () => {
  expect(parseFlags(["--idle-timeout", "60"])).toMatchObject({ idleTimeout: 60 });
});

test("parseFlags --idle-timeout= syntax", () => {
  expect(parseFlags(["--idle-timeout=0"])).toMatchObject({ idleTimeout: 0 });
});

test("parseFlags multiple flags combined", () => {
  const result = parseFlags(["--host", "0.0.0.0", "--port", "3000", "--idle-timeout", "10"]);
  expect(result).toEqual({ host: "0.0.0.0", port: 3000, idleTimeout: 10 });
});

test("parseFlags rejects port 0", () => {
  expect(() => parseFlags(["--port", "0"])).toThrow("invalid --port");
});

test("parseFlags rejects negative port", () => {
  expect(() => parseFlags(["--port", "-1"])).toThrow("invalid --port");
});

test("parseFlags rejects port > 65535", () => {
  expect(() => parseFlags(["--port", "99999"])).toThrow("invalid --port");
});

test("parseFlags rejects non-integer port", () => {
  expect(() => parseFlags(["--port", "80.5"])).toThrow("invalid --port");
});

test("parseFlags rejects NaN port", () => {
  expect(() => parseFlags(["--port", "abc"])).toThrow("invalid --port");
});

test("parseFlags rejects negative idle-timeout", () => {
  expect(() => parseFlags(["--idle-timeout", "-5"])).toThrow("invalid --idle-timeout");
});

test("parseFlags accepts zero idle-timeout (disabled)", () => {
  expect(parseFlags(["--idle-timeout", "0"])).toMatchObject({ idleTimeout: 0 });
});
