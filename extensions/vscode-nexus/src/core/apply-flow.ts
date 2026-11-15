// The apply-to-working-tree safeguard. The patch is applied only when:
//   1. Nexus proved it in its sandbox after the engineer approved (exportable),
//   2. the engineer has looked at this exact diff in VS Code's diff view, and
//   3. the engineer then clicks Apply a second time in a confirmation.
// It writes the one file in the working tree and nothing else: no commit,
// no push, no pull request. Those stay the engineer's own actions.
import { applyFilePatch, parseUnifiedDiff } from "./patch";

export type Fix = { diff: string | null; path: string | null; exportable: boolean };

export type ApplyDeps = {
  readFile(path: string): Promise<string | null>;
  showDiff(path: string, original: string, patched: string): Promise<void>;
  /** The second, explicit click. Resolves true only for the Apply button. */
  confirm(message: string): Promise<boolean>;
  writeFile(path: string, text: string): Promise<void>;
  record(action: "apply_to_working_tree"): Promise<void>;
};

export type FlowResult = { ok: true; message: string } | { ok: false; message: string };

export class ApplyFlow {
  /** What the engineer was shown: the diff and the file it was shown against. */
  private shown: { diff: string; original: string } | null = null;
  constructor(private deps: ApplyDeps) {}

  private prepare(fix: Fix) {
    if (!fix.diff || !fix.path) return { ok: false as const, message: "This investigation has no code patch." };
    const files = parseUnifiedDiff(fix.diff);
    if (files.length !== 1 || files[0].path !== fix.path) return { ok: false as const, message: "The patch must change exactly the one file it names." };
    return { ok: true as const, file: files[0] };
  }

  /** Step 1: open VS Code's diff view against the working tree. Changes nothing. */
  async preview(fix: Fix): Promise<FlowResult> {
    const p = this.prepare(fix);
    if (!p.ok) return p;
    const original = await this.deps.readFile(p.file.path);
    if (original === null) return { ok: false, message: `${p.file.path} is not in this workspace.` };
    const applied = applyFilePatch(original, p.file);
    if (!applied.ok) return applied;
    await this.deps.showDiff(p.file.path, original, applied.text);
    this.shown = { diff: fix.diff!, original };
    return { ok: true, message: "Diff shown. Nothing was changed." };
  }

  /** Step 2: apply, only after the diff was shown and a second click confirms. */
  async apply(fix: Fix): Promise<FlowResult> {
    if (!fix.exportable) return { ok: false, message: "Apply is available only after you approve and Nexus proves the fix in its sandbox." };
    const p = this.prepare(fix);
    if (!p.ok) return p;
    if (!this.shown || this.shown.diff !== fix.diff) return { ok: false, message: "Look at the diff first, then apply." };
    const current = await this.deps.readFile(p.file.path);
    if (current !== this.shown.original) {
      this.shown = null;
      return { ok: false, message: `${p.file.path} changed since you looked at the diff. Look at it again first.` };
    }
    const sure = await this.deps.confirm(`Apply this patch to ${p.file.path} in your working tree? Nexus will not commit, push or open a pull request.`);
    if (!sure) return { ok: false, message: "Not applied." };
    const applied = applyFilePatch(current, p.file);
    if (!applied.ok) return applied;
    await this.deps.writeFile(p.file.path, applied.text);
    this.shown = null;
    await this.deps.record("apply_to_working_tree");
    return { ok: true, message: `Applied to ${p.file.path} in your working tree. Review it, then commit it yourself if you want it.` };
  }
}
