"use client";

import { useRef, useState } from "react";
import { walkthrough } from "../content";
import { IconAbstain, IconArrow, IconCheck, IconEvidence, IconLock, Mark } from "./icons";

const SOURCES = [
  { label: "Jira", x: 70, y: 40 },
  { label: "GitHub", x: 70, y: 110 },
  { label: "Database", x: 70, y: 180 },
  { label: "Logs", x: 530, y: 60 },
  { label: "Docs", x: 530, y: 160 },
];

function Connect() {
  return (
    <div>
      <svg className="connect-svg" viewBox="0 0 600 230" role="img" aria-label="Five sources connect to Nexus. Every arrow points into Nexus; nothing is written back.">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" fill="var(--cyan)" />
          </marker>
        </defs>
        {SOURCES.map((s, i) => {
          const left = s.x < 300;
          const x1 = left ? s.x + 56 : s.x - 56;
          const x2 = left ? 232 : 368;
          const d = `M${x1} ${s.y} C ${(x1 + x2) / 2} ${s.y}, ${(x1 + x2) / 2} 115, ${x2} 115`;
          return (
            <g key={s.label}>
              <path d={d} fill="none" stroke="var(--border)" strokeWidth="1.5" />
              <path d={d} fill="none" stroke="var(--cyan)" strokeWidth="1.5" className="draw" style={{ ["--len" as string]: 260, animationDelay: `${0.15 * i}s` }} markerEnd="url(#arr)" />
              <path d={d} fill="none" stroke="var(--cyan)" strokeWidth="1.5" className="flow" opacity="0.5" />
              <rect x={s.x - 56} y={s.y - 17} width="112" height="34" rx="17" fill="var(--raised)" stroke="var(--border)" />
              <text x={s.x} y={s.y + 5} textAnchor="middle" fill="var(--text)" fontSize="13" fontFamily="var(--font-body)">
                {s.label}
              </text>
            </g>
          );
        })}
        <rect x="232" y="75" width="136" height="80" rx="16" fill="var(--surface)" stroke="var(--cobalt)" strokeWidth="1.5" />
        <text x="300" y="110" textAnchor="middle" fill="var(--text)" fontSize="16" fontWeight="600" fontFamily="var(--font-display)">
          Nexus
        </text>
        <text x="300" y="132" textAnchor="middle" fill="var(--muted)" fontSize="11" fontFamily="var(--font-code)">
          read-only
        </text>
      </svg>
      <ul className="mini connect-list stagger" style={{ listStyle: "none", padding: 0, margin: "0 0 10px" }} aria-hidden="true">
        {SOURCES.map((s) => (
          <li key={s.label} className="mini-row">
            <span>{s.label}</span>
            <span className="mono" style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--cyan)" }}>
              read <IconArrow className="i14" /> Nexus
            </span>
          </li>
        ))}
      </ul>
      <div className="mini-row" style={{ marginTop: 8 }}>
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="mono" style={{ color: "var(--cyan)" }}>
            PAY-1423
          </span>
          Checkout slows down under load
        </span>
        <span className="mono">Jira · read</span>
      </div>
    </div>
  );
}

function Trace() {
  const items = [
    { src: "Code", text: "Slow read runs while the lock is held", cite: "catalog/server.mjs:194–198" },
    { src: "Metric", text: "p95 93 ms → 651 ms under the same load", cite: "metric · incident run" },
    { src: "Log", text: "warn: mean lock wait 494 ms, 7 queued", cite: "log · catalog warn" },
    { src: "Schema", text: "products read path has no write lock of its own", cite: "db · table products" },
    { src: "Docs", text: "Catalog reads are expected to run in parallel", cite: "docs/catalog.md:12–18" },
  ];
  return (
    <ul className="mini stagger" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {items.map((item) => (
        <li key={item.cite} className="mini-row">
          <span style={{ display: "grid", gap: 2 }}>
            <span style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--muted)", fontSize: "var(--fs-xs)" }}>
              <IconEvidence className="i14" /> {item.src}
            </span>
            <span>{item.text}</span>
          </span>
          <span className="cite">{item.cite}</span>
        </li>
      ))}
    </ul>
  );
}

function Decide() {
  const rules = [
    ["Latency", "p95 ≥ 2× normal and +40 ms", "651 vs 93 ms"],
    ["Lock wait", "mean ≥ 25 ms and ≥ 4× normal", "494 vs 0 ms"],
    ["Queue", "≥ 3 waiters and above normal", "7 vs 0"],
  ];
  return (
    <div className="stagger">
      <table className="rule-table">
        <caption className="sr-only">Rules applied to the example. All three fired.</caption>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Threshold</th>
            <th scope="col">Observed</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {rules.map(([name, threshold, seen]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="mono">{threshold}</td>
              <td className="mono">{seen}</td>
              <td>
                <Mark kind="verified">Fired</Mark>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mini-row" style={{ marginTop: 16 }}>
        <span>Cause: exclusive lock held during the slow read</span>
        <Mark kind="verified">Verified</Mark>
      </div>
      <div className="mini-row" style={{ marginTop: 10 }}>
        <span>If any rule misses, Nexus abstains and lists what is missing.</span>
        <IconAbstain className="i14" />
      </div>
    </div>
  );
}

function Fix() {
  const [approved, setApproved] = useState(false);
  return (
    <div className="stagger">
      <div className="scene-block">
        <header>
          <span>catalog/server.mjs</span>
          <span>{approved ? "applied in sandbox" : "not applied"}</span>
        </header>
        <div className="diff">
          <div>
            <span aria-hidden="true"> </span>
            <span>const lock = await mutex.acquire();</span>
          </div>
          <div className="del">
            <span aria-hidden="true">-</span>
            <span>
              <span className="sr-only">Removed: </span>await sleep(scenario.workMs);
            </span>
          </div>
          <div>
            <span aria-hidden="true"> </span>
            <span>mutex.release();</span>
          </div>
          <div className="add">
            <span aria-hidden="true">+</span>
            <span>
              <span className="sr-only">Added: </span>await sleep(scenario.workMs);
            </span>
          </div>
        </div>
      </div>
      <div className="gate" data-state={approved ? "approved" : "waiting"}>
        <span className="gate-status">
          {approved ? <IconCheck className="i14" /> : <IconLock className="i14" />}
          <span>
            {approved ? "Approved. Measured again in the sandbox." : "Waiting for human approval"}
            <small>{approved ? "p95 651 → 84 ms. Example from the demo, not production." : "Nothing changes until an engineer approves."}</small>
          </span>
        </span>
        {approved ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setApproved(false)}>
            Reset
          </button>
        ) : (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setApproved(true)}>
            Approve fix
          </button>
        )}
      </div>
    </div>
  );
}

const PANELS = [Connect, Trace, Decide, Fix];

export function Walkthrough() {
  const [index, setIndex] = useState(0);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const stages = walkthrough.stages;
  const Panel = PANELS[index];

  function go(next: number, focus = false) {
    const clamped = (next + stages.length) % stages.length;
    setIndex(clamped);
    if (focus) tabsRef.current[clamped]?.focus();
  }

  return (
    <section className="section" aria-labelledby="walk-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="walk-title">{walkthrough.headline}</h2>
          <p>{walkthrough.intro}</p>
        </div>
        <div className="walk">
          <div role="tablist" aria-label="Investigation stages" className="walk-tabs" aria-orientation="vertical">
            {stages.map((stage, i) => (
              <button
                key={stage.id}
                ref={(node) => {
                  tabsRef.current[i] = node;
                }}
                role="tab"
                id={`walk-tab-${stage.id}`}
                aria-selected={i === index}
                aria-controls="walk-panel"
                tabIndex={i === index ? 0 : -1}
                className="walk-tab"
                onClick={() => go(i)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                    event.preventDefault();
                    go(i + 1, true);
                  } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    go(i - 1, true);
                  }
                }}
              >
                <span className="n">0{i + 1}</span>
                <span className="t">{stage.title}</span>
                <span className="b">{stage.body}</span>
              </button>
            ))}
          </div>
          <div className="panel walk-stage" role="tabpanel" id="walk-panel" aria-labelledby={`walk-tab-${stages[index].id}`}>
            <div className="window-bar">
              <span className="example-label">{walkthrough.label}</span>
            </div>
            <div className="stage-body">
              <p className="sr-only">{stages[index].body}</p>
              <div key={index} className="panel-swap">
                <Panel />
              </div>
            </div>
            <div className="walk-controls">
              <span className="count">
                {index + 1} / {stages.length} · {stages[index].title}
              </span>
              <div className="btns">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => go(index - 1)} disabled={index === 0}>
                  Back
                </button>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => go(index + 1)} disabled={index === stages.length - 1}>
                  Next <IconArrow className="i14" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <p className="int-caption" style={{ fontSize: "var(--fs-small)" }}>
          {walkthrough.note}
        </p>
      </div>
    </section>
  );
}
