import { createSupabaseLogsConnector } from "../../../../connectors/logs/supabase";
import { asList } from "../form";
import { type ConnectorContext, defineConnector } from "../types";

const SOURCES = ["edge_logs", "postgres_logs", "function_logs", "function_edge_logs", "auth_logs", "storage_logs", "realtime_logs", "postgrest_logs"];

const connector = (ctx: ConnectorContext) =>
  createSupabaseLogsConnector({
    projectRef: String(ctx.config.projectRef),
    accessToken: ctx.secrets.token,
    sources: asList(ctx.scope.sources),
    fetchImpl: ctx.fetchImpl,
  });

export default defineConnector({
  id: "supabase-logs",
  category: "logs",
  displayName: "Supabase logs",
  description: "Reads Supabase project logs through the Management API. Not yet exercised against a live project.",
  status: "available",
  tier: "now",
  deployments: ["cloud"],
  fields: [
    {
      name: "projectRef",
      label: "Project ref",
      type: "text",
      required: true,
      help: "The id in your project URL.",
      validate: (v) => (/^[a-z0-9]{10,40}$/.test(String(v)) ? null : "The project ref is the lowercase id in your Supabase project URL."),
    },
    { name: "token", label: "Personal access token", type: "secret", required: true, help: "Read access to the project is enough." },
  ],
  scopeFields: [
    {
      name: "sources",
      label: "Log sources",
      type: "list",
      required: true,
      defaultValue: ["edge_logs", "postgres_logs"],
      help: `Any of: ${SOURCES.join(", ")}.`,
      validate: (v) => (asList(v).every((s) => SOURCES.includes(s)) ? null : `Use only: ${SOURCES.join(", ")}.`),
    },
  ],
  capabilities: { readOnly: true, reads: ["log lines"], transport: "http" },
  targets: () => [{ url: "https://api.supabase.com" }],
  test: (ctx) => connector(ctx).test(),
  build: connector,
});
