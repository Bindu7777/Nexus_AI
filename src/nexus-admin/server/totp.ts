// RFC 6238 time-based one-time codes (SHA-1, 6 digits, 30 s), with node:crypto only.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret: string, counter: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Accepts the current step and one step either side for clock drift. */
export function verifyTotp(secret: string, code: string, now = Date.now()) {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const step = Math.floor(now / 30_000);
  for (const delta of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secret, step + delta));
    if (timingSafeEqual(expected, Buffer.from(clean))) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, label: string) {
  return `otpauth://totp/${encodeURIComponent(`Nexus Admin:${label}`)}?secret=${secret}&issuer=${encodeURIComponent("Nexus Admin")}&digits=6&period=30`;
}
