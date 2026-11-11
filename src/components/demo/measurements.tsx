import { delta, ms, plain } from "@/components/demo/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Summary } from "@/lib/types";

type Row = {
  label: string;
  baseline: string;
  incident: string;
  difference: string;
  validation: string;
  baselineValue: number | null;
  incidentValue: number | null;
  validationValue: number | null;
  unit: string;
};

function rows(baseline: Summary | null, incident: Summary | null, validation: Summary | null): Row[] {
  const pair = (
    label: string,
    read: (summary: Summary | null) => number | null,
    render: (value: number | null) => string,
    unit: string,
  ): Row => {
    const baselineValue = read(baseline);
    const incidentValue = read(incident);
    const validationValue = read(validation);
    return {
      label,
      baseline: render(baselineValue),
      incident: render(incidentValue),
      difference: delta(incidentValue, baselineValue, unit),
      validation: render(validationValue),
      baselineValue,
      incidentValue,
      validationValue,
      unit,
    };
  };

  return [
    pair("Requests", (summary) => summary?.requests ?? null, plain, ""),
    pair("Succeeded", (summary) => summary?.success ?? null, plain, ""),
    pair("Errors", (summary) => summary?.errors ?? null, plain, ""),
    pair("Timeouts", (summary) => summary?.timeouts ?? null, plain, ""),
    pair("Client latency p50", (summary) => summary?.latencyMs?.p50 ?? null, ms, "ms"),
    pair("Client latency p95", (summary) => summary?.latencyMs?.p95 ?? null, ms, "ms"),
    pair("Client latency max", (summary) => summary?.latencyMs?.max ?? null, ms, "ms"),
    pair("Lock wait mean", (summary) => summary?.lockWaitMs?.mean ?? null, ms, "ms"),
    pair("Lock wait p95", (summary) => summary?.lockWaitMs?.p95 ?? null, ms, "ms"),
    pair("Lock hold mean", (summary) => summary?.lockHoldMs?.mean ?? null, ms, "ms"),
    pair("Max lock waiters", (summary) => summary?.maxQueueDepth ?? null, plain, "waiters"),
  ];
}

function Bar({ value, max, className }: { value: number | null; max: number; className: string }) {
  const width = value == null || max <= 0 ? 0 : Math.max(2, Math.min(100, (value / max) * 100));
  return (
    <div className="h-2 rounded-full bg-[#eadfce]">
      <div className={`h-2 rounded-full ${className}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function Measurements({
  baseline,
  incident,
  validation,
}: {
  baseline: Summary | null;
  incident: Summary | null;
  validation: Summary | null;
}) {
  const tableRows = rows(baseline, incident, validation);
  const meters = tableRows.filter((row) => row.label === "Client latency p95" || row.label === "Lock wait mean");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {meters.map((row) => {
          const max = Math.max(row.baselineValue ?? 0, row.incidentValue ?? 0, row.validationValue ?? 0, 1);
          return (
            <div key={row.label} className="rounded-lg border border-border bg-[#fbf7f0] p-3">
              <div className="text-sm font-medium">{row.label}</div>
              <div className="mt-3 space-y-2 text-xs">
                <div>
                  <div className="mb-1 flex justify-between font-mono text-[#5c5348]">
                    <span>Baseline</span>
                    <span>{row.baseline}</span>
                  </div>
                  <Bar value={row.baselineValue} max={max} className="bg-[#1e6b45]" />
                </div>
                <div>
                  <div className="mb-1 flex justify-between font-mono text-[#5c5348]">
                    <span>Incident</span>
                    <span>{row.incident}</span>
                  </div>
                  <Bar value={row.incidentValue} max={max} className="bg-[#9f2d2d]" />
                </div>
                {validation ? (
                  <div>
                    <div className="mb-1 flex justify-between font-mono text-[#5c5348]">
                      <span>Remediated sandbox</span>
                      <span>{row.validation}</span>
                    </div>
                    <Bar value={row.validationValue} max={max} className="bg-[#b8612f]" />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Measurement</TableHead>
            <TableHead>Baseline</TableHead>
            <TableHead>Incident</TableHead>
            <TableHead>Incident − baseline</TableHead>
            {validation ? <TableHead>Remediated sandbox</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tableRows.map((row) => (
            <TableRow key={row.label}>
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell className="font-mono text-xs">{row.baseline}</TableCell>
              <TableCell className="font-mono text-xs">{row.incident}</TableCell>
              <TableCell className="font-mono text-xs">{row.difference}</TableCell>
              {validation ? <TableCell className="font-mono text-xs">{row.validation}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Client latency is measured by the load runner around each HTTP call. Lock wait, lock hold, and waiter counts are
        measured inside the catalog process and returned on the response. Differences are incident minus baseline for
        this run only.
      </p>
    </div>
  );
}

export function OutageMeasurements({ summary }: { summary: Summary }) {
  const items = [
    ["Requests", plain(summary.requests)],
    ["Succeeded", plain(summary.success)],
    ["Errors", plain(summary.errors)],
    ["Timeouts", plain(summary.timeouts)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-[#fbf7f0] px-3 py-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="font-mono text-lg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
