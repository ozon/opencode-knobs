import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;
const MAX_FAILURE_ENTRIES = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

let expectedCode = "";
const sessions = new Map<string, number>();
const failures = new Map<string, { count: number; lockedUntil: number; lastFailure: number }>();
let lastSweep = Date.now();

function sweepFailures() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [ip, entry] of failures) {
    if (entry.lockedUntil !== 0 && entry.lockedUntil < now) failures.delete(ip);
    else if (entry.lockedUntil === 0 && now - entry.lastFailure > LOCKOUT_MS) failures.delete(ip);
  }
  if (failures.size > MAX_FAILURE_ENTRIES) {
    const entries = [...failures.entries()].sort((a, b) => a[1].lockedUntil - b[1].lockedUntil);
    for (let i = 0; i < entries.length - MAX_FAILURE_ENTRIES / 2; i++) {
      failures.delete(entries[i][0]);
    }
  }
}

export function initAuth(code: string): void {
  expectedCode = code;
  sessions.clear();
  failures.clear();
}

export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function verifyCode(input: string): boolean {
  if (expectedCode === "") return false;
  const a = digest(input);
  const b = digest(expectedCode);
  return timingSafeEqual(a, b);
}

export function createSession(): string {
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, Date.now());
  return token;
}

export function hasSession(token: string | undefined): boolean {
  return token !== undefined && sessions.has(token);
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
  sweepFailures();
  const entry = failures.get(ip);
  if (!entry) return { allowed: true };
  if (entry.lockedUntil > Date.now()) {
    return { allowed: false, retryAfterMs: entry.lockedUntil - Date.now() };
  }
  if (entry.lockedUntil !== 0) failures.delete(ip);
  return { allowed: true };
}

export function recordFailure(ip: string): void {
  const entry = failures.get(ip) ?? { count: 0, lockedUntil: 0, lastFailure: 0 };
  entry.count += 1;
  entry.lastFailure = Date.now();
  if (entry.count >= MAX_FAILURES) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  failures.set(ip, entry);
}

export function resetRateLimits(): void {
  failures.clear();
}

export function clearFailures(ip: string): void {
  failures.delete(ip);
}
