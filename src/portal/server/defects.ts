// Which defect numbers a company's employees may investigate, from the scope
// of the company's active defect connectors (Jira project keys, or the GitHub
// Issues repository). Only names and patterns leave this file, never config.
import { asList } from "@/nexus-admin/connectors/form";
import { listCompanyConnectors } from "@/nexus-admin/server/connectors";

export type DefectSource =
  | { kind: "jira"; label: string; projectKeys: string[] }
  | { kind: "github-issues"; label: string; repository: string };

export function defectSources(companyId: number): DefectSource[] {
  const out: DefectSource[] = [];
  for (const c of listCompanyConnectors(companyId)) {
    if (c.category !== "defects" || !c.active || c.planned || c.needsSecret) continue;
    if (c.registryId === "jira") {
      const keys = asList(c.scope.projectKeys).map((k) => k.toUpperCase());
      if (keys.length) out.push({ kind: "jira", label: c.label || "Jira", projectKeys: keys });
    } else if (c.registryId === "github-issues") {
      const repo = String(c.scope.repository ?? "");
      if (repo) out.push({ kind: "github-issues", label: c.label || "GitHub Issues", repository: repo });
    }
  }
  return out;
}

/** Example numbers to show under the input. */
export function defectExamples(sources: DefectSource[]) {
  return sources.flatMap((s) => (s.kind === "jira" ? s.projectKeys.slice(0, 3).map((k) => `${k}-123`) : [`${s.repository}#42`]));
}

export type DefectCheck =
  | { ok: true; key: string; source: DefectSource["kind"]; where: string }
  | { ok: false; message: string };

export function checkDefectNumber(sources: DefectSource[], raw: string): DefectCheck {
  const input = raw.trim().slice(0, 120);
  if (!sources.length) {
    return { ok: false, message: "Your company has no working defect connector yet, so Nexus cannot read tickets. Ask your company admin to connect Jira or GitHub Issues." };
  }
  if (!input) return { ok: false, message: "Enter a defect number." };

  const jira = input.match(/^([A-Za-z][A-Za-z0-9_]{0,19})-(\d{1,9})$/);
  if (jira) {
    const project = jira[1].toUpperCase();
    const src = sources.find((s): s is Extract<DefectSource, { kind: "jira" }> => s.kind === "jira" && s.projectKeys.includes(project));
    if (src) return { ok: true, key: `${project}-${Number(jira[2])}`, source: "jira", where: `Jira project ${project}` };
    const keys = sources.flatMap((s) => (s.kind === "jira" ? s.projectKeys : []));
    return {
      ok: false,
      message: keys.length
        ? `${project} is not a project Nexus may read for your company. Use ${keys.join(", ")}.`
        : "Your company's tickets are in GitHub Issues. Enter an issue number such as #42.",
    };
  }

  const gh = input.match(/^(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#?(\d{1,9})$/);
  if (gh) {
    const repos = sources.filter((s): s is Extract<DefectSource, { kind: "github-issues" }> => s.kind === "github-issues");
    if (!repos.length) {
      const keys = sources.flatMap((s) => (s.kind === "jira" ? s.projectKeys : []));
      return { ok: false, message: `Enter the full ticket key, for example ${keys[0] ?? "KEY"}-${gh[2]}.` };
    }
    const repo = gh[1] ? repos.find((r) => r.repository.toLowerCase() === gh[1].toLowerCase()) : repos.length === 1 ? repos[0] : undefined;
    if (!repo) {
      return {
        ok: false,
        message: gh[1]
          ? `${gh[1]} is not a repository Nexus may read for your company.`
          : `Say which repository, for example ${repos[0].repository}#${gh[2]}.`,
      };
    }
    return { ok: true, key: `${repo.repository}#${Number(gh[2])}`, source: "github-issues", where: `GitHub Issues in ${repo.repository}` };
  }

  return { ok: false, message: `That does not look like a defect number. Try ${defectExamples(sources)[0] ?? "a ticket key"}.` };
}
