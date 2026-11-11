import { hash, verify } from "@node-rs/argon2";
import { randomInt } from "node:crypto";

// OWASP-recommended Argon2id parameters: 19 MiB memory, 2 iterations, 1 lane.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const hashPassword = (password: string) => hash(password, ARGON);

export async function verifyPassword(stored: string, password: string) {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// A dummy hash so failed lookups take the same time as real ones.
let dummy: string | null = null;
export async function burnVerifyTime(password: string) {
  dummy ??= await hashPassword("nexus-timing-equaliser-value");
  await verifyPassword(dummy, password);
}

const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "123456789012", "1234567890123", "qwertyuiop12", "qwerty123456",
  "iloveyou1234", "letmein12345", "welcome12345", "admin1234567", "administrator", "changeme1234", "abcdefghijkl",
  "abc123456789", "111111111111", "000000000000", "nexusadmin123", "nexus1234567", "trustno1trustno1", "baseball1234",
  "football1234", "superman1234", "monkey123456", "dragon123456", "sunshine1234", "princess1234", "p@ssw0rd1234",
]);

export const normaliseLoginId = (id: string) => id.trim().replace(/\s+/g, " ").toLowerCase();

/** Returns plain-language reasons; empty when the password is acceptable. */
export function passwordProblems(password: string, loginId: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) problems.push("Use at least 12 characters.");
  if (password.length > 256) problems.push("Use at most 256 characters.");
  const lower = password.toLowerCase();
  const id = normaliseLoginId(loginId);
  if (id && (lower === id || lower.replace(/\s+/g, "") === id.replace(/\s+/g, ""))) problems.push("Do not use your login ID as the password.");
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) problems.push("This password is too common or too simple. Choose something less predictable.");
  return problems;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const SYMBOLS = "!@#$%*-_+=?";

/** Strong temporary password: 16 characters, at least one symbol and one digit. */
export function generateTemporaryPassword() {
  const chars = Array.from({ length: 14 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  chars.push(SYMBOLS[randomInt(SYMBOLS.length)], String(randomInt(2, 10)));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
