import { IAlert, ICheck, IClock, IPause, IX } from "./icons";

export function CompanyStatusChip({ status }: { status: string }) {
  switch (status) {
    case "active":
      return <span className="chip chip-ok"><ICheck />Active</span>;
    case "connected":
      return <span className="chip chip-info"><ICheck />Connected</span>;
    case "paused":
      return <span className="chip chip-warn"><IPause />Paused</span>;
    default:
      return <span className="chip chip-neutral"><IClock />Draft</span>;
  }
}

export function ConnectionChip({ status, supported = true }: { status: string; supported?: boolean }) {
  if (status === "ok") return <span className="chip chip-ok"><ICheck />Passing</span>;
  if (status === "failed") return <span className="chip chip-bad"><IX />Needs attention</span>;
  return <span className="chip chip-neutral"><IClock />{supported ? "Not tested" : "Pending"}</span>;
}

export function ResultChip({ result }: { result: string }) {
  if (result === "ok") return <span className="chip chip-ok"><ICheck />OK</span>;
  if (result === "fail") return <span className="chip chip-bad"><IX />Failed</span>;
  if (result === "denied") return <span className="chip chip-warn"><IAlert />Denied</span>;
  return <span className="chip chip-neutral"><IClock />Info</span>;
}

export const fmtTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
};
