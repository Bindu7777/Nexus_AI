// A fetch that trusts an extra CA certificate, for self-hosted tools behind a
// company's own certificate authority. Only GET is ever sent through it: the
// connectors pass it to the GET-only client in connectors/http.ts.
import { Agent, fetch as undiciFetch } from "undici";
import type { FetchLike } from "../../../connectors/http";

const agents = new Map<string, Agent>();

export function fetchWithCa(caCert?: string): FetchLike {
  if (!caCert) return (input, init) => fetch(input, init);
  let agent = agents.get(caCert);
  if (!agent) {
    agent = new Agent({ connect: { ca: caCert } });
    agents.set(caCert, agent);
  }
  const dispatcher = agent;
  return (input, init) =>
    undiciFetch(input, { ...(init as Record<string, unknown>), dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}
