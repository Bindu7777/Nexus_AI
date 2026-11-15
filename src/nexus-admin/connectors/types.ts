// Connector registry types.
//
// Each tool Nexus can read from is described by ONE file in ./defs that
// default-exports a ConnectorDefinition. The admin screens, the API and the
// test runner are all driven by these definitions, so adding a tool is adding
// one file. See docs/adding-a-connector.md.
import type { FetchLike } from "../../../connectors/http";
import type { Connector, ConnectorTestResult } from "../../../connectors/types";

export const CATEGORIES = [
  { id: "code", title: "Code", blurb: "Where the company's code lives." },
  { id: "defects", title: "Defects", blurb: "Where defects are reported. Nexus reads tickets only." },
  { id: "docs", title: "Documentation", blurb: "The material that explains the application." },
  { id: "database", title: "Database", blurb: "Schema and migration metadata, through a read-only role." },
  { id: "logs", title: "Logs", blurb: "Where the application writes logs." },
  { id: "tests", title: "Tests", blurb: "Test cases and results." },
  { id: "design", title: "Design", blurb: "Designs and diagrams that explain intended behaviour." },
  { id: "services", title: "Service under test", blurb: "A staging or sandbox service Nexus may send limited load to." },
] as const;
export type Category = (typeof CATEGORIES)[number]["id"];

export type Deployment = "cloud" | "self-hosted";

export type FieldType = "text" | "secret" | "url" | "list" | "select" | "number" | "checkbox" | "email" | "certificate";

export type FieldValue = string | number | boolean | string[];
export type Values = Record<string, FieldValue>;

export type FieldDef = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  defaultValue?: FieldValue;
  min?: number;
  max?: number;
  /** Only shown for these deployments. Default: all. */
  deployments?: Deployment[];
  /** Extra check. Return a plain message, or null when the value is fine. */
  validate?: (value: FieldValue, all: Values) => string | null;
};

export type BuildStatus = "available" | "planned";
/** Roadmap tier from the build plan: now, next, or only when a customer asks. */
export type Tier = "now" | "next" | "on-request";

/** Everything a definition's test()/build() receives. Secrets are decrypted server-side only. */
export type ConnectorContext = {
  deployment: Deployment;
  config: Values;
  scope: Values;
  secrets: Record<string, string>;
  /** Self-hosted base URL, when the deployment has one. */
  baseUrl?: string;
  /** PEM text of a custom CA for self-hosted targets. */
  caCert?: string;
  /** GET-capable fetch that trusts caCert when set. Pass it to connectors. */
  fetchImpl: FetchLike;
  /** A secret from another of this company's connectors, e.g. reuse the GitHub token. */
  siblingSecret(registryId: string, field: string): string | undefined;
};

export type ConnectorDefinition = {
  id: string;
  category: Category;
  displayName: string;
  description: string;
  status: BuildStatus;
  tier: Tier;
  /**
   * Supported deployments. Self-hosted adds a base URL and an optional custom
   * CA certificate unless the definition opts out (for example a database,
   * whose host is already a field).
   */
  deployments: Deployment[];
  selfHosted?: { baseUrl?: boolean; caCert?: boolean; baseUrlLabel?: string; baseUrlPlaceholder?: string };
  /** Connection fields. Secret fields have type "secret" and are write-only. */
  fields: FieldDef[];
  /** What Nexus may read. At least one is required, so "everything" is never the default. */
  scopeFields: FieldDef[];
  capabilities: {
    readOnly: true;
    reads: string[];
    /** How the runner proves read-only: http (GET-only client), database (refused write), files (no write path). */
    transport: "http" | "database" | "files" | "none";
  };
  /** Shown beside the form, for example SQL that creates a read-only role. */
  setupHelp?: (values: Values) => string;
  /** Hosts or URLs the test will contact, checked against private and metadata addresses first. */
  targets?: (ctx: ConnectorContext) => { url?: string; host?: string }[];
  /** Read-only connection check. Required when status is "available". */
  test?: (ctx: ConnectorContext) => Promise<ConnectorTestResult & { readOnlyProof?: string[] }>;
  /** The read-only connector the engine uses for evidence. */
  build?: (ctx: ConnectorContext) => Connector;
  /** Cross-field checks after per-field validation. */
  validate?: (values: { config: Values; scope: Values; deployment: Deployment }) => Record<string, string>;
};

export function defineConnector(def: ConnectorDefinition): ConnectorDefinition {
  return def;
}

/** Shared field: allow a private address (customer network) for this connector's test. */
export const allowInternalField: FieldDef = {
  name: "allowInternal",
  label: "This target is inside the customer's network (allow a private address)",
  type: "checkbox",
  defaultValue: false,
  help: "Tests refuse private, loopback and cloud-metadata addresses unless you tick this.",
};

export const READ_ONLY_REMINDER = "Use a read-only account or token.";
