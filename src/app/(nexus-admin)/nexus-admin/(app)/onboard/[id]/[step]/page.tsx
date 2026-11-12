import Link from "next/link";
import { notFound } from "next/navigation";
import { formModel } from "@/nexus-admin/connectors/form";
import { registry } from "@/nexus-admin/connectors/registry";
import { CATEGORIES } from "@/nexus-admin/connectors/types";
import { isStep, ONBOARDING_STEPS, type StepId } from "@/nexus-admin/onboarding";
import { canCreateLogins, displayStatus, getCompany, getToolPlan, goLiveBlockers } from "@/nexus-admin/server/companies";
import { listCompanyConnectors } from "@/nexus-admin/server/connectors";
import { requireAdminPage } from "@/nexus-admin/server/page-guard";
import { listUsers } from "@/nexus-admin/server/users";
import { CompanyStatusChip } from "@/nexus-admin/ui/chips";
import { GoLiveButton, UsersPanel } from "@/nexus-admin/ui/company";
import { ConnectorCard, ConnectorForm, HealthChip, TestAllButton, ToolPicker } from "@/nexus-admin/ui/connectors";
import { IAlert, IClock } from "@/nexus-admin/ui/icons";
import { DetailsForm, NextStep, RememberStep } from "@/nexus-admin/ui/onboarding";

export const dynamic = "force-dynamic";

export default async function OnboardingStep({ params }: { params: Promise<{ id: string; step: string }> }) {
  await requireAdminPage();
  const p = await params;
  const company = getCompany(Number(p.id));
  if (!company || !isStep(p.step)) notFound();
  const step: StepId = p.step;
  const plan = getToolPlan(company.id);
  const connectors = listCompanyConnectors(company.id);
  const users = listUsers(company.id);
  const models = registry().all().map(formModel);
  const modelOf = (id: string) => models.find((m) => m.id === id);
  const byId = new Map(connectors.map((c) => [c.id, c]));
  const blockers = goLiveBlockers(company.id);

  const codeReady = connectors.some((c) => c.category === "code" && c.active && c.status !== "failing");
  const docsReady = connectors.some((c) => c.category === "docs" && c.active && c.status !== "failing");
  const done: Record<StepId, boolean> = {
    company: true,
    tools: plan.entries.length > 0,
    credentials: plan.entries.length > 0 && plan.entries.every((e) => e.connectorId && byId.has(e.connectorId)),
    test: connectors.length > 0 && connectors.filter((c) => !c.planned).every((c) => c.active && c.status === "healthy"),
    learn: codeReady,
    logins: users.some((u) => u.role === "company_admin"),
    live: company.status === "active",
  };
  const idx = ONBOARDING_STEPS.findIndex((s) => s.id === step);
  const next = ONBOARDING_STEPS[idx + 1];
  const nextHref = next ? `/nexus-admin/onboard/${company.id}/${next.id}` : `/nexus-admin/companies/${company.id}`;

  return (
    <>
      <RememberStep companyId={company.id} step={step} />
      <div className="page-head">
        <div>
          <h1>{company.name}</h1>
          <p>
            Onboarding · <CompanyStatusChip status={company.status} />{company.status === "connected" ? <span className="muted small"> {displayStatus(company.status)}</span> : null}
          </p>
        </div>
        <Link href={`/nexus-admin/companies/${company.id}`} className="btn btn-ghost">Company page</Link>
      </div>
      <div className="flow">
        <nav aria-label="Onboarding steps">
          <ol className="rail">
            {ONBOARDING_STEPS.map((s, i) => (
              <li key={s.id} className={`${s.id === step ? "current" : ""} ${done[s.id] ? "done" : ""}`}>
                <span className="dot" aria-hidden="true">{done[s.id] ? "✓" : i + 1}</span>
                <Link href={`/nexus-admin/onboard/${company.id}/${s.id}`} aria-current={s.id === step ? "step" : undefined}>
                  {s.title}
                </Link>
                <span className="state">{done[s.id] ? "Done" : s.id === step ? "In progress" : ""}</span>
              </li>
            ))}
          </ol>
        </nav>
        <div className="step-panel stack" key={step}>
          <h2>
            Step {idx + 1}. {ONBOARDING_STEPS[idx].title}
          </h2>

          {step === "company" ? (
            <section className="card card-pad">
              <DetailsForm companyId={company.id} initial={company} nextHref={nextHref} />
            </section>
          ) : null}

          {step === "tools" ? (
            <ToolPicker companyId={company.id} categories={[...CATEGORIES]} models={models} plan={plan} nextHref={nextHref} />
          ) : null}

          {step === "credentials" ? (
            <div className="stack">
              {plan.entries.length === 0 ? (
                <p className="callout warn"><IAlert />Choose tools first, in step 2.</p>
              ) : null}
              {plan.entries.map((e) => {
                const model = modelOf(e.registryId);
                if (!model) return null;
                const existing = e.connectorId ? byId.get(e.connectorId) : undefined;
                return (
                  <section key={e.key} className="card card-pad stack" aria-label={model.displayName}>
                    <div className="spread">
                      <h3 style={{ margin: 0 }}>
                        {model.displayName} <span className="muted small">· {CATEGORIES.find((c) => c.id === e.category)?.title}</span>
                      </h3>
                      {existing ? <HealthChip c={existing} /> : <span className="chip chip-neutral"><IClock />Not saved</span>}
                    </div>
                    <ConnectorForm companyId={company.id} model={model} existing={existing} planEntry={e} />
                  </section>
                );
              })}
              <NextStep href={nextHref} label="Continue to tests" />
            </div>
          ) : null}

          {step === "test" ? (
            <div className="stack">
              <div className="spread">
                <p className="muted" style={{ margin: 0 }}>
                  Each test is read-only. A connector becomes Active only after its test passes.
                </p>
                <TestAllButton companyId={company.id} disabled={connectors.length === 0} />
              </div>
              {connectors.length === 0 ? <p className="callout warn"><IAlert />Save credentials first, in step 3.</p> : null}
              {connectors.map((c) => (
                <ConnectorCard key={c.id} companyId={company.id} connector={c} model={modelOf(c.registryId)} />
              ))}
              <NextStep href={nextHref} label="Continue" />
            </div>
          ) : null}

          {step === "learn" ? (
            <div className="stack">
              {!codeReady ? (
                <p className="callout">
                  <IClock />
                  Skipped for now: the application profile starts once a code connector has passed its test.
                </p>
              ) : (
                <div className="callout warn">
                  <IClock />
                  <div>
                    <strong>The learning job is not built yet.</strong>
                    <p className="small" style={{ margin: "4px 0 0" }}>
                      It will read the repository structure{docsReady ? ", the documentation" : ""}
                      {connectors.some((c) => c.category === "database" && c.active) ? " and the database schema" : ""} and build a sourced application profile you can review. It
                      arrives in a later build step. You can continue onboarding now.
                    </p>
                  </div>
                </div>
              )}
              <NextStep href={nextHref} label="Continue to logins" />
            </div>
          ) : null}

          {step === "logins" ? (
            <div className="stack">
              <p className="muted" style={{ margin: 0 }}>
                One company admin, then employees one at a time or from a CSV of employee IDs. Each temporary password is shown once and must be changed at first sign-in.
              </p>
              <UsersPanel companyId={company.id} companyCode={company.short_code} users={users} canCreate={canCreateLogins(company.id)} paused={company.status === "paused"} />
              <NextStep href={nextHref} label="Continue to go live" />
            </div>
          ) : null}

          {step === "live" ? (
            <div className="stack">
              <section className="card">
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Connector</th>
                        <th>Scope</th>
                        <th>Status</th>
                        <th>Last passed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {connectors.length === 0 ? (
                        <tr><td colSpan={4} className="muted">No connectors yet.</td></tr>
                      ) : (
                        connectors.map((c) => (
                          <tr key={c.id}>
                            <td>
                              {c.displayName}
                              <span className="muted small"> · {CATEGORIES.find((x) => x.id === c.category)?.title}</span>
                            </td>
                            <td className="small">
                              {Object.entries(c.scope)
                                .filter(([, v]) => (Array.isArray(v) ? v.length : v !== "" && v !== false))
                                .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
                                .join(" · ")}
                            </td>
                            <td><HealthChip c={c} /></td>
                            <td className="muted small">{c.lastOkAt ? new Date(c.lastOkAt).toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
              <p className="muted small" style={{ margin: 0 }}>
                {users.filter((u) => u.role === "company_admin").length} company admin, {users.filter((u) => u.role === "employee").length} employees.
                {plan.other.length ? ` Other tools noted: ${plan.other.map((o) => o.text).join(", ")}.` : ""}
              </p>
              {company.status === "active" ? (
                <p className="callout ok">This company is live.</p>
              ) : (
                <GoLiveButton companyId={company.id} blockers={blockers} />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
