// Helper for roadmap connectors: a registry entry and form with status
// "planned". The admin shows them as "coming soon". They have no test(), so
// they can be recorded for a customer but never marked Active.
import { allowInternalField, type ConnectorDefinition, defineConnector, type FieldDef } from "./types";

export function plannedConnector(
  def: Omit<ConnectorDefinition, "status" | "capabilities" | "test" | "build" | "targets" | "fields"> & {
    reads: string[];
    fields?: FieldDef[];
    transport?: ConnectorDefinition["capabilities"]["transport"];
  },
): ConnectorDefinition {
  const { reads, transport, fields, ...rest } = def;
  return defineConnector({
    ...rest,
    status: "planned",
    fields: [...(fields ?? []), ...(rest.deployments.includes("self-hosted") ? [allowInternalField] : [])],
    capabilities: { readOnly: true, reads, transport: transport ?? "http" },
  });
}

export const tokenField = (label = "Read-only API token", help?: string): FieldDef => ({
  name: "token",
  label,
  type: "secret",
  required: true,
  help,
});
