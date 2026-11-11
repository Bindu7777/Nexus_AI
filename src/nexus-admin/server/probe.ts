// Proves a database account cannot write through Nexus, without writing.
// Inside a READ ONLY transaction it attempts CREATE TEMP TABLE and expects the
// server to refuse it (SQLSTATE 25006). The transaction is always rolled back.
// It then checks the account's own privileges and warns if it could write.

export type ProbeClient = {
  connect(): Promise<unknown>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<unknown>;
};

export type ProbeResult = {
  writeBlocked: boolean;
  statements: string[];
  warnings: string[];
  error?: string;
};

export async function probePostgresWrite(makeClient: () => Promise<ProbeClient>, schemas: string[]): Promise<ProbeResult> {
  const statements: string[] = [];
  const warnings: string[] = [];
  let client: ProbeClient | null = null;
  try {
    client = await makeClient();
    await client.connect();
    statements.push("BEGIN TRANSACTION READ ONLY");
    await client.query("BEGIN TRANSACTION READ ONLY");
    let writeBlocked = false;
    try {
      statements.push("CREATE TEMP TABLE nexus_write_probe (x int)  -- expected to be refused");
      await client.query("CREATE TEMP TABLE nexus_write_probe (x int)");
    } catch (error) {
      const code = (error as { code?: string }).code;
      writeBlocked = code === "25006" || /read-only transaction/i.test(String((error as Error).message));
    }
    statements.push("ROLLBACK");
    await client.query("ROLLBACK");

    // Privilege check, read-only, outside any write.
    const list = schemas.map((s) => `'${s.replace(/'/g, "''")}'`).join(",") || "'public'";
    const priv = await client.query(
      `SELECT r.rolsuper AS superuser,
              current_setting('default_transaction_read_only') AS default_ro,
              has_database_privilege(current_database(), 'CREATE') AS can_create_schema,
              (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname IN (${list}) AND c.relkind IN ('r','p')
                   AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE') OR has_table_privilege(c.oid, 'DELETE'))) AS writable_tables
       FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const row = priv.rows[0] ?? {};
    if (row.superuser === true) warnings.push("WARNING: this account is a superuser. It can change anything. Use a dedicated read-only role instead.");
    if (Number(row.writable_tables ?? 0) > 0) {
      warnings.push(`WARNING: this account can insert, update or delete in ${row.writable_tables} table(s). Nexus will not write, but use a read-only role.`);
    }
    if (row.can_create_schema === true) warnings.push("WARNING: this account can create schemas in the database. A read-only role should not.");
    if (row.default_ro !== "on") warnings.push("The account's default transactions are not read-only. Run: ALTER ROLE <user> SET default_transaction_read_only = on;");
    return { writeBlocked, statements, warnings };
  } catch (error) {
    return { writeBlocked: false, statements, warnings, error: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      await client?.end();
    } catch {
      /* ignore */
    }
  }
}
