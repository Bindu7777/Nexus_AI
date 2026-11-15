// Maps a connector EvidenceItem onto the engine's EvidenceRecord so it can be
// stored and cited beside the demo evidence. The item is kept whole in body.
import type { EvidenceRecord, EvidenceType } from "../src/lib/types";
import type { EvidenceItem } from "./types";

export function evidenceTypeOf(item: EvidenceItem): EvidenceType {
  const ref = item.ref;
  if (item.kind === "database") return "schema";
  if (item.kind === "tickets") return "ticket";
  if (item.kind === "docs") return "doc";
  if (item.kind === "logs") return "log";
  if (/^github:(commit):/.test(ref)) return "commit";
  if (/^github:(diff|prdiff):/.test(ref)) return "diff";
  if (/^github:(pr|issue):/.test(ref)) return "issue";
  if (/^catalog:trace:/.test(ref)) return "trace";
  if (/^catalog:log:/.test(ref)) return "log";
  return "source";
}

export function evidenceRecordId(runId: string, item: EvidenceItem) {
  return `ext:${runId}:${item.ref}`;
}

export function evidenceItemToRecord(item: EvidenceItem, runId: string): EvidenceRecord {
  return {
    id: evidenceRecordId(runId, item),
    runId,
    type: evidenceTypeOf(item),
    title: item.title,
    origin: "connector",
    createdAt: item.retrievedAt,
    body: {
      ...item,
      // Same top-level shape the engine reads for source citations.
      path: item.location?.path,
      startLine: item.location?.startLine,
      endLine: item.location?.endLine,
    },
  };
}
