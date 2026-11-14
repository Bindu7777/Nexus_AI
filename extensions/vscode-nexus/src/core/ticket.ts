// Finding a defect number in what the engineer already has: a selection, a
// typed value, or the current Git branch name. No investigation logic.

const KEY = /\b([A-Z][A-Z0-9_]{1,19}-\d{1,9})\b/;
const GH = /\b([A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}#\d{1,9})\b/;
const NOT_PROJECTS = new Set(["feature", "feat", "bugfix", "fix", "hotfix", "release", "chore", "docs", "refactor", "test", "v", "rc", "wip", "dependabot", "renovate"]);

/** A ticket key typed or selected: PAY-1423, owner/repo#12 or #12. */
export function ticketFromText(text: string): string | null {
  const t = text.trim();
  const gh = t.match(GH);
  if (gh) return gh[1];
  const key = t.toUpperCase() === t ? t.match(KEY) : t.match(/\b([A-Za-z][A-Za-z0-9_]{1,19}-\d{1,9})\b/);
  if (key) {
    const [project] = key[1].split("-");
    if (NOT_PROJECTS.has(project.toLowerCase())) return null;
    return key[1].toUpperCase();
  }
  const bare = t.match(/^#(\d{1,9})$/);
  return bare ? `#${bare[1]}` : null;
}

/** feature/PAY-1423-fix-totals or pay-1423-checkout give PAY-1423. */
export function ticketFromBranch(branch: string | null | undefined): string | null {
  if (!branch) return null;
  for (const part of branch.split("/")) {
    const m = part.match(/^([A-Za-z][A-Za-z0-9_]{1,19})-(\d{1,9})(?:\b|[-_])/);
    if (m && !NOT_PROJECTS.has(m[1].toLowerCase())) return `${m[1].toUpperCase()}-${m[2]}`;
  }
  return null;
}

/** owner/repo from a GitHub remote URL, for the default repository mapping. */
export function repoFromRemote(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.trim().match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
