"use client";

import { useEffect, useRef, useState } from "react";
import { ide } from "../content";
import { useInView, useReducedMotion } from "../hooks";
import { IconReplay, Mark } from "./icons";

const QUERY = "PAY-1423";
const CODE = [
  { n: 189, t: "const acquired = state.mutex.tryAcquire()" },
  { n: 190, t: "  ?? (await state.mutex.acquire());" },
  { n: 193, t: "try {" },
  { n: 194, t: '  if (spec.workPlacement === "inside-lock") {', hot: true },
  { n: 198, t: "    await sleep(scenario.workMs);", hot: true },
  { n: 199, t: "  }" },
  { n: 200, t: "} finally {" },
  { n: 202, t: "  state.mutex.release();" },
  { n: 203, t: "}" },
];

export function IdeMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, threshold: 0.35 });
  const reduced = useReducedMotion();
  const [typed, setTyped] = useState(0);
  const [result, setResult] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (reduced) {
      setTyped(QUERY.length);
      setResult(true);
      return;
    }
    if (!inView) return;
    const timers: number[] = [];
    for (let i = 1; i <= QUERY.length; i += 1) timers.push(window.setTimeout(() => setTyped(i), 500 + i * 110));
    timers.push(window.setTimeout(() => setResult(true), 500 + QUERY.length * 110 + 900));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [inView, reduced, run]);

  return (
    <section className="section" aria-labelledby="ide-title">
      <div className="wrap grid ide-grid">
        <div className="ide-copy">
          <Mark kind="planned">{ide.badge}</Mark>
          <h2 id="ide-title" style={{ marginTop: 18 }}>
            {ide.headline}
          </h2>
          <p className="lead">{ide.body}</p>
          <p className="note">{ide.note}</p>
        </div>
        <div className="ide-col" ref={ref}>
          <div className={`panel ide${result ? " is-result" : ""}`}>
            <p className="sr-only">
              Mock-up, not an available product: an editor with a command palette where PAY-1423 is typed. The result opens beside the code, with lines 194 and 198 highlighted as cited evidence.
            </p>
            <div className="window-bar">
              <div className="window-dots">
                <i />
                <i />
                <i />
              </div>
              <span>catalog/server.mjs</span>
              <span style={{ marginLeft: "auto" }}>Mock-up · {ide.badge}</span>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 28, height: 28 }}
                aria-label="Replay the editor mock-up"
                onClick={() => {
                  setTyped(0);
                  setResult(false);
                  setRun((r) => r + 1);
                }}
              >
                <IconReplay />
              </button>
            </div>
            <div className="ide-body" aria-hidden="true">
              <div className="ide-code">
                {CODE.map((line) => (
                  <div key={line.n} className={line.hot ? "hot" : ""}>
                    <span>{line.n}</span>
                    <span>{line.t}</span>
                  </div>
                ))}
              </div>
              <div className="ide-result">
                <p style={{ fontFamily: "var(--font-code)", fontSize: "0.75rem", color: "var(--cyan)" }}>Nexus · PAY-1423</p>
                <p style={{ marginTop: 8, fontWeight: 600 }}>Exclusive lock held during the slow read</p>
                <div style={{ marginTop: 10 }}>
                  <Mark kind="verified">Verified</Mark>
                </div>
                <p style={{ marginTop: 12, color: "var(--muted)", fontSize: "var(--fs-xs)" }}>Cited: lines 194, 198 · metric · log</p>
                <p style={{ marginTop: 12, color: "var(--muted)", fontSize: "var(--fs-xs)" }}>Fix waits for your approval.</p>
              </div>
              <div className="palette" aria-hidden="true">
                <div className="input">
                  &gt; Nexus: Investigate ticket {QUERY.slice(0, typed)}
                  {typed < QUERY.length ? <span className="caret" /> : null}
                </div>
                <div className="opt sel">Nexus: Investigate ticket</div>
                <div className="opt">Nexus: Show evidence</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
