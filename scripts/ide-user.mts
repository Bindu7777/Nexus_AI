// Pilot sign-in users for the Nexus MCP server in HTTP mode.
//   npm run ide:user -- add <login> <company-id> [display name]   (asks for the password)
//   npm run ide:user -- revoke <login>                             (signs the user out everywhere)
// The password is read from the terminal without echo, never from an argument.
import { stdin, stdout } from "node:process";
import { PilotAuth } from "../src/ide/http/pilot-auth.ts";
import { IdeStore } from "../src/ide/store.ts";
import { httpConfigFromEnv } from "../services/mcp/ide-http.ts";

async function askHidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  if (!stdin.isTTY) {
    let data = "";
    for await (const chunk of stdin) data += chunk;
    return data.split(/\r?\n/)[0];
  }
  stdin.setRawMode(true);
  stdin.resume();
  let value = "";
  return new Promise((resolve) => {
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const [cmd, login, company, ...label] = process.argv.slice(2);
const cfg = httpConfigFromEnv();
const auth = new PilotAuth(new IdeStore().db, `${cfg.publicUrl.replace(/\/$/, "")}/mcp`);

if (cmd === "add" && login && company) {
  const password = await askHidden(`Password for ${login}: `);
  const again = await askHidden("Again: ");
  if (password !== again) {
    console.error("The passwords do not match.");
    process.exit(1);
  }
  try {
    const u = await auth.addUser({ login, companyId: company, label: label.join(" ") || undefined, password });
    console.log(`Saved pilot user ${u.login} for company ${u.companyId}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
} else if (cmd === "revoke" && login) {
  auth.revokeLogin(login);
  console.log(`Signed ${login} out of every session.`);
} else {
  console.error("Usage: npm run ide:user -- add <login> <company-id> [display name]\n       npm run ide:user -- revoke <login>");
  process.exit(2);
}
