// All copy for the public site. Edit words here, not in components.
// Honesty rules: Nexus is a prototype. No customers, logos, testimonials,
// certifications or statistics. Any number is labelled as a demo example.

export const site = {
  name: "Nexus AI",
  description:
    "Nexus AI investigates software defects inside your own network. It reads your code, database, logs and docs, cites the evidence, abstains when unsure, and proposes a fix you approve.",
  contactEmail: "hello@example.com",
  prototypeNote: "Nexus AI is an early prototype. Features marked Planned are not available yet.",
};

export const nav = {
  links: [
    { href: "#product", label: "Product" },
    { href: "#how-it-works", label: "How it works" },
    { href: "#trust", label: "Trust" },
    { href: "#pricing", label: "Pricing" },
  ],
  signIn: { href: "/sign-in", label: "Sign in" },
  cta: "Book a pilot",
};

export const hero = {
  headline: ["Every bug has a cause.", "Nexus shows you the proof."],
  subhead:
    "Enter a ticket number. Nexus reads your code, database, logs and docs inside your own network, finds the evidence, and suggests a fix you approve.",
  primary: "Book a pilot",
  secondary: "Watch an investigation",
};

export const ticker = {
  label: "Example outcomes from the demo",
  items: [
    { id: "PAY-1423", what: "lock contention", status: "verified", tail: "fix proposed" },
    { id: "NEX-6", what: "service unavailable", status: "abstain", tail: "escalated", statusText: "not enough evidence" },
    { id: "NEX-7", what: "cart totals wrong", status: "abstain", tail: "asked for reproduction", statusText: "needs a trace" },
    { id: "CHK-88", what: "recent commit regression", status: "verified", tail: "fix proposed" },
    { id: "NI-1042", what: "catalog reads stall", status: "verified", tail: "validated in sandbox" },
    { id: "OPS-311", what: "ticket text too thin", status: "abstain", tail: "asked for logs", statusText: "not enough evidence" },
  ] as { id: string; what: string; status: "verified" | "abstain"; tail: string; statusText?: string }[],
};

export const problem = {
  headline: "Finding the cause takes longer than fixing it.",
  beats: [
    { title: "Reproduce the bug", body: "Someone has to make it happen again, under the same load, on purpose." },
    { title: "Dig through logs and diffs", body: "Recent commits, log lines, schema changes, and the one doc that explains why." },
    { title: "Compare normal with broken", body: "Line up what changed against what stayed the same until one difference explains it." },
  ],
  close: "Nexus runs this loop for you and keeps the receipts.",
  chartNote: "Illustrative, not a measurement.",
};

export const howItWorks = {
  headline: "Seven steps, the same every time.",
  intro: "Each step is a fixed tool with a fixed job. The model can explain the result. It cannot skip a step or invent a number.",
  steps: [
    { title: "Read the ticket", tool: "get_ticket", body: "Nexus reads the ticket from your tracker. Thin tickets are flagged, not filled in." },
    { title: "Reproduce the problem", tool: "measure_service", body: "In a sandbox, Nexus measures normal behaviour and broken behaviour under the same load." },
    { title: "Collect evidence", tool: "collect_evidence", body: "Code, commits, schema, logs and docs, each kept with a reference you can open." },
    { title: "Decide a cause, or abstain", tool: "diagnose", body: "Fixed rules decide. If they do not fire, Nexus says so and lists what is missing." },
    { title: "Propose a fix", tool: "propose_remediation", body: "Only when a rule confirmed a cause. The proposal is not applied." },
    { title: "Wait for human approval", tool: "apply_sandbox_remediation", body: "Nothing changes until an engineer approves it." },
    { title: "Measure again to confirm", tool: "validate", body: "The same load runs again, and the before and after are compared." },
  ],
};

export const walkthrough = {
  headline: "One bug, start to finish.",
  intro: "Follow ticket PAY-1423 through the four stages of an investigation.",
  label: "Example walkthrough",
  note: "Metric, log and code evidence come from the Nexus demo. Schema and doc references show connectors that are in development.",
  stages: [
    { id: "connect", title: "Connect", body: "The ticket arrives and the sources you connected light up. Nexus reads, it never writes back." },
    { id: "trace", title: "Trace", body: "Evidence is pulled from code, schema, logs and docs. Every item keeps its file, line or log reference." },
    { id: "decide", title: "Decide", body: "Rules compare broken with normal. All three must fire to confirm a cause. Otherwise Nexus abstains." },
    { id: "fix", title: "Fix", body: "A diff is proposed and stops at a gate. It waits for a human to approve it." },
  ],
};

export const evidence = {
  headline: "Rules decide. AI explains.",
  does: {
    title: "Nexus does",
    items: ["Cites a file, line, log or measurement for every claim.", "Shows the rule that fired, with its numbers.", "Lists what it could not verify."],
  },
  refuses: {
    title: "Nexus refuses to",
    items: ["Invent numbers.", "Blame a cause it cannot show.", "Apply a change nobody approved."],
  },
  toggle: {
    clear: {
      label: "Clear case",
      ticket: "NEX-5 · checkout p95 spikes under load",
      verdict: "Verified",
      body: "All three rules fired: latency, lock wait and queue depth. Cause: the exclusive lock is held during the slow read.",
      cites: ["metric · baseline vs incident", "trace · lock wait span", "catalog/server.mjs:194–198"],
    },
    unclear: {
      label: "Unclear case",
      ticket: "NEX-7 · some users see wrong cart totals",
      verdict: "Not enough evidence",
      body: "The ticket has no trace, log or reproduction. Nexus will not guess at a cause or invent cart totals.",
      asks: ["A trace from an affected checkout", "Logs for the time window", "Steps to reproduce"],
    },
  },
};

export const guessVsProof = {
  headline: "A guess versus a proof.",
  intro: "Drag the divider. Same bug, two answers.",
  guess: {
    label: "A typical AI answer",
    body: "The slowdown is most likely caused by an N+1 query introduced in a recent deploy of the checkout service. Adding eager loading to the cart query should resolve it.",
    sticker: "Nothing to check it against",
  },
  proof: {
    label: "Nexus",
    chain: [
      { cite: "metric", text: "p95 93 → 651 ms under the same load" },
      { cite: "log", text: "mean lock wait 494 ms, 7 queued" },
      { cite: "server.mjs:198", text: "slow read inside the exclusive lock" },
    ],
    rule: "Rule fired: incident p95 ≥ 2× baseline and +40 ms (651 vs 93)",
    verdict: "Verified in sandbox",
    unverified: ["Whether production traffic shows the same pattern", "Whether other services share this lock"],
  },
};

export const integrations = {
  headline: "Connects to what you already use.",
  caption: "Read-only by default. You choose what Nexus can see.",
  diagrams: [
    { id: "code", title: "Code host", source: "GitHub", reads: ["files", "commits", "diffs", "issues"] },
    { id: "tracker", title: "Tracker", source: "Jira", reads: ["ticket text", "status", "labels"] },
    { id: "database", title: "Database", source: "Postgres", reads: ["schema", "indexes", "RLS policies"] },
  ],
  // status: "demo" works in the demo today, "building" is being built, "planned" is not started.
  names: [
    { name: "Jira", status: "demo" },
    { name: "GitHub", status: "building" },
    { name: "GitHub Issues", status: "building" },
    { name: "Postgres", status: "building" },
    { name: "Supabase", status: "building" },
    { name: "Log files", status: "building" },
    { name: "Markdown docs", status: "building" },
    { name: "GitLab", status: "planned" },
    { name: "Bitbucket", status: "planned" },
    { name: "Confluence", status: "planned" },
    { name: "MySQL", status: "planned" },
    { name: "Datadog", status: "planned" },
    { name: "CloudWatch", status: "planned" },
    { name: "Loki", status: "planned" },
    { name: "Sentry", status: "planned" },
  ] as { name: string; status: "demo" | "building" | "planned" }[],
  statusLabel: { demo: "In the demo", building: "In development", planned: "Planned" },
};

export const environment = {
  headline: "Your code never leaves your network.",
  intro: "Nexus runs next to your systems. If you connect a model, it is an endpoint you choose and host.",
  statements: [
    { title: "Planned delivery", body: "Signed containers or a Helm chart, installed by your team." },
    { title: "You choose the sources", body: "Connect only what you want Nexus to read. Remove any of it at any time." },
    { title: "Read-only, recorded", body: "Read-only access, and every investigation is recorded in an audit trail." },
  ],
};

export const ide = {
  headline: "Investigate without leaving your IDE.",
  body: "Type a ticket number in the command palette. The result opens beside your code with the cited lines highlighted.",
  badge: "Coming soon",
  note: "A prototype editor extension exists in the repository. A packaged release is not available yet.",
};

export const trust = {
  headline: "Guardrails, stated plainly.",
  items: [
    "Read-only access by default.",
    "A human approves every change.",
    "Every claim cites its evidence.",
    "Nexus abstains when it is unsure.",
    "Tickets, logs and documents are treated as untrusted input.",
    "An audit trail records who ran what.",
  ],
  footnote: "Nexus holds no security certifications today. We will say so here when that changes.",
};

export const faq = {
  headline: "Questions engineering leaders ask first.",
  items: [
    {
      q: "Where does my code go?",
      a: "Nowhere outside your network. Nexus runs inside your environment and reads your sources there. If you connect a language model, it is an endpoint you configure and control.",
    },
    {
      q: "Which languages and tools do you support today?",
      a: "Nexus is an early prototype, so support is limited. The demo reads Jira tickets and investigates a sandbox service. Connectors for GitHub, Postgres and Supabase, log files and Markdown docs are in development. GitLab, Bitbucket, Confluence and MySQL are planned. We scope a pilot around what you use.",
    },
    {
      q: "Does Nexus change my systems?",
      a: "No. Connectors only read. A proposed fix is applied only in a sandbox, and only after an engineer approves it. Nexus does not push code, edit tickets, or write to your database.",
    },
    {
      q: "What happens when it is not sure?",
      a: "It abstains. It says it has no verified diagnosis, shows the evidence it did gather, and lists what is missing, such as a trace, a log window or steps to reproduce.",
    },
    {
      q: "How long is a pilot?",
      a: "Two weeks, on one real historical ticket from your backlog, so you can judge the result against what your team already knows.",
    },
    {
      q: "Who can see investigation results?",
      a: "Only people you give access to inside your deployment. Results stay in your environment. A persistent audit log and an admin portal for managing access are planned.",
    },
  ],
};

export const finalCta = {
  headline: "See it investigate one of your own old bugs.",
  subhead: "A two-week pilot on a real historical ticket.",
  button: "Book a pilot",
};

export const footer = {
  blurb: "Defect investigation that shows its work. Runs inside your network.",
  links: [
    { href: "#product", label: "Product" },
    { href: "#pricing", label: "Pricing" },
    { href: "#trust", label: "Trust" },
    { href: "/sign-in", label: "Sign in" },
  ],
};

export const pilotForm = {
  title: "Book a pilot",
  intro: "Tell us a little about your team. We reply by email. Nothing is shared with third parties.",
  fields: {
    name: "Name",
    email: "Work email",
    company: "Company",
    role: "Role",
    teamSize: "Team size",
    bugs: "What kind of bugs does your team struggle with?",
  },
  teamSizes: ["1–10", "11–50", "51–200", "201–1,000", "1,000+"],
  submit: "Send request",
  success: "Thanks. Your request is saved and we will be in touch.",
};
