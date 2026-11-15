// The connector registry. Definitions come from ./defs through the generated
// index (npm run connectors:index), and every one is checked when loaded.
import { DEFINITIONS } from "./index.generated";
import { CATEGORIES, type Category, type ConnectorDefinition } from "./types";

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
/** The only function members a definition may have. None of them writes. */
export const ALLOWED_DEFINITION_FUNCTIONS = new Set(["test", "build", "targets", "validate", "setupHelp"]);

/** Throws a plain message when a definition breaks the contract. */
export function checkDefinition(def: ConnectorDefinition): void {
  const where = `Connector definition "${def?.id ?? "?"}"`;
  if (!def || typeof def !== "object") throw new Error("A connector file must default-export defineConnector({...}).");
  if (!ID.test(def.id)) throw new Error(`${where}: id must be lowercase letters, digits and dashes.`);
  if (!CATEGORY_IDS.has(def.category)) throw new Error(`${where}: unknown category "${def.category}".`);
  if (!def.displayName) throw new Error(`${where}: displayName is required.`);
  if (!def.deployments?.length) throw new Error(`${where}: at least one deployment is required.`);
  if (def.capabilities?.readOnly !== true) throw new Error(`${where}: capabilities.readOnly must be true. Nexus never writes.`);
  if (!def.scopeFields?.length || !def.scopeFields.some((f) => f.required)) {
    throw new Error(`${where}: needs at least one required scope field, so "everything" is never the default.`);
  }
  if (def.status === "available" && typeof def.test !== "function") throw new Error(`${where}: an available connector needs test().`);
  const names = new Set<string>();
  for (const f of [...def.fields, ...def.scopeFields]) {
    if (names.has(f.name)) throw new Error(`${where}: field "${f.name}" is declared twice.`);
    if (f.name === "baseUrl" || f.name === "caCert" || f.name === "scope" || f.name === "deployment") {
      throw new Error(`${where}: field name "${f.name}" is reserved.`);
    }
    names.add(f.name);
  }
  if (def.scopeFields.some((f) => f.type === "secret")) throw new Error(`${where}: scope fields cannot be secrets.`);
  for (const [key, value] of Object.entries(def)) {
    if (typeof value === "function" && !ALLOWED_DEFINITION_FUNCTIONS.has(key)) {
      throw new Error(`${where}: unexpected function "${key}". Definitions may only read.`);
    }
  }
}

export function createRegistry(definitions: ConnectorDefinition[]) {
  const byId = new Map<string, ConnectorDefinition>();
  for (const def of definitions) {
    checkDefinition(def);
    if (byId.has(def.id)) throw new Error(`Two connector definitions use the id "${def.id}".`);
    byId.set(def.id, def);
  }
  const all = [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return {
    all: () => all,
    get: (id: string) => byId.get(id),
    byCategory: (category: Category) => all.filter((d) => d.category === category),
  };
}

export type Registry = ReturnType<typeof createRegistry>;

let current: Registry | null = null;
export function registry(): Registry {
  current ??= createRegistry(DEFINITIONS);
  return current;
}

/** Tests only: use a registry with extra definitions, then pass null to restore. */
export function setRegistryForTests(next: Registry | null) {
  current = next;
}
