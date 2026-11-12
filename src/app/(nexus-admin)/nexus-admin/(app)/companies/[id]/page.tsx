import Link from "next/link";
import { notFound } from "next/navigation";
import { formModel } from "@/nexus-admin/connectors/form";
import { registry } from "@/nexus-admin/connectors/registry";
import { CATEGORIES } from "@/nexus-admin/connectors/types";
import { getApplication } from "@/nexus-admin/server/application";
import { queryAudit } from "@/nexus-admin/server/audit";
import { canCreateLogins, displayStatus, getCompany, goLiveBlockers } from "@/nexus-admin/server/companies";
import { listCompanyConnectors } from "@/nexus-admin/server/connectors";
import { requireAdminPage } from "@/nexus-admin/server/page-guard";
import { listUsers } from "@/nexus-admin/server/users";
import { ApplicationPanel, KtCard } from "@/nexus-admin/ui/application";
import { CompanyStatusChip, fmtTime, ResultChip } from "@/nexus-admin/ui/chips";
import { GoLiveButton, PauseResume, UsersPanel } from "@/nexus-admin/ui/company";
import { ConnectorCard, HealthDots, TestAllButton } from "@/nexus-admin/ui/connectors";
import { IClock, IPlus } from "@/nexus-admin/ui/icons";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "overview", title: "Overview" },
  { id: "application", title: "Application" },
  { id: "kt", title: "KT files" },
  { id: "health", title: "Connection health" },
  { id: "logins", title: "Logins" },
  { id: "usage", title: "Usage" },
  { id: "audit", title: "Audit log" },
] as const;

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const company = getCompany(Number(id));
  if (!company) notFound();
  const tab = TABS.some((t) => t.id === rawTab) ? rawTab : "overview";
  const connectors = listCompanyConnectors(company.id);
  const users = listUsers(company.id);
  const models = registry().all().map(formModel);
  const base = `/nexus-admin/companies/${company.id}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{company.name}</h1>
          <p>
            <CompanyStatusChip status={company.status} />{" "}<span className="muted small">{company.status === "connected" ? `${displayStatus(company.status)} · ` : ""}code {company.short_code}</span>
          </p>
        </div>
        <span className="row">
          {company.status !== "active" && company.status !== "paused" ? (
            <Link href={`/nexus-admin/onboard/${company.id}`} className="btn btn-ghost">Resume onboarding</Link>
          ) : null}
          <PauseResume companyId={company.id} paused={company.status === "paused"} />
        </span>
      </div>
      <nav className="tabs" aria-label="Company sections" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <Link key={t.id} href={`${base}?tab=${t.id}`} aria-current={tab === t.id ? "page" : undefined}>
            {t.title}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="stack">
          <div className="grid-4">
            <div className="card stat"><span className="muted small">Connectors</span><div className="n">{connectors.length}</div><HealthDots connectors={connectors} /></div>
            <div className="card stat"><span className="muted small">Failing</span><div className="n">{connectors.filter((c) => c.status === "failing").length}</div></div>
            <div className="card stat"><span className="muted small">Employees</span><div className="n">{users.filter((u) => u.role === "employee").length}</div></div>
            <div className="card stat"><span className="muted small">Last activity</span><div className="small" style={{ marginTop: 10 }}>{fmtTime(company.last_activity_at)}</div></div>
          </div>
          <section className="card card-pad spread" aria-label="Quick actions">
            <div>
              <h2 style={{ margin: 0 }}>Files and connections</h2>
              <p className="muted small" style={{ margin: "4px 0 0" }}>Upload KT material and documentation, record the application&apos;s URLs, or connect the database and logs.</p>
            </div>
            <span className="row">
              <Link className="btn btn-primary" href={`${base}?tab=kt`}><IPlus />Upload KT files</Link>
              <Link className="btn btn-ghost" href={`${base}?tab=application`}>Application and docs</Link>
              <Link className="btn btn-ghost" href={`/nexus-admin/onboard/${company.id}/tools`}>Connect database or logs</Link>
            </span>
          </section>
          <section className="card card-pad">
            <h2>Details</h2>
            <dl className="small" style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "6px 12px", margin: 0 }}>
              <dt className="muted">Contact</dt><dd style={{ margin: 0 }}>{company.contact_name} · {company.contact_email}</dd>
              <dt className="muted">Country / region</dt><dd style={{ margin: 0 }}>{[company.country, company.region].filter(Boolean).join(" · ") || "—"}</dd>
              <dt className="muted">Deployment</dt><dd style={{ margin: 0 }}>{company.deployment_mode === "nexus-hosted" ? "Nexus runs on our servers (pilot)" : "Nexus runs on their servers"}</dd>
              <dt className="muted">Went live</dt><dd style={{ margin: 0 }}>{fmtTime(company.went_live_at)}</dd>
              <dt className="muted">Notes</dt><dd style={{ margin: 0 }}>{company.notes || "—"}</dd>
            </dl>
            <p style={{ marginTop: 12 }}><Link href={`/nexus-admin/onboard/${company.id}/company`} className="small">Edit details</Link></p>
          </section>
          {company.status !== "active" && company.status !== "paused" ? (
            <section className="card card-pad"><h2>Go live</h2><GoLiveButton companyId={company.id} blockers={goLiveBlockers(company.id)} /></section>
          ) : null}
        </div>
      ) : null}

      {tab === "application" ? <ApplicationPanel companyId={company.id} app={getApplication(company.id)} /> : null}

      {tab === "kt" ? <KtCard companyId={company.id} docs={getApplication(company.id).docs} /> : null}

      {tab === "health" ? (
        <div className="stack">
          <div className="spread">
            <p className="muted" style={{ margin: 0 }}>
              One card per connector. Changing a credential or scope needs a fresh passing test before it takes effect; the old value stays active until then.
            </p>
            <span className="row">
              <Link className="btn btn-ghost" href={`/nexus-admin/onboard/${company.id}/tools`}><IPlus />Add a tool</Link>
              <TestAllButton companyId={company.id} disabled={connectors.length === 0} />
            </span>
          </div>
          {CATEGORIES.map((cat) => {
            const list = connectors.filter((c) => c.category === cat.id);
            if (!list.length) return null;
            return (
              <div key={cat.id} className="stack">
                <h2 style={{ margin: "8px 0 0" }}>{cat.title}</h2>
                {list.map((c) => (
                  <ConnectorCard key={c.id} companyId={company.id} connector={c} model={models.find((m) => m.id === c.registryId)} />
                ))}
              </div>
            );
          })}
          {connectors.length === 0 ? <p className="callout"><IClock />No connectors yet.</p> : null}
          <p className="muted small">Automatic health checks every few hours arrive in a later build step. For now, use Retest or Test all.</p>
        </div>
      ) : null}

      {tab === "logins" ? (
        <UsersPanel companyId={company.id} companyCode={company.short_code} users={users} canCreate={canCreateLogins(company.id)} paused={company.status === "paused"} />
      ) : null}

      {tab === "usage" ? (
        <div className="callout">
          <IClock />
          <div>
            <strong>No usage yet.</strong>
            <p className="small" style={{ margin: "4px 0 0" }}>
              Investigations, outcomes, fixes, active employees and connector reads appear here once company users can run investigations, which arrives in a later build step. Only what
              the engine reports will be counted.
            </p>
          </div>
        </div>
      ) : null}

      {tab === "audit" ? <CompanyAudit companyId={company.id} /> : null}
    </>
  );
}

function CompanyAudit({ companyId }: { companyId: number }) {
  const { rows, total } = queryAudit({ companyId, pageSize: 100 });
  return (
    <section className="card">
      <div className="card-pad spread">
        <span className="muted small">Latest {rows.length} of {total} events</span>
        <span className="row">
          <Link className="small" href={`/nexus-admin/logs?company=${companyId}`}>Filter in Logs</Link>
          <a className="btn btn-ghost btn-sm" href={`/api/nexus-admin/logs/export?company=${companyId}`}>Export CSV</a>
        </span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Time</th><th>Who</th><th>Event</th><th>Target</th><th>Result</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted small" style={{ whiteSpace: "nowrap" }}>{fmtTime(r.at)}</td>
                <td>{r.actor_label}</td>
                <td className="mono">{r.action}</td>
                <td className="small">{r.target}</td>
                <td><ResultChip result={r.result} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
