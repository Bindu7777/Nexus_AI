import Link from "next/link";
import { queryAudit } from "@/nexus-admin/server/audit";
import { companiesNeedingAttention, statusCounts } from "@/nexus-admin/server/companies";
import { requireAdminPage } from "@/nexus-admin/server/page-guard";
import { registry } from "@/nexus-admin/connectors/registry";
import { CATEGORIES } from "@/nexus-admin/connectors/types";
import { CompanyStatusChip, fmtTime, ResultChip } from "@/nexus-admin/ui/chips";
import { IPlus } from "@/nexus-admin/ui/icons";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireAdminPage();
  const counts = statusCounts();
  const total = counts.draft + counts.connected + counts.active + counts.paused;
  const attention = companiesNeedingAttention();
  const recent = queryAudit({ pageSize: 10 }).rows;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Companies, connection health and recent activity.</p>
        </div>
        <Link href="/nexus-admin/onboard" className="btn btn-primary">
          <IPlus />
          Onboard a company
        </Link>
      </div>

      {total === 0 ? (
        <div className="card empty">
          <h2>No companies yet</h2>
          <p>Onboarding records where a company&apos;s code, tickets, database, docs and logs live, tests each read-only connection, and then issues the company login.</p>
          <Link href="/nexus-admin/onboard" className="btn btn-primary">
            <IPlus />
            Onboard your first company
          </Link>
        </div>
      ) : (
        <div className="stack">
          <div className="grid-4">
            {(["draft", "connected", "active", "paused"] as const).map((s) => (
              <div key={s} className="card stat">
                <CompanyStatusChip status={s} />
                <div className="n">{counts[s]}</div>
              </div>
            ))}
          </div>
          <div className="grid-2">
            <section className="card" aria-labelledby="att-title">
              <div className="card-pad spread">
                <h2 id="att-title">Needs attention</h2>
                <span className="muted small">Failed connection tests</span>
              </div>
              {attention.length === 0 ? (
                <p className="card-pad muted" style={{ paddingTop: 0 }}>
                  Every tested connection is passing.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Connection</th>
                        <th>Last test</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attention.map((a) => (
                        <tr key={`${a.id}-${a.connector_id}`}>
                          <td>
                            <Link className="row-link" href={`/nexus-admin/companies/${a.id}?tab=health`}>
                              {a.name}
                            </Link>
                          </td>
                          <td>{registry().get(a.registry_id)?.displayName ?? a.registry_id} <span className="muted">· {CATEGORIES.find((c) => c.id === a.category)?.title ?? a.category}</span></td>
                          <td className="muted">{fmtTime(a.last_tested_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="card" aria-labelledby="act-title">
              <div className="card-pad spread">
                <h2 id="act-title">Latest activity</h2>
                <Link href="/nexus-admin/logs" className="small">
                  All logs
                </Link>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {recent.map((r) => (
                      <tr key={r.id}>
                        <td className="muted small" style={{ whiteSpace: "nowrap" }}>
                          {fmtTime(r.at)}
                        </td>
                        <td>
                          <span className="mono">{r.action}</span>
                          {r.company_name ? <span className="muted small"> · {r.company_name}</span> : null}
                        </td>
                        <td>
                          <ResultChip result={r.result} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
