// Pure functions that turn a ConnectorDefinition into a form and validate what
// the admin typed. Shared by the API (server) and the onboarding screens
// (client), so no screen has per-tool code.
import { type ConnectorDefinition, type Deployment, type FieldDef, type FieldValue, READ_ONLY_REMINDER, type Values } from "./types";

/** Fields that appear for a deployment, including the self-hosted base URL and CA certificate. */
export function connectionFields(def: ConnectorDefinition, deployment: Deployment): FieldDef[] {
  const extra: FieldDef[] = [];
  if (deployment === "self-hosted") {
    if (def.selfHosted?.baseUrl !== false) {
      extra.push({
        name: "baseUrl",
        label: def.selfHosted?.baseUrlLabel ?? "Base URL",
        type: "url",
        required: true,
        placeholder: def.selfHosted?.baseUrlPlaceholder ?? "https://tool.example.internal",
        help: "The address of the self-hosted server, as reachable from the Nexus server.",
      });
    }
    if (def.selfHosted?.caCert !== false) {
      extra.push({
        name: "caCert",
        label: "Custom CA certificate (optional)",
        type: "certificate",
        help: "PEM text. Only needed when the server uses a certificate from your own certificate authority.",
      });
    }
  }
  return [...extra, ...def.fields.filter((f) => !f.deployments || f.deployments.includes(deployment))];
}

export type FormModelField = Omit<FieldDef, "validate"> & { reminder?: string };

/** Serializable form description for the browser. Functions are stripped. */
export function formModel(def: ConnectorDefinition) {
  const strip = (f: FieldDef): FormModelField => {
    const rest: FormModelField = { ...f };
    delete (rest as FieldDef).validate;
    return f.type === "secret" ? { ...rest, reminder: READ_ONLY_REMINDER } : rest;
  };
  return {
    id: def.id,
    category: def.category,
    displayName: def.displayName,
    description: def.description,
    status: def.status,
    tier: def.tier,
    deployments: def.deployments,
    fieldsByDeployment: Object.fromEntries(def.deployments.map((d) => [d, connectionFields(def, d).map(strip)])) as Record<Deployment, FormModelField[]>,
    scopeFields: def.scopeFields.map(strip),
    capabilities: def.capabilities,
    hasSetupHelp: Boolean(def.setupHelp),
  };
}
export type FormModel = ReturnType<typeof formModel>;

function coerce(field: FieldDef, raw: unknown): { value?: FieldValue; error?: string } {
  if (field.type === "checkbox") return { value: raw === true || raw === "true" || raw === "on" };
  if (field.type === "list") {
    const items = (Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[\n,]/)).map((s) => s.trim()).filter(Boolean);
    if (!items.length) {
      if (field.required) return { error: `${field.label} is required.` };
      return { value: Array.isArray(field.defaultValue) ? field.defaultValue : [] };
    }
    if (items.length > 500) return { error: `${field.label} has too many entries.` };
    if (items.some((i) => i.length > 300)) return { error: `An entry in ${field.label} is too long.` };
    return { value: items };
  }
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!text) {
    if (field.required) return { error: `${field.label} is required.` };
    return { value: field.defaultValue ?? "" };
  }
  const max = field.type === "certificate" ? 20_000 : field.type === "secret" ? 8000 : 2000;
  if (text.length > max) return { error: `${field.label} is too long.` };
  switch (field.type) {
    case "number": {
      const n = Number(text);
      if (!Number.isFinite(n) || (field.min != null && n < field.min) || (field.max != null && n > field.max)) {
        return { error: `${field.label} must be a number between ${field.min ?? "-"} and ${field.max ?? "-"}.` };
      }
      return { value: n };
    }
    case "url": {
      try {
        const u = new URL(text);
        if (u.protocol !== "https:" && u.protocol !== "http:") return { error: `${field.label} must start with https:// or http://.` };
        if (u.username || u.password) return { error: `Do not put credentials in ${field.label}. Use the secret field.` };
      } catch {
        return { error: `${field.label} must be a full URL, for example https://example.com.` };
      }
      return { value: text.replace(/\/+$/, "") };
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text) ? { value: text } : { error: `${field.label} must be an email address.` };
    case "select":
      return field.options?.some((o) => o.value === text) ? { value: text } : { error: `Choose a value for ${field.label}.` };
    case "certificate":
      return /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(text)
        ? { value: text }
        : { error: `${field.label} must be PEM text starting with -----BEGIN CERTIFICATE-----.` };
    default:
      return { value: text };
  }
}

export type ValidatedValues = {
  deployment: Deployment;
  config: Values;
  scope: Values;
  /** Secret fields that were filled in. Blank secret fields mean "keep the saved value". */
  secrets: Record<string, string>;
  errors: Record<string, string>;
};

/**
 * Validate submitted values against a definition.
 * `savedSecretFields` lists secret fields that already have a stored value, so
 * a required secret may be left blank on edit.
 */
export function validateValues(
  def: ConnectorDefinition,
  input: { deployment?: unknown; config?: unknown; scope?: unknown },
  savedSecretFields: string[] = [],
): ValidatedValues {
  const errors: Record<string, string> = {};
  const deployment = (typeof input.deployment === "string" ? input.deployment : def.deployments[0]) as Deployment;
  if (!def.deployments.includes(deployment)) errors.deployment = `${def.displayName} supports ${def.deployments.join(" and ")} only.`;
  const rawConfig = (input.config && typeof input.config === "object" ? input.config : {}) as Record<string, unknown>;
  const rawScope = (input.scope && typeof input.scope === "object" ? input.scope : {}) as Record<string, unknown>;
  const config: Values = {};
  const scope: Values = {};
  const secrets: Record<string, string> = {};

  for (const field of connectionFields(def, def.deployments.includes(deployment) ? deployment : def.deployments[0])) {
    if (field.type === "secret") {
      const value = typeof rawConfig[field.name] === "string" ? String(rawConfig[field.name]).trim() : "";
      if (value) {
        if (value.length > 8000) errors[field.name] = `${field.label} is too long.`;
        else secrets[field.name] = value;
      } else if (field.required && !savedSecretFields.includes(field.name)) {
        errors[field.name] = `${field.label} is required.`;
      }
      continue;
    }
    const { value, error } = coerce(field, rawConfig[field.name]);
    if (error) errors[field.name] = error;
    else if (value !== undefined) config[field.name] = value;
  }
  for (const field of def.scopeFields) {
    const { value, error } = coerce(field, rawScope[field.name]);
    if (error) errors[`scope.${field.name}`] = error;
    else if (value !== undefined) scope[field.name] = value;
  }
  // Scope may never be empty: at least one scope field must hold a value.
  const hasScope = def.scopeFields.some((f) => {
    const v = scope[f.name];
    return Array.isArray(v) ? v.length > 0 : v !== "" && v !== false && v != null;
  });
  if (!hasScope) errors.scope = "Choose what Nexus may read. Scope is required, so nothing is read by default.";

  // Per-field custom checks, then cross-field checks.
  const all = { ...config, ...scope };
  for (const field of [...connectionFields(def, deployment), ...def.scopeFields]) {
    if (!field.validate || errors[field.name] || errors[`scope.${field.name}`]) continue;
    const isScope = def.scopeFields.includes(field);
    const value = isScope ? scope[field.name] : config[field.name];
    if (value === undefined) continue;
    const message = field.validate(value, all);
    if (message) errors[isScope ? `scope.${field.name}` : field.name] = message;
  }
  Object.assign(errors, def.validate?.({ config, scope, deployment }) ?? {});
  return { deployment, config, scope, secrets, errors };
}

export const asList = (v: FieldValue | undefined): string[] =>
  Array.isArray(v) ? v : String(v ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
