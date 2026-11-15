// Nexus admin command line.
//   npm run admin:create            create the owner (or another admin) account
//   npm run admin:reset-password    reset an admin password when locked out
//   npm run secrets:generate-key    print a new NEXUS_SECRETS_KEY
//   npm run secrets:rotate          re-encrypt stored secrets with the current key
//
// Passwords are typed with hidden input, or read once from
// NEXUS_ADMIN_INITIAL_PASSWORD for automated installs. They are never printed or logged.
import readline from "node:readline";
import { adminCount, createAdmin, resetAdminPassword } from "../src/nexus-admin/server/auth";
import { currentKeyVersion, decryptSecret, encryptSecret, generateKey } from "../src/nexus-admin/server/crypto";
import { reencryptConnectorSecrets } from "../src/nexus-admin/server/connectors";
import { dbPath, getDb } from "../src/nexus-admin/server/db";
import { passwordProblems } from "../src/nexus-admin/server/passwords";

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
      out._writeToOutput = (s: string) => {
        if (s.startsWith(question)) out.output.write(question);
        else if (s === "\r\n" || s === "\n") out.output.write("\n");
        else out.output.write("*".repeat(s.length));
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function choosePassword(loginId: string) {
  const fromEnv = process.env.NEXUS_ADMIN_INITIAL_PASSWORD;
  if (fromEnv) {
    delete process.env.NEXUS_ADMIN_INITIAL_PASSWORD;
    const problems = passwordProblems(fromEnv, loginId);
    if (problems.length) throw new Error(`NEXUS_ADMIN_INITIAL_PASSWORD is not acceptable: ${problems.join(" ")}`);
    return fromEnv;
  }
  if (!process.stdin.isTTY) throw new Error("Run this in a terminal, or set NEXUS_ADMIN_INITIAL_PASSWORD for an automated install.");
  for (;;) {
    const first = await ask("Password (hidden): ", true);
    const problems = passwordProblems(first, loginId);
    if (problems.length) {
      console.log(`That password cannot be used: ${problems.join(" ")}`);
      continue;
    }
    const second = await ask("Type it again: ", true);
    if (first !== second) {
      console.log("The two passwords did not match. Try again.");
      continue;
    }
    return first;
  }
}

async function main() {
  const command = process.argv[2];
  if (command === "generate-key") {
    console.log(generateKey());
    console.log("\nStore this as NEXUS_SECRETS_KEY in your environment or secrets file. Never commit it.");
    return;
  }
  if (command === "rotate") {
    const db = getDb();
    const now = currentKeyVersion();
    let rotated = 0;
    db.transaction(() => {
      rotated = reencryptConnectorSecrets();
      const admins = db.prepare("SELECT id, totp_secret_enc FROM nexus_admins WHERE totp_secret_enc IS NOT NULL").all() as { id: number; totp_secret_enc: string }[];
      for (const a of admins) {
        const aad = `admin:${a.id}:totp`;
        db.prepare("UPDATE nexus_admins SET totp_secret_enc = ? WHERE id = ?").run(encryptSecret(decryptSecret(a.totp_secret_enc, aad), aad).blob, a.id);
      }
    })();
    console.log(`Re-encrypted secrets for ${rotated} connector(s) with key ${now}. You can now remove NEXUS_SECRETS_KEY_PREVIOUS.`);
    return;
  }
  if (command === "create" || command === "reset") {
    console.log(`Nexus admin database: ${dbPath()}`);
    const defaultId = "Hima Bindu";
    const entered = (await ask(`Login ID [${defaultId}]: `)).trim();
    const loginId = entered || defaultId;
    const password = await choosePassword(loginId);
    if (command === "create") {
      await createAdmin(loginId, password);
      console.log(`Created admin "${loginId}". ${adminCount()} admin account(s) exist. Sign in at /nexus-admin/login.`);
    } else {
      await resetAdminPassword(loginId, password);
      console.log(`Password reset for "${loginId}". Existing sessions were signed out.`);
    }
    return;
  }
  console.log("Usage: nexus-admin-cli <create|reset|generate-key|rotate>");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Failed.");
  process.exit(1);
});
