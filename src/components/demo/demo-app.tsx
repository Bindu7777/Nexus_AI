"use client";

import { useEffect, useState } from "react";
import { clock } from "@/components/demo/format";
import { EvidenceDialog } from "@/components/demo/evidence-dialog";
import { Measurements, OutageMeasurements } from "@/components/demo/measurements";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EvidenceRecord, RunRecord } from "@/lib/types";
import { scenario } from "@/lib/scenario";
import { seededTicket } from "@/lib/ticket";

type Health = {
  ok: boolean;
  catalogUrl: string;
  catalog: { ok?: boolean; mode?: string; error?: string; workPlacement?: string };
};

type Busy = "investigate" | "outage" | "validate" | "reset" | null;

function Mark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#d4784a" />
      <path d="M8 23 L16 8 L24 23" fill="none" stroke="#172230" strokeWidth="1.7" />
      <circle cx="8" cy="23" r="2.1" fill="#f6f1e7" />
      <circle cx="24" cy="23" r="2.1" fill="#f6f1e7" />
      <circle cx="16" cy="8" r="2.1" fill="#172230" />
      <circle cx="16" cy="18" r="2.1" fill="#f6f1e7" />
    </svg>
  );
}

function stepState(run: RunRecord | null, busy: Busy) {
  const running = run?.status === "running" || busy === "investigate" || busy === "outage";
  const diagnosed = Boolean(run?.diagnosis);
  const proposed = Boolean(run?.diagnosis?.proposal);
  const validating = run?.status === "validating" || busy === "validate";
  const validated = run?.status === "validated";
  return [
    { id: "intake", label: "Intake", detail: "Seeded ticket", state: "complete" as const },
    {
      id: "collect",
      label: "Collect",
      detail: "Live sandbox load",
      state: running ? "current" : diagnosed || run?.baseline || run?.outage ? "complete" : "upcoming",
    },
    {
      id: "diagnose",
      label: "Diagnose",
      detail: "Rules on this run",
      state: diagnosed ? "complete" : running ? "upcoming" : "upcoming",
    },
    {
      id: "review",
      label: "Review",
      detail: proposed ? "Engineer gate" : "No proposal yet",
      state: !proposed ? "upcoming" : validated ? "complete" : diagnosed ? "current" : "upcoming",
    },
    {
      id: "validate",
      label: "Validate",
      detail: "Sandbox only",
      state: validated ? "complete" : validating ? "current" : "upcoming",
    },
  ];
}

export function DemoApp() {
  const [health, setHealth] = useState<Health | null>(null);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRecord | null>(null);
  const [tailExpanded, setTailExpanded] = useState(false);

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (!stop && response.ok) setHealth((await response.json()) as Health);
      } catch {
        if (!stop) setHealth(null);
      }
    }
    void pull();
    const timer = setInterval(pull, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!activeRunId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pull = async () => {
      try {
        const response = await fetch(`/api/runs/${activeRunId}`, { cache: "no-store" });
        if (stop) return;
        if (!response.ok) {
          setError("The investigation record disappeared from this session.");
          setBusy(null);
          return;
        }
        const next = (await response.json()) as RunRecord;
        if (stop) return;
        setRun(next);
        if (next.status === "running" || next.status === "validating") {
          timer = setTimeout(pull, 250);
        } else {
          setBusy(null);
        }
      } catch (pullError) {
        if (stop) return;
        setError(pullError instanceof Error ? pullError.message : "Lost contact with the demo server.");
        setBusy(null);
      }
    };
    void pull();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeRunId, pollKey]);

  async function start(kind: "lock" | "outage") {
    setBusy(kind === "lock" ? "investigate" : "outage");
    setError(null);
    setApproved(false);
    setRun(null);
    try {
      const response = await fetch("/api/investigate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: kind }),
      });
      const payload = (await response.json()) as { runId?: string; message?: string };
      if (!response.ok || !payload.runId) throw new Error(payload.message ?? "Could not start the investigation.");
      setActiveRunId(payload.runId);
      setPollKey((value) => value + 1);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start the investigation.");
      setBusy(null);
    }
  }

  async function validate() {
    if (!run) return;
    setConfirmOpen(false);
    setBusy("validate");
    setError(null);
    try {
      const response = await fetch("/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: run.id, confirmation: "APPLY_SANDBOX_REMEDIATION" }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "The sandbox rejected the confirmation.");
      setPollKey((value) => value + 1);
    } catch (validateError) {
      setError(validateError instanceof Error ? validateError.message : "Validation failed.");
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    setError(null);
    try {
      const response = await fetch("/api/reset", { method: "POST" });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Reset failed.");
      setRun(null);
      setActiveRunId(null);
      setApproved(false);
      setEvidence(null);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Reset failed.");
    } finally {
      setBusy(null);
    }
  }

  async function openEvidence(id: string) {
    setEvidenceOpen(true);
    setEvidence(null);
    setEvidenceError(null);
    setEvidenceLoading(true);
    try {
      const response = await fetch(`/api/evidence?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = (await response.json()) as EvidenceRecord & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "The evidence record could not be loaded.");
      setEvidence(payload);
    } catch (loadError) {
      setEvidenceError(loadError instanceof Error ? loadError.message : "The evidence record could not be loaded.");
    } finally {
      setEvidenceLoading(false);
    }
  }

  const steps = stepState(run, busy);
  const catalogUp = health?.catalog.ok !== false && health?.ok !== false && health != null;
  const running = busy === "investigate" || busy === "outage" || busy === "validate" || run?.status === "running" || run?.status === "validating";
  const progress = run?.progress
    ? `${run.progress.phase} ${run.progress.completed}/${run.progress.total}`
    : busy
      ? "starting"
      : null;
  const tail = run?.tail ?? [];
  const visibleTail = tailExpanded ? tail : tail.slice(-8);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="bg-[#172230] text-[#f6f1e7] lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center gap-3 px-5 py-5">
          <Mark />
          <div>
            <div className="font-display text-xl leading-none">Nexus</div>
            <div className="mt-1 text-[11px] tracking-[0.16em] text-[#d7c4a8] uppercase">Intelligence</div>
          </div>
        </div>
        <p className="px-5 text-sm text-[#e7d7c3]">More time for product</p>
        <nav className="mt-6 space-y-1 px-3" aria-label="Investigation stages">
          {steps.map((step, index) => (
            <div key={step.id} className="flex gap-3 rounded-lg px-2 py-2">
              <div
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${
                  step.state === "complete"
                    ? "bg-[#d4784a] text-[#172230]"
                    : step.state === "current"
                      ? "bg-[#f6f1e7] text-[#172230]"
                      : "border border-[#6d7c8c] text-[#9aabbc]"
                }`}
              >
                {index + 1}
              </div>
              <div>
                <div className="text-sm">{step.label}</div>
                <div className="text-xs text-[#9aabbc]">{step.detail}</div>
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-6 space-y-2 px-5 text-sm">
          <div className="text-[11px] tracking-[0.14em] text-[#d7c4a8] uppercase">Integration readiness</div>
          <StatusRow label="Jira" value="Not connected" />
          <StatusRow label="Model" value="Not connected" />
          <StatusRow label="Catalog sandbox" value={health == null ? "Checking" : catalogUp ? "Live" : "Unreachable"} />
          <StatusRow label="External writes" value="Disabled" />
        </div>
        <div className="space-y-2 px-5 py-6">
          <Button
            className="h-10 w-full bg-[#d4784a] text-[#172230] hover:bg-[#e3a27a]"
            disabled={running || busy === "reset"}
            onClick={() => start("lock")}
          >
            {busy === "investigate" || run?.status === "running"
              ? progress && progress !== "starting"
                ? `Running ${progress}`
                : "Starting the load…"
              : "Run investigation"}
          </Button>
          <Button
            variant="outline"
            className="h-10 w-full border-[#6d7c8c] bg-transparent text-[#f6f1e7] hover:bg-[#24364a] hover:text-[#f6f1e7]"
            disabled={running || busy === "reset"}
            onClick={() => start("outage")}
          >
            {busy === "outage" ? "Running outage" : "Simulate catalog outage"}
          </Button>
          <Button
            variant="ghost"
            className="h-10 w-full text-[#e7d7c3] hover:bg-[#24364a] hover:text-[#f6f1e7]"
            disabled={running || busy === "reset"}
            onClick={reset}
          >
            {busy === "reset" ? "Resetting" : "Reset scenario"}
          </Button>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="border-b border-[#e0d3bf] bg-[#f7f1e6]/90 px-4 py-3 text-sm text-[#3d342b] sm:px-6">
          Sandbox demonstration. Logs, traces, and metrics on this page are collected from the catalog process running
          beside this app. The ticket is a seeded example. Diagnosis is a deterministic rule set, not a model call.
          Jira and model providers are not connected. Nothing on this page writes outside the sandbox.
        </div>
        <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
          <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs tracking-[0.14em] text-[#8a5a12] uppercase">Defect investigation</p>
              <h1 className="font-display text-3xl text-[#1b2836] sm:text-4xl">{scenario.name}</h1>
              <p className="mt-2 max-w-3xl text-sm text-[#5c5348]">{scenario.inspiration}</p>
            </div>
            <div className="text-sm text-[#5c5348]">
              <div>
                Catalog{" "}
                <span className="font-mono text-[#1c1915]">
                  {health?.catalog.mode ?? (catalogUp ? "baseline" : "down")}
                </span>
              </div>
              <div className="font-mono text-xs">{health?.catalogUrl ?? "http://127.0.0.1:4318"}</div>
            </div>
          </header>

          <p className="sr-only" aria-live="polite">
            {run?.status === "running" || run?.status === "validating"
              ? `Sandbox ${progress ?? run.status}`
              : run?.diagnosis
                ? run.diagnosis.title
                : "Waiting to collect sandbox evidence"}
          </p>

          {health && !catalogUp ? (
            <Alert variant="destructive">
              <AlertTitle>Catalog sandbox is unreachable</AlertTitle>
              <AlertDescription>
                {health.catalog.error ?? "The demo server could not call the local catalog."} Start it with npm run demo,
                then use Reset scenario.
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>The demo hit an error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {run?.status === "failed" && run.error ? (
            <Alert variant="destructive">
              <AlertTitle>Investigation stopped</AlertTitle>
              <AlertDescription>
                {run.error} Partial timeline entries below are the steps that actually ran. Run investigation tries the
                scenario again.
              </AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Seeded example</Badge>
                <Badge variant="secondary">{seededTicket.id}</Badge>
                <Badge variant="secondary">{seededTicket.severity}</Badge>
              </div>
              <CardTitle className="font-display text-2xl">{seededTicket.title}</CardTitle>
              <CardDescription>{seededTicket.disclaimer}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Opened</dt>
                  <dd>{seededTicket.openedAt}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Service</dt>
                  <dd>{seededTicket.service}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Reporter</dt>
                  <dd>{seededTicket.reporter}</dd>
                </div>
              </dl>
              <p className="text-sm leading-6">{seededTicket.symptom}</p>
              <p className="text-sm leading-6">{seededTicket.ask}</p>
              <div className="rounded-lg border border-dashed border-[#d9cbb6] bg-[#f8f3ea] p-3 text-sm">
                <div className="font-medium">What Run investigation executes</div>
                <p className="mt-1 text-[#5c5348]">
                  {scenario.load.requests} GET /products/:id calls, concurrency {scenario.load.concurrency}, timeout{" "}
                  {scenario.load.timeoutMs} ms. First in baseline mode, then the same load in incident mode. The read
                  timer is {scenario.workMs} ms in both modes. Baseline runs it after releasing the lock. Incident runs
                  it while holding the lock. No request is sent off this machine.
                </p>
              </div>
            </CardContent>
          </Card>

          {!run ? (
            <Card>
              <CardHeader>
                <CardTitle>No sandbox measurements yet</CardTitle>
                <CardDescription>
                  Run the investigation to collect a baseline load and an incident load from the catalog process. The
                  table stays empty until those calls return.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {run && (run.status === "running" || run.status === "validating" || tail.length > 0) ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>
                  {run.status === "validating"
                    ? "Validation load"
                    : run.status === "running"
                      ? "Live collection"
                      : "Request log"}
                </CardTitle>
                  <Badge variant="outline">{progress ?? run.status}</Badge>
                </div>
                <CardDescription>
                  Each line is appended when a catalog response returns. This is the load runner’s record, not a timed
                  animation.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="max-h-64 space-y-1 overflow-auto font-mono text-xs leading-5">
                  {visibleTail.length === 0 ? <li className="text-muted-foreground">Waiting for the first response…</li> : null}
                  {visibleTail.map((entry, index) => (
                    <li key={`${entry.at}-${index}`}>
                      <span className="text-muted-foreground">{clock(entry.at)} </span>
                      {entry.text}
                    </li>
                  ))}
                </ol>
                {tail.length > 8 ? (
                  <Button variant="ghost" className="mt-2 px-0" onClick={() => setTailExpanded((value) => !value)}>
                    {tailExpanded ? "Show the latest lines" : `Show all ${tail.length} lines`}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {run?.scenario === "lock" && (run.baseline || run.incident) ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap gap-2">
                  <Badge>Executed sandbox telemetry</Badge>
                  <Badge variant="outline">This run only</Badge>
                </div>
                <CardTitle className="font-display text-2xl">Baseline and incident</CardTitle>
                <CardDescription>
                  Same load profile. The only change between the columns is where the {scenario.workMs} ms read sits
                  relative to the lock.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Measurements
                  baseline={run.baseline?.summary ?? null}
                  incident={run.incident?.summary ?? null}
                  validation={run.validation?.summary ?? null}
                />
              </CardContent>
            </Card>
          ) : null}

          {run?.outage ? (
            <Card>
              <CardHeader>
                <Badge variant="destructive">Executed sandbox telemetry</Badge>
                <CardTitle className="font-display text-2xl">Outage collection</CardTitle>
                <CardDescription>
                  These counts come from calls made after the outage control set the catalog to unavailable.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OutageMeasurements summary={run.outage.summary} />
              </CardContent>
            </Card>
          ) : null}

          {run?.diagnosis ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Rule-based sandbox demonstration</Badge>
                  <Badge variant="secondary">Not live model inference</Badge>
                </div>
                <CardTitle className="font-display text-2xl">{run.diagnosis.title}</CardTitle>
                <CardDescription>
                  {run.diagnosis.methodLabel}. Rules in {run.diagnosis.rulesModule}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm leading-6">{run.diagnosis.summary}</p>
                <div>
                  <h2 className="text-sm font-medium">Rules</h2>
                  <ul className="mt-2 space-y-2">
                    {run.diagnosis.rules.map((rule) => (
                      <li key={rule.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={rule.fired ? "default" : "outline"}>{rule.fired ? "Fired" : "Did not fire"}</Badge>
                          <span className="font-medium">{rule.title}</span>
                        </div>
                        <p className="mt-1 text-[#5c5348]">{rule.observed}</p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">{rule.threshold}</p>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h2 className="text-sm font-medium">Evidence cited by the rules</h2>
                  {run.diagnosis.citations.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">This outcome did not cite a record.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {run.diagnosis.citations.map((citation) => (
                        <li key={citation.evidenceId}>
                          <button
                            type="button"
                            className="w-full rounded-lg border border-border bg-[#fbf7f0] px-3 py-2 text-left text-sm hover:border-[#b8612f]"
                            onClick={() => openEvidence(citation.evidenceId)}
                          >
                            <span className="block font-mono text-xs text-[#8a5a12]">{citation.evidenceId}</span>
                            <span className="mt-1 block">{citation.reason}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h2 className="text-sm font-medium">Uncertainties</h2>
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-[#3d342b]">
                    {run.diagnosis.uncertainties.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                {run.evidence.length > 0 ? (
                  <details className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      All {run.evidence.length} records stored for this run
                    </summary>
                    <ul className="mt-3 max-h-64 space-y-1 overflow-auto">
                      {run.evidence.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="w-full rounded px-2 py-1 text-left text-sm hover:bg-[#f3eadb]"
                            onClick={() => openEvidence(item.id)}
                          >
                            <span className="font-mono text-xs text-muted-foreground">{item.type}</span> {item.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {run?.diagnosis?.proposal ? (
            <Card className="border-[#b8612f]/50">
              <CardHeader>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Proposal — not a production fix</Badge>
                  <Badge variant="secondary">
                    {run.diagnosis.proposal.status === "applied_in_sandbox" ? "Applied in this sandbox" : "Not applied"}
                  </Badge>
                </div>
                <CardTitle className="font-display text-2xl">{run.diagnosis.proposal.title}</CardTitle>
                <CardDescription>{run.diagnosis.proposal.boundary}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6">{run.diagnosis.proposal.summary}</p>
                <p className="font-mono text-xs leading-5">{run.diagnosis.proposal.sandboxChange}</p>
                <div>
                  <h2 className="text-sm font-medium">Validation plan</h2>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6">
                    {run.diagnosis.proposal.validationPlan.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-lg border border-[#b8612f]/40 bg-[#fbf4ec] p-4">
                  <h2 className="font-medium">Engineer review boundary</h2>
                  <p className="mt-1 text-sm leading-6 text-[#3d342b]">
                    Confirming runs the remediated behavior on the local catalog and repeats the load. It does not open
                    a pull request, write to Jira, call a model, or change any system outside this process.
                  </p>
                  <label className="mt-3 flex items-start gap-3 text-sm">
                    <Checkbox
                      checked={approved}
                      disabled={running}
                      onCheckedChange={(checked) => setApproved(checked === true)}
                    />
                    <span>I reviewed the evidence and want this sandbox to apply the remediated behavior and rerun the load.</span>
                  </label>
                  <Button className="mt-3 h-10" disabled={!approved || running} onClick={() => setConfirmOpen(true)}>
                    Apply in sandbox and validate
                  </Button>
                  {run.validationError ? <p className="mt-3 text-sm text-destructive">{run.validationError}</p> : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {run?.validationResult ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Sandbox check</Badge>
                  <Badge>{run.validationResult.outcome === "sandbox_improved" ? "Improved in this sandbox" : "Inconclusive"}</Badge>
                </div>
                <CardTitle className="font-display text-2xl">Validation result</CardTitle>
                <CardDescription>Rule-based comparison of this validation load with the incident load. Not a production verification.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-6">{run.validationResult.statement}</p>
                <ul className="space-y-2">
                  {run.validationResult.checks.map((check) => (
                    <li key={check.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <Badge variant={check.passed ? "default" : "destructive"}>{check.passed ? "Passed" : "Missed"}</Badge>
                      <span className="ml-2 font-medium">{check.title}</span>
                      <p className="mt-1 text-[#5c5348]">{check.observed}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {run ? (
            <Card>
              <CardHeader>
                <CardTitle>Investigation timeline</CardTitle>
                <CardDescription>Timestamps are taken when each step finishes in this process. Run {run.id}.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4 border-l border-[#e0d3bf] pl-4">
                  {run.timeline.map((entry) => (
                    <li key={entry.id}>
                      <div className="font-mono text-xs text-muted-foreground">{clock(entry.at)}</div>
                      <div className="text-sm font-medium">{entry.title}</div>
                      <p className="text-sm text-[#5c5348]">{entry.detail}</p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          <footer className="pb-8 text-sm text-[#5c5348]">
            Nexus Intelligence · More time for product · Local sandbox, not a customer environment
          </footer>
        </main>
      </div>

      <EvidenceDialog
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        loading={evidenceLoading}
        error={evidenceError}
        record={evidence}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply the change in this sandbox?</DialogTitle>
            <DialogDescription>
              This sets the local catalog to remediated mode and repeats the same load. It does not write to Jira, git,
              or any other system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={validate}>Apply and validate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-[#c9d3dc]">{label}</span>
      <span className="text-right text-[#f6f1e7]">{value}</span>
    </div>
  );
}
