"use client";

import { ms } from "@/components/demo/format";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EvidenceRecord } from "@/lib/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function originLabel(origin: EvidenceRecord["origin"]) {
  return origin === "executed-sandbox" ? "Executed in the sandbox" : "Read from workspace source";
}

function SpanChart({ body }: { body: Record<string, unknown> }) {
  const spans = Array.isArray(body.spans) ? body.spans.filter(isRecord) : [];
  const duration = typeof body.durationMs === "number" ? body.durationMs : 0;
  const total = Math.max(
    duration,
    ...spans.map((span) => {
      const start = typeof span.startOffsetMs === "number" ? span.startOffsetMs : 0;
      const width = typeof span.durationMs === "number" ? span.durationMs : 0;
      return start + width;
    }),
    1,
  );
  const color: Record<string, string> = {
    "GET /products/:id": "bg-[#1b2836]",
    "catalog.lock.wait": "bg-[#b8612f]",
    "catalog.lock.hold": "bg-[#8a5a12]",
    "catalog.read": "bg-[#1e6b45]",
  };

  return (
    <div className="space-y-2">
      {spans.map((span, index) => {
        const name = typeof span.name === "string" ? span.name : "span";
        const start = typeof span.startOffsetMs === "number" ? span.startOffsetMs : 0;
        const width = typeof span.durationMs === "number" ? span.durationMs : 0;
        return (
          <div key={`${name}-${index}`} className="grid grid-cols-1 gap-1 sm:grid-cols-[180px_minmax(0,1fr)_88px] sm:items-center">
            <div className="font-mono text-xs">{name}</div>
            <div className="relative h-3 rounded-full bg-[#eadfce]">
              <div
                className={`absolute h-3 rounded-full ${color[name] ?? "bg-[#1b2836]"}`}
                style={{
                  left: `${(start / total) * 100}%`,
                  width: `${Math.max(1.5, (width / total) * 100)}%`,
                }}
              />
            </div>
            <div className="font-mono text-xs sm:text-right">{ms(width)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function EvidenceDialog({
  open,
  onOpenChange,
  loading,
  error,
  record,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  record: EvidenceRecord | null;
}) {
  const body = record && isRecord(record.body) ? record.body : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="pr-8 font-display text-xl">{record?.title ?? "Evidence record"}</DialogTitle>
          <DialogDescription>
            {record
              ? `${originLabel(record.origin)}. Stored at ${record.createdAt}.`
              : "The record is loaded from this demo session, not from a scripted fixture."}
          </DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm text-muted-foreground">Reading the stored record…</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {record ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{record.type}</Badge>
              <Badge variant="outline">{originLabel(record.origin)}</Badge>
            </div>
            <p className="break-all font-mono text-xs text-muted-foreground">{record.id}</p>
            {record.type === "trace" && body ? <SpanChart body={body} /> : null}
            {record.type === "source" && body && typeof body.excerpt === "string" ? (
              <div>
                <p className="mb-2 text-sm">
                  {String(body.path)} lines {String(body.startLine)}–{String(body.endLine)}
                </p>
                <pre className="max-h-80 overflow-auto rounded-lg bg-[#172230] p-3 text-xs leading-5 text-[#f6f1e7]">
                  {body.excerpt
                    .split("\n")
                    .map((line, index) => {
                      const lineNo = typeof body.startLine === "number" ? body.startLine + index : index + 1;
                      return `${String(lineNo).padStart(4, " ")}  ${line}`;
                    })
                    .join("\n")}
                </pre>
              </div>
            ) : null}
            {record.type === "metric" && body && typeof body.note === "string" ? (
              <p className="text-sm">{body.note}</p>
            ) : null}
            <details className="rounded-lg border border-border bg-[#f8f3ea] p-3">
              <summary className="cursor-pointer text-sm font-medium">Raw stored record</summary>
              <pre className="mt-3 max-h-80 overflow-auto font-mono text-xs leading-5">{JSON.stringify(record, null, 2)}</pre>
            </details>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
