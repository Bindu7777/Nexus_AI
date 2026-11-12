import Link from "next/link";
import { ACTION_GROUPS, auditFilterFromUrl, queryAudit } from "@/nexus-admin/server/audit";
import { listCompanies } from "@/nexus-admin/server/companies";
import { requireAdminPage } from "@/nexus-admin/server/page-guard";
import { fmtTime, ResultChip } from "@/nexus-admin/ui/chips";
import { IDownload } from "@/nexus-admin/ui/icons";

export const dynamic = "force-dynamic";

const GROUPS: Record<string, string> = ACTION_GROUPS;

export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage();
  const raw = await searchParams;
  const sp = new URLSearchParams(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"));
  const filter = auditFilterFromUrl({ searchParams: sp });
  const { rows, total, page, pageSize } = queryAudit(filter);
  const companies = listCompanies();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const withPage = (n: number) => {
    const q = new URLSearchParams(sp);
    q.set("page", String(n));
    return `/nexus-admin/logs?${q}`;
  };
  const exportQs = new URLSearchParams(sp);
  exportQs.delete("page");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Logs</h1>
          <p>Append-only audit trail of every important event. Secrets and ticket contents are never recorded.</p>
        </div>
        <a className="btn btn-ghost" href={`/api/nexus-admin/logs/export?${exportQs}`}>
          <IDownload />
          Export CSV
        </a>
      </div>
      <form className="card card-pad form" style={{ marginBottom: 16 }} role="search">
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
          <div className="field">
            <label htmlFor="f-company">Company</label>
            <select id="f-company" name="company" className="input" defaultValue={sp.get("company") ?? ""}>
              <option value="">All</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-action">Event type</label>
            <select id="f-action" name="action" className="input" defaultValue={sp.get("action") ?? ""}>
              <option value="">All</option>
              {Object.entries(GROUPS).map(([prefix, label]) => <option key={prefix} value={prefix}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-from">From</label>
            <input id="f-from" name="from" type="date" className="input" defaultValue={sp.get("from") ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="f-to">To</label>
            <input id="f-to" name="to" type="date" className="input" defaultValue={sp.get("to") ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="f-q">Search (user, event, target)</label>
            <input id="f-q" name="q" className="input" defaultValue={sp.get("q") ?? ""} />
          </div>
        </div>
        <div className="row">
          <button className="btn btn-primary btn-sm">Apply filters</button>
          <Link href="/nexus-admin/logs" className="btn btn-ghost btn-sm">Clear</Link>
          <span className="muted small">{total} events</span>
        </div>
      </form>
      <section className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Time</th><th>Who</th><th>Company</th><th>Event</th><th>Target</th><th>Result</th><th>IP</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="muted">No events match.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted small" style={{ whiteSpace: "nowrap" }}>{fmtTime(r.at)}</td>
                    <td>{r.actor_label}</td>
                    <td>{r.company_name ?? <span className="muted">—</span>}</td>
                    <td className="mono">{r.action}</td>
                    <td className="small">{r.target}</td>
                    <td><ResultChip result={r.result} /></td>
                    <td className="muted small">{r.ip ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div className="card-pad row pager">
            {page > 1 ? <Link href={withPage(page - 1)} className="btn btn-ghost btn-sm">Newer</Link> : null}
            <span className="muted small">Page {page} of {pages}</span>
            {page < pages ? <Link href={withPage(page + 1)} className="btn btn-ghost btn-sm">Older</Link> : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
