export type PhaseName = "baseline" | "incident" | "validation" | "outage";

export type ScenarioName = "lock" | "outage";

export type Distribution = {
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
};

export type Summary = {
  requests: number;
  success: number;
  errors: number;
  timeouts: number;
  latencyMs: Distribution | null;
  lockWaitMs: Distribution | null;
  lockHoldMs: Distribution | null;
  maxQueueDepth: number | null;
};

export type Sample = {
  index: number;
  phase: PhaseName;
  productId: string;
  status: number;
  latencyMs: number;
  error: string | null;
  traceId: string | null;
  logId: string | null;
  lockWaitMs: number | null;
  lockHoldMs: number | null;
  queueDepth: number | null;
  serverDurationMs: number | null;
  mode: string | null;
  completedAt: string;
};

export type TimelineEntry = {
  id: string;
  at: string;
  title: string;
  detail: string;
};

export type TailEntry = {
  at: string;
  phase: PhaseName;
  text: string;
};

export type RuleResult = {
  id: string;
  title: string;
  fired: boolean;
  threshold: string;
  observed: string;
};

export type Citation = {
  evidenceId: string;
  reason: string;
};

export type Proposal = {
  id: string;
  status: "not_applied" | "applied_in_sandbox";
  title: string;
  summary: string;
  sandboxChange: string;
  validationPlan: string[];
  boundary: string;
};

export type DiagnosisOutcome =
  | "lock_contention"
  | "no_signal"
  | "insufficient_evidence"
  | "service_unavailable";

export type Diagnosis = {
  method: "rule-based-sandbox";
  methodLabel: "Rule-based sandbox demonstration — not live model inference";
  rulesModule: "src/lib/diagnosis.ts";
  outcome: DiagnosisOutcome;
  title: string;
  summary: string;
  rules: RuleResult[];
  citations: Citation[];
  uncertainties: string[];
  proposal: Proposal | null;
};

export type ValidationCheck = {
  id: string;
  title: string;
  passed: boolean;
  observed: string;
};

export type ValidationResult = {
  method: "rule-based-sandbox";
  outcome: "sandbox_improved" | "inconclusive";
  statement: string;
  checks: ValidationCheck[];
};

export type EvidenceType = "trace" | "log" | "metric" | "source";

export type EvidenceOrigin = "executed-sandbox" | "workspace-source";

export type EvidenceIndexItem = {
  id: string;
  type: EvidenceType;
  title: string;
  origin: EvidenceOrigin;
};

export type EvidenceRecord = EvidenceIndexItem & {
  runId: string;
  createdAt: string;
  body: unknown;
};

export type PhaseResult = {
  startedAt: string;
  finishedAt: string;
  summary: Summary;
  samples: Sample[];
};

export type LoadProfile = {
  requests: number;
  concurrency: number;
  timeoutMs: number;
};

export type RunStatus = "running" | "diagnosed" | "validating" | "validated" | "failed";

export type TicketDetail = "sufficient" | "sparse" | "unavailable";

export type TicketFallback = "none" | "seeded-scenario";

export type SandboxScenario = "lock" | "outage" | "ask-for-info";

export type EngineTicket = {
  id: string;
  source: "seeded" | "jira" | "jira-unconfigured" | "jira-not-found" | "jira-error";
  kind: string;
  title: string;
  service: string;
  openedAt: string;
  severity: string;
  reporter: string;
  symptom: string;
  ask: string;
  disclaimer: string;
  issueType: string | null;
  projectKey: string | null;
  detail: TicketDetail;
  fallback: TicketFallback;
  sandboxScenario: SandboxScenario | null;
  labels: string[];
  readOnly: true;
};

export type RunRecord = {
  id: string;
  scenario: ScenarioName;
  ticket?: EngineTicket | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  progress: { phase: string; completed: number; total: number } | null;
  timeline: TimelineEntry[];
  tail: TailEntry[];
  baseline: PhaseResult | null;
  incident: PhaseResult | null;
  validation: PhaseResult | null;
  outage: PhaseResult | null;
  diagnosis: Diagnosis | null;
  validationResult: ValidationResult | null;
  validationError: string | null;
  error: string | null;
  evidence: EvidenceIndexItem[];
  profile: LoadProfile & { workMs: number };
};
