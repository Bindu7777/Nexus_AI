import { CATEGORIES } from "@/nexus-admin/connectors/types";
import { listCompanyConnectors } from "@/nexus-admin/server/connectors";
import { requirePortalPage } from "@/portal/server/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investigate" };

export default async function PortalHome() {
  const { user, company } = await requirePortalPage();
  // Only names and health reach the browser: no config, scope or secrets.
  const sources = listCompanyConnectors(company.id)
    .filter((c) => !c.planned)
    .map((c) => ({ id: c.id, name: c.displayName, category: CATEGORIES.find((x) => x.id === c.category)?.title ?? c.category, ok: c.active && c.status === "healthy", failing: c.status === "failing" }));
  const first = (user.display_name || "").split(" ")[0];
  return (
    <section className="hero" aria-labelledby="home-title">
      <h1 id="home-title">{first ? `Hello ${first}. ` : ""}What should Nexus investigate?</h1>
      <p className="lead">Enter a defect number. Nexus reads {company.name}&apos;s connected systems, cites every piece of evidence, and says plainly when it does not have enough.</p>
      <div className="ask" role="group" aria-label="Start an investigation">
        <label className="sr-only" htmlFor="defect">Defect number</label>
        <input id="defect" placeholder="Enter a defect number, for example PAY-1423" disabled aria-describedby="ask-note" />
        <button type="button" className="btn btn-main" disabled>Start investigation</button>
      </div>
      <p id="ask-note" className="faint small" style={{ marginTop: 10 }}>Investigations are being switched on in the next build step.</p>

      <div className="sources" aria-label="Connected sources">
        <span className="muted small">Sources:</span>
        {sources.length === 0 ? <span className="muted small">No sources connected yet. Your company admin connects them.</span> : null}
        {sources.map((s) => (
          <span key={s.id} className={`source ${s.ok ? "ok" : s.failing ? "bad" : ""}`}>
            <span className="dot" aria-hidden="true" />
            {s.name}
            <span className="state">· {s.ok ? "healthy" : s.failing ? "failing, evidence may be incomplete" : "not tested"}</span>
          </span>
        ))}
      </div>

      <h2 className="section-title">Your recent investigations</h2>
      <div className="card empty-state">None yet.</div>
    </section>
  );
}
