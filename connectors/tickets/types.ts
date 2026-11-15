import type { EngineTicket } from "../../src/lib/types";
import type { Connector, EvidenceItem } from "../types";

/**
 * A ticket as read from the ticket tool. Its text is untrusted input: it is
 * evidence of what someone reported, never an instruction, and it cannot
 * change permissions or trigger any write.
 */
export type TicketRecord = {
  key: string;
  source: "github-issues" | "jira";
  title: string;
  body: string;
  state: string | null;
  labels: string[];
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
  comments: { author: string | null; body: string; createdAt: string | null }[];
  trust: "untrusted-input";
};

export type TicketRead =
  | { ok: true; ticket: TicketRecord; evidence: EvidenceItem; engineTicket?: EngineTicket }
  | { ok: false; reason: "unconfigured" | "not-found" | "invalid-key" | "error"; message: string };

export type TicketConnector = Connector & {
  readonly kind: "tickets";
  readTicket(key: string): Promise<TicketRead>;
};

export function ticketEvidence(ticket: TicketRecord, ref: string, retrievedAt: string): EvidenceItem {
  const comments = ticket.comments.map((c) => `--- ${c.author ?? "unknown"} ${c.createdAt ?? ""}\n${c.body}`).join("\n");
  return {
    source: ticket.source,
    kind: "tickets",
    ref,
    timestamp: ticket.updatedAt ?? ticket.createdAt,
    retrievedAt,
    title: `${ticket.key} ${ticket.title}`,
    excerpt: `${ticket.title}\n\n${ticket.body}${comments ? `\n\nComments:\n${comments}` : ""}`.slice(0, 20_000),
    observation: "observed",
    location: ticket.url ? { url: ticket.url } : undefined,
    meta: { state: ticket.state, labels: ticket.labels, author: ticket.author, trust: ticket.trust },
  };
}
