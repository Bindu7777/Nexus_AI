// MySQL placeholder behind the shared interface. When implemented it will use a
// read-only account (SELECT and SHOW VIEW grants only), run each operation in
// START TRANSACTION READ ONLY, and read information_schema the same way the
// Postgres connector does.
import { createStubConnector } from "../stub";

export function createMySqlConnector() {
  return createStubConnector({
    id: "mysql",
    kind: "database",
    description: "MySQL schema reader (placeholder).",
    hint: "Use Postgres or Supabase for now.",
  });
}
