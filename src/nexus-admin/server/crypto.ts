// AES-256-GCM encryption for stored customer secrets.
//
// Key: NEXUS_SECRETS_KEY (base64 or hex, 32 bytes) or NEXUS_SECRETS_KEY_FILE
// (path to a file holding it), else .data/secrets.key next to the database. For rotation, NEXUS_SECRETS_KEY_PREVIOUS keeps
// the old key readable until `npm run secrets:rotate` re-encrypts everything.
//
// Format: v1.<keyId>.<iv b64>.<tag b64>.<ciphertext b64>
// The additional authenticated data binds a value to its row, so a ciphertext
// copied onto another company or connection fails to decrypt.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class SecretsKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsKeyError";
  }
}

function parseKey(raw: string | undefined, label: string): Buffer | null {
  if (!raw) return null;
  const value = raw.trim();
  let key: Buffer | null = null;
  if (/^[0-9a-f]{64}$/i.test(value)) key = Buffer.from(value, "hex");
  else {
    try {
      key = Buffer.from(value, "base64");
    } catch {
      key = null;
    }
  }
  if (!key || key.length !== 32) {
    throw new SecretsKeyError(`${label} must be 32 bytes, as base64 or 64 hex characters. Run npm run secrets:generate-key.`);
  }
  return key;
}

/** The key file kept next to the admin database: .data/secrets.key by default. */
export function defaultKeyFile() {
  const db = process.env.NEXUS_ADMIN_DB ?? path.join(process.cwd(), ".data", "nexus-admin.sqlite");
  return path.join(path.dirname(db), "secrets.key");
}

function loadCurrentRaw() {
  if (process.env.NEXUS_SECRETS_KEY) return process.env.NEXUS_SECRETS_KEY;
  const file = process.env.NEXUS_SECRETS_KEY_FILE;
  if (file) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      throw new SecretsKeyError(`NEXUS_SECRETS_KEY_FILE points to ${file}, which could not be read.`);
    }
  }
  // Nothing set: use the key that travels with the data folder, if it is there,
  // so a copied project folder opens its saved connectors without extra setup.
  try {
    return fs.readFileSync(defaultKeyFile(), "utf8");
  } catch {
    return undefined;
  }
}

const keyId = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8);

export function secretsKeyConfigured() {
  try {
    return Boolean(parseKey(loadCurrentRaw(), "NEXUS_SECRETS_KEY"));
  } catch {
    return false;
  }
}

function keys() {
  const current = parseKey(loadCurrentRaw(), "NEXUS_SECRETS_KEY");
  if (!current) {
    throw new SecretsKeyError("NEXUS_SECRETS_KEY is not set. Generate one with npm run secrets:generate-key and set it before saving credentials.");
  }
  const previous = parseKey(process.env.NEXUS_SECRETS_KEY_PREVIOUS, "NEXUS_SECRETS_KEY_PREVIOUS");
  const byId = new Map<string, Buffer>([[keyId(current), current]]);
  if (previous) byId.set(keyId(previous), previous);
  return { current, currentId: keyId(current), byId };
}

export function currentKeyVersion() {
  return keys().currentId;
}

export function encryptSecret(plaintext: string, aad: string) {
  const { current, currentId } = keys();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { blob: `v1.${currentId}.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`, keyVersion: currentId };
}

export function decryptSecret(blob: string, aad: string) {
  const parts = blob.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") throw new SecretsKeyError("Stored secret has an unknown format.");
  const [, id, ivB64, tagB64, ctB64] = parts;
  const key = keys().byId.get(id);
  if (!key) throw new SecretsKeyError("Stored secret was encrypted with a key that is not configured. Set NEXUS_SECRETS_KEY_PREVIOUS to the old key.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

export function generateKey() {
  return randomBytes(32).toString("base64");
}
