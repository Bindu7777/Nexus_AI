import Link from "next/link";
import { displayStatus, listCompanies } from "@/nexus-admin/server/companies";
import { listCompanyConnectors } from "@/nexus-admin/server/connectors";
import { requireAdminPage } from "@/nexus-admin/server/page-guard";
import { CompanyStatusChip, fmtTime } from "@/nexus-admin/ui/chips";
import { PauseResume } from "@/nexus-admin/ui/company";
import { HealthDots } from "@/nexus-admin/ui/connectors";
import { IPlus } from "@/nexus-admin/ui/icons";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdminPage();
  const { q = "" } = await searchParams;
  const companies = listCompanies(q.slice(0, 80));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Companies</h1>
          <p>Status, connector health, last activity and employees.</p>
        </div>
        <Link href="/nexus-admin/onboard" className="btn btn-primary">
          <IPlus />
          Onboard a company
        </Link>
      </div>
      <form className="row" role="search" style={{ marginBottom: 16 }}>
        <label className="sr-only" htmlFor="q">Search companies</label>
        <input id="q" name="q" className="input" style={{ maxWidth: 320 }} defaultValue={q} placeholder="Search by name or code" />
        <button className="btn btn-ghost btn-sm">Search</button>
      </form>
      <section className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Connectors</th>
                <th>Last activity</th>
                <th>Employees</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    {q ? "No company matches that search." : "No companies yet. Onboard one to start."}
                  </td>
                </tr>
              ) : (
                companies.map((c) => {
                  const connectors = listCompanyConnectors(c.id);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link className="row-link" href={`/nexus-admin/companies/${c.id}`}>
                          {c.name}
                        </Link>
                        <span className="muted small"> · {c.short_code}</span>
                      </td>
                      <td>
                        <CompanyStatusChip status={c.status} />
                        {c.status === "connected" ? <span className="muted small"> {displayStatus(c.status)}</span> : null}
                      </td>
                      <td>
                        <HealthDots connectors={connectors} />
                        {c.failed_count ? <span className="chip chip-bad" style={{ marginLeft: 8 }}>{c.failed_count} failing</span> : null}
                      </td>
                      <td className="muted small">{fmtTime(c.last_activity_at)}</td>
                      <td>{c.employee_count}</td>
                      <td>
                        <span className="row" style={{ justifyContent: "flex-end" }}>
                          {c.status === "draft" || c.status === "connected" ? (
                            <Link className="btn btn-ghost btn-sm" href={`/nexus-admin/onboard/${c.id}`}>Resume onboarding</Link>
                          ) : null}
                          <Link className="btn btn-ghost btn-sm" href={`/nexus-admin/companies/${c.id}`}>Open</Link>
                          <PauseResume companyId={c.id} paused={c.status === "paused"} />
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
