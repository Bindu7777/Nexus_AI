// The scripted hero investigation. No backend: this is a timeline of what the
// Nexus demo shows. Numbers come from a recorded demo run of the sandbox
// catalog (tests/golden/snapshots/NI-1042.json), not from a customer system.
//
// To change the scene, edit the data below. `at` values are milliseconds from
// the start of the scene. Groups are the tap-to-advance stops on phones.

export type SceneGroup = "ticket" | "sources" | "evidence" | "hypotheses" | "fix";

export const scene = {
  label: "Example investigation from the Nexus demo",
  ticket: { id: "PAY-1423", title: "Checkout slows down under load", typeMs: 1100 },
  sources: [
    { id: "jira", label: "Jira" },
    { id: "github", label: "GitHub" },
    { id: "db", label: "Database" },
    { id: "logs", label: "Logs" },
    { id: "docs", label: "Docs" },
  ],
  evidence: [
    {
      kind: "metric" as const,
      text: "p95 latency 93 ms → 651 ms with 8 concurrent requests",
      cite: "metric · incident run",
    },
    {
      kind: "log" as const,
      text: "Mean lock wait 494 ms; 7 requests queued at peak",
      cite: "log · catalog warn",
    },
    {
      kind: "code" as const,
      text: "The slow read runs while the exclusive lock is held",
      cite: "catalog/server.mjs:194–198",
      code: [
        { n: 194, text: 'if (spec.workPlacement === "inside-lock") {' },
        { n: 195, text: "  // the slow read stays inside the lock" },
        { n: 198, text: "  await sleep(scenario.workMs);", hot: true },
        { n: 199, text: "}" },
      ],
    },
  ],
  hypotheses: [
    {
      verdict: "verified" as const,
      title: "Exclusive lock held during the slow read",
      detail: "Sandbox re-run: p95 651 → 84 ms · lock wait 494 → 0 ms",
    },
    {
      verdict: "abstain" as const,
      title: "Recent change to checkout pricing",
      detail: "No trace or log links it to the slowdown. Nexus will not guess.",
    },
  ],
  diff: [
    { sign: " ", text: "const lock = await mutex.acquire();" },
    { sign: "-", text: "await sleep(scenario.workMs);" },
    { sign: " ", text: "const product = snapshot(id);" },
    { sign: " ", text: "mutex.release();" },
    { sign: "+", text: "await sleep(scenario.workMs);" },
  ],
  /** Timeline. Each beat reveals one thing. */
  beats: [
    { at: 0, group: "ticket", key: "ticket" },
    { at: 1500, group: "sources", key: "source:0" },
    { at: 1800, group: "sources", key: "source:1" },
    { at: 2100, group: "sources", key: "source:2" },
    { at: 2400, group: "sources", key: "source:3" },
    { at: 2700, group: "sources", key: "source:4" },
    { at: 3300, group: "evidence", key: "evidence:0" },
    { at: 4000, group: "evidence", key: "evidence:1" },
    { at: 4700, group: "evidence", key: "evidence:2" },
    { at: 5600, group: "hypotheses", key: "hypothesis:0" },
    { at: 6300, group: "hypotheses", key: "hypothesis:1" },
    { at: 7300, group: "fix", key: "diff" },
    { at: 8200, group: "fix", key: "approve" },
  ] satisfies { at: number; group: SceneGroup; key: string }[],
  groups: [
    { id: "ticket", label: "Ticket read" },
    { id: "sources", label: "Sources connected" },
    { id: "evidence", label: "Evidence collected" },
    { id: "hypotheses", label: "Causes ranked" },
    { id: "fix", label: "Fix waits for approval" },
  ] satisfies { id: SceneGroup; label: string }[],
  /** Read by screen readers instead of the animation. */
  description:
    "Example investigation from the Nexus demo. Ticket PAY-1423, checkout slows down under load. Nexus reads Jira, GitHub, the database, logs and docs. Evidence: p95 latency rose from 93 to 651 milliseconds with 8 concurrent requests; mean lock wait was 494 milliseconds with 7 requests queued; the code at catalog/server.mjs lines 194 to 198 runs the slow read while the exclusive lock is held. Causes: the lock held during the slow read is verified, and a sandbox re-run brought p95 down to 84 milliseconds. A recent pricing change has not enough evidence, and Nexus will not guess. A suggested diff moves the slow read outside the lock. The fix waits for a human to approve it.",
};
