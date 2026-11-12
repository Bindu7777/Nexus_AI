import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** Fresh temp database and a fresh secrets key for each test file. */
export function setupTempAdminEnv(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nexus-admin-${name}-`));
  process.env.NEXUS_ADMIN_DB = path.join(dir, "admin.sqlite");
  process.env.NEXUS_SECRETS_KEY = randomBytes(32).toString("base64");
  delete process.env.NEXUS_SECRETS_KEY_PREVIOUS;
  return { dir, dbFile: process.env.NEXUS_ADMIN_DB };
}

/** A password generated at runtime, so no password literal lives in the repo. */
export const runtimePassword = () => `T-${randomBytes(12).toString("base64url")}!9`;
