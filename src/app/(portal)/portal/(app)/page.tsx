import { CATEGORIES } from "@/nexus-admin/connectors/types";
import { getApplication } from "@/nexus-admin/server/application";
import { listCompanyConnectors } from "@/nexus-admin/server/connectors";
import { defectExamples, defectSources } from "@/portal/server/defects";
import { requirePortalPage } from "@/portal/server/page-guard";
import { PortalHome } from "@/portal/ui/home";

export const dynamic = "force-dynamic";
export const metadata = { title: "Investigate" };

const isUrl = (s: string) => /^https?:\/\/[^\s]+$/i.test(s.trim());

export default async function PortalHomePage() {
  const { user, company, session } = await requirePortalPage();
  // Only names and health reach the browser: no config, scope values or secrets.
  const sources = listCompanyConnectors(company.id)
    .filter((c) => !c.planned)
    .map((c) => ({
      id: c.id,
      name: c.label || c.displayName,
      category: c.category,
      categoryTitle: CATEGORIES.find((x) => x.id === c.category)?.title ?? c.category,
      state: (c.status === "failing" ? "failing" : c.active && c.status === "healthy" ? "healthy" : "untested") as "healthy" | "failing" | "untested",
    }));
  const app = getApplication(company.id);
  const website =
    (isUrl(app.info.name) ? app.info.name : null) ??
    app.urls.find((u) => u.environment === "production")?.url ??
    null;
  const ds = defectSources(company.id);
  return (
    <PortalHome
      csrf={session.csrf_token}
      firstName={(user.display_name || "").split(" ")[0]}
      company={{ name: company.name, code: company.short_code, liveSince: company.went_live_at, website }}
      sources={sources}
      defect={{
        ready: ds.length > 0,
        where: ds.map((s) => (s.kind === "jira" ? `Jira (${s.projectKeys.join(", ")})` : `GitHub Issues (${s.repository})`)),
        examples: defectExamples(ds),
      }}
    />
  );
}
