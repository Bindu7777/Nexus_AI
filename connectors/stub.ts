// Placeholder connectors. They satisfy the interface, declare implemented=false,
// report what is missing from test(), and refuse search() and fetch().
import { type Connector, type ConnectorKind, NotImplementedConnectorError } from "./types";

export function createStubConnector(spec: { id: string; kind: ConnectorKind; description: string; hint?: string }): Connector {
  return {
    id: spec.id,
    kind: spec.kind,
    readOnly: true,
    implemented: false,
    description: spec.description,
    async test() {
      return {
        ok: false,
        reached: [],
        problems: [
          `${spec.id} is a placeholder and is not implemented yet.${spec.hint ? ` ${spec.hint}` : ""}`,
        ],
        warnings: [],
      };
    },
    async search() {
      throw new NotImplementedConnectorError(spec.id);
    },
    async fetch() {
      throw new NotImplementedConnectorError(spec.id);
    },
  };
}
