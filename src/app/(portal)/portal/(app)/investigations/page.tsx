import Link from "next/link";
import { VERDICTS } from "@/investigation/types";
import { listForCaller } from "@/portal/server/investigations";
import { requirePortalPage } from "@/portal/server/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "My investigations" };

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function InvestigationsPage({ searchParams }: { searchParams: Promise<{ verdict?: string; q?: string }> }) {
  const ctx = await requirePortalPage();
  const sp = await searchParams;
  const rows = listForCaller(ctx, { verdict: sp.verdict, q: sp.q, limit: 200 });
  const admin = ctx.user.role === "company_admin";
  return (
    <section className="hist">
      <div className="spread sec-head">
        <div>
          <h1 className="hist-title">{admin ? `${ctx.company.name} investigations` : "My investigations"}</h1>
          <p className="muted">{admin ? "Every employee's investigations for your company." : "Every defect you have investigated."}</p>
        </div>
        <Link href="/portal" className="btn btn-main">New investigation</Link>
      </div>
      <form className="hist-filter" role="search">
        <label className="sr-only" htmlFor="h-q">Search by ticket</label>
        <input id="h-q" name="q" className="input" placeholder="Search by ticket, for example KAN-12" defaultValue={sp.q ?? ""} />
        <label className="sr-only" htmlFor="h-v">Verdict</label>
        <select id="h-v" name="verdict" className="input" defaultValue={sp.verdict ?? ""}>
          <option value="">All verdicts</option>
          {Object.entries(VERDICTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm">Filter</button>
      </form>
      {rows.length === 0 ? (
        <div className="card empty-state">{sp.q || sp.verdict ? "Nothing matches these filters." : "No investigations yet."}</div>
      ) : (
        <ul className="hist-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/portal/investigations/${r.id}`} className="hist-row">
                <span className="mono hist-key">{r.ticketKey}</span>
                <span className={`hist-verdict v-${r.verdict ?? r.status}`}>{r.verdictLabel ?? (r.status === "queued" ? `Queued${r.queuePosition ? ` · #${r.queuePosition}` : ""}` : r.status === "running" ? "Investigating…" : r.status === "cancelled" ? "Cancelled" : r.status)}</span>
                <span className="muted small">{fmt(r.createdAt)}{admin ? ` · ${r.owner.name || r.owner.employeeId}` : ""}</span>
                <span className="muted small">{r.feedback === "cause_correct" ? "✓ cause confirmed" : r.feedback === "cause_wrong" ? "✗ cause wrong" : ""}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
