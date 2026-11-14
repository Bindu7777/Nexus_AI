// npm run ide:user -- add <login> <company-id> [display name]   (asks for the password)
// npm run ide:user -- revoke <login>
import { runUserCommand } from "../services/mcp/ide-user-cli.ts";

process.exitCode = await runUserCommand(process.argv.slice(2));
