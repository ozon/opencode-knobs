import { beforeEach, expect, test } from "bun:test";
import {
  CODE_ALPHABET,
  generateCode,
  initAuth,
  verifyCode,
  createSession,
  hasSession,
  destroySession,
  checkRateLimit,
  recordFailure,
  resetRateLimits,
} from "../src/server/auth";

beforeEach(() => {
  initAuth("TESTCODE");
  resetRateLimits();
});

test("code alphabet excludes ambiguous characters", () => {
  expect(CODE_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  expect(CODE_ALPHABET).not.toContain("0");
  expect(CODE_ALPHABET).not.toContain("O");
  expect(CODE_ALPHABET).not.toContain("1");
  expect(CODE_ALPHABET).not.toContain("I");
});

test("generateCode produces 8 chars from the alphabet", () => {
  for (let i = 0; i < 50; i++) {
    const code = generateCode();
    expect(code.length).toBe(8);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  }
});

test("verifyCode accepts exact match and rejects others", () => {
  expect(verifyCode("TESTCODE")).toBe(true);
  expect(verifyCode("testcode")).toBe(false);
  expect(verifyCode("TESTCOD")).toBe(false);
  expect(verifyCode("TESTCODEX")).toBe(false);
  expect(verifyCode("")).toBe(false);
});

test("session lifecycle", () => {
  const token = createSession();
  expect(token.length).toBeGreaterThanOrEqual(43);
  expect(hasSession(token)).toBe(true);
  expect(hasSession("bogus")).toBe(false);
  expect(hasSession(undefined)).toBe(false);
  destroySession(token);
  expect(hasSession(token)).toBe(false);
});

test("restart invalidates sessions (new initAuth clears store)", () => {
  const token = createSession();
  initAuth("NEWCODE1");
  expect(hasSession(token)).toBe(false);
});

test("rate limit locks out after 5 failures for 30s", () => {
  for (let i = 0; i < 5; i++) {
    expect(checkRateLimit("1.2.3.4").allowed).toBe(true);
    recordFailure("1.2.3.4");
  }
  const blocked = checkRateLimit("1.2.3.4");
  expect(blocked.allowed).toBe(false);
  expect(blocked.retryAfterMs).toBeGreaterThan(0);
  expect(blocked.retryAfterMs).toBeLessThanOrEqual(30_000);
  expect(checkRateLimit("5.6.7.8").allowed).toBe(true);
});

test("rate limit resets after lockout window", () => {
  for (let i = 0; i < 5; i++) recordFailure("9.9.9.9");
  expect(checkRateLimit("9.9.9.9").allowed).toBe(false);
  const realNow = Date.now;
  Date.now = () => realNow() + 31_000;
  try {
    expect(checkRateLimit("9.9.9.9").allowed).toBe(true);
  } finally {
    Date.now = realNow;
  }
});
