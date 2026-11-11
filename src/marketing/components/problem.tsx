"use client";

import { useRef } from "react";
import { problem } from "../content";
import { useActiveIndex } from "../hooks";

export function Problem() {
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const active = useActiveIndex(refs, problem.beats.length);
  const segments = ["s1", "s2", "s3"];

  return (
    <section className="section" id="product" aria-labelledby="problem-title">
      <div className="wrap grid problem-grid">
        <div className="problem-copy">
          <h2 id="problem-title">{problem.headline}</h2>
          <ol className="beats">
            {problem.beats.map((beat, i) => (
              <li
                key={beat.title}
                ref={(node) => {
                  refs.current[i] = node;
                }}
                className={`beat${i === active ? " is-active" : ""}${i < active ? " is-past" : ""}`}
              >
                <h3>{beat.title}</h3>
                <p>{beat.body}</p>
              </li>
            ))}
          </ol>
          <p className="problem-close">{problem.close}</p>
        </div>

        <figure className="panel problem-visual" aria-labelledby="problem-chart-caption">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
            <strong style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", letterSpacing: "-0.02em" }}>Where the hours go</strong>
            <span className="example-label">{problem.chartNote}</span>
          </div>
          <div className="timebar" role="img" aria-label="Illustration: reproducing, digging and comparing take most of the time. The fix itself is a thin slice at the end.">
            {segments.map((s, i) => (
              <span key={s} className={`${s}${i <= active ? " is-on" : ""}`} />
            ))}
            <span className={`s4${active >= 2 ? " is-on" : ""}`} />
          </div>
          <div className="timebar-legend" aria-hidden="true">
            <span>
              <i style={{ background: "color-mix(in srgb, var(--cobalt) 45%, var(--surface))" }} /> Reproduce
            </span>
            <span>
              <i style={{ background: "color-mix(in srgb, var(--cobalt) 30%, var(--surface))" }} /> Dig
            </span>
            <span>
              <i style={{ background: "color-mix(in srgb, var(--cobalt) 18%, var(--surface))" }} /> Compare
            </span>
            <span>
              <i style={{ background: "var(--teal)" }} /> Fix
            </span>
          </div>
          <figcaption id="problem-chart-caption" style={{ marginTop: 24, color: "var(--muted)", fontSize: "var(--fs-small)", maxWidth: "46ch" }}>
            The fix is often a few lines. Proving which few lines takes the time.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
