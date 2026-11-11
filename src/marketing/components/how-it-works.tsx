"use client";

import { useRef } from "react";
import { howItWorks } from "../content";
import { useActiveIndex } from "../hooks";
import { IconAbstain, IconCheck, IconEvidence, IconLock, Mark } from "./icons";

function StepVisual({ index }: { index: number }) {
  switch (index) {
    case 0:
      return (
        <div className="mini">
          <div className="mini-row">
            <span>PAY-1423 · Checkout slows down under load</span>
            <span className="mono">Jira</span>
          </div>
          <div className="mini-row">
            <span>Detail</span>
            <Mark kind="verified">Enough to investigate</Mark>
          </div>
          <div className="mini-row">
            <span>NEX-7 · Some users see wrong cart totals</span>
            <Mark kind="abstain">Too thin</Mark>
          </div>
        </div>
      );
    case 1:
      return (
        <div className="mini bars" aria-label="Example from the demo: p95 latency, normal versus broken">
          <div className="bar">
            <span>Normal p95</span>
            <span className="track">
              <span className="fill base" style={{ display: "block", width: "14%" }} />
            </span>
            <span className="v">93 ms</span>
          </div>
          <div className="bar">
            <span>Broken p95</span>
            <span className="track">
              <span className="fill inc" style={{ display: "block", width: "100%" }} />
            </span>
            <span className="v">651 ms</span>
          </div>
          <span className="example-label">Same load: 32 requests, 8 at a time. Example from the demo.</span>
        </div>
      );
    case 2:
      return (
        <div className="mini">
          {[
            ["Metric", "metric · incident run"],
            ["Log line", "log · catalog warn"],
            ["Code", "catalog/server.mjs:194–198"],
            ["Trace", "trace · lock wait span"],
          ].map(([what, cite]) => (
            <div className="mini-row" key={cite}>
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <IconEvidence className="i14" />
                {what}
              </span>
              <span className="cite">{cite}</span>
            </div>
          ))}
        </div>
      );
    case 3:
      return (
        <div className="mini">
          {[
            ["p95 ≥ 2× normal and +40 ms", "651 vs 93"],
            ["mean lock wait ≥ 25 ms and ≥ 4× normal", "494 vs 0"],
            ["lock queue ≥ 3 and above normal", "7 vs 0"],
          ].map(([rule, seen]) => (
            <div className="mini-row" key={rule}>
              <span className="mono" style={{ color: "var(--text)" }}>
                {rule}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="mono">{seen}</span>
                <IconCheck className="i14" />
              </span>
            </div>
          ))}
          <div className="mini-row">
            <span>All three fired</span>
            <Mark kind="verified">Verified</Mark>
          </div>
        </div>
      );
    case 4:
      return (
        <div className="mini">
          <div className="mini-row">
            <span>Move the slow read outside the lock</span>
            <span className="mono">not applied</span>
          </div>
          <div className="mini-row">
            <span>Proposals exist only for a confirmed cause</span>
            <IconAbstain className="i14" />
          </div>
        </div>
      );
    case 5:
      return (
        <div className="mini">
          <div className="mini-row" style={{ borderStyle: "dashed", borderColor: "color-mix(in srgb, var(--amber) 55%, var(--border))" }}>
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <IconLock className="i14" /> Waiting for human approval
            </span>
            <span className="mono">gate closed</span>
          </div>
          <div className="mini-row">
            <span>Approved by</span>
            <span className="mono">an engineer, recorded</span>
          </div>
        </div>
      );
    default:
      return (
        <div className="mini bars" aria-label="Example from the demo: p95 latency before and after the sandbox fix">
          <div className="bar">
            <span>Broken p95</span>
            <span className="track">
              <span className="fill inc" style={{ display: "block", width: "100%" }} />
            </span>
            <span className="v">651 ms</span>
          </div>
          <div className="bar">
            <span>After fix</span>
            <span className="track">
              <span className="fill fixed" style={{ display: "block", width: "13%" }} />
            </span>
            <span className="v">84 ms</span>
          </div>
          <span className="example-label">Sandbox re-run. Example from the demo, not production.</span>
        </div>
      );
  }
}

export function HowItWorks() {
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const active = useActiveIndex(refs, howItWorks.steps.length);
  const step = howItWorks.steps[active];

  return (
    <section className="section section--quiet" id="how-it-works" aria-labelledby="how-title">
      <div className="wrap grid steps-grid">
        <div className="section-head">
          <h2 id="how-title">{howItWorks.headline}</h2>
          <p>{howItWorks.intro}</p>
        </div>
        <ol className="steps-list">
          {howItWorks.steps.map((s, i) => (
            <li
              key={s.title}
              ref={(node) => {
                refs.current[i] = node;
              }}
              className={`step${i === active ? " is-active" : ""}`}
              aria-current={i === active ? "step" : undefined}
            >
              <span className="num" aria-hidden="true">
                {i + 1}
              </span>
              <h3>
                <span className="sr-only">Step {i + 1}: </span>
                {s.title}
              </h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="steps-panel-col" aria-hidden="true">
          <div className="panel steps-panel">
            <div className="window-bar">
              <div className="window-dots">
                <i />
                <i />
                <i />
              </div>
              <span>Step {active + 1} of 7</span>
            </div>
            <div className="stage panel-swap" key={active}>
              <div className="tool-line">
                <span>tool</span>
                <b>{step.tool}</b>
              </div>
              <h3 style={{ marginTop: 12, fontSize: "var(--fs-h3)" }}>{step.title}</h3>
              <StepVisual index={active} />
            </div>
            <div className="step-meter">
              {howItWorks.steps.map((s, i) => (
                <i key={s.tool} className={i <= active ? "is-on" : ""} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
