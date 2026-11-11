"use client";

import { useState } from "react";
import { evidence } from "../content";
import { IconAbstain, IconCheck, IconX, Mark } from "./icons";

export function Evidence() {
  const [value, setValue] = useState<"clear" | "unclear">("clear");
  const { clear, unclear } = evidence.toggle;

  function onKey(event: React.KeyboardEvent) {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      setValue((v) => (v === "clear" ? "unclear" : "clear"));
    }
  }

  return (
    <section className="section section--quiet" aria-labelledby="evidence-title">
      <div className="wrap grid ev-grid">
        <div className="section-head">
          <h2 id="evidence-title">{evidence.headline}</h2>
        </div>
        <div className="ev-cols">
          <div className="ev-col">
            <h3>{evidence.does.title}</h3>
            <ul className="tick-list does">
              {evidence.does.items.map((item) => (
                <li key={item}>
                  <IconCheck />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="ev-col">
            <h3>{evidence.refuses.title}</h3>
            <ul className="tick-list refuses">
              {evidence.refuses.items.map((item) => (
                <li key={item}>
                  <IconX />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="case-col">
          <div className="segmented" role="radiogroup" aria-label="Example case" data-value={value} onKeyDown={onKey}>
            <span className="thumb" aria-hidden="true" />
            {(["clear", "unclear"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={value === key}
                tabIndex={value === key ? 0 : -1}
                onClick={() => setValue(key)}
              >
                {evidence.toggle[key].label}
              </button>
            ))}
          </div>
          <div className="panel case-card" aria-live="polite">
            <div key={value} className="panel-swap">
              <span className="example-label">Example from the Nexus demo</span>
              <p className="ticket-line" style={{ marginTop: 14 }}>
                {value === "clear" ? clear.ticket : unclear.ticket}
              </p>
              <div className="verdict-line">
                {value === "clear" ? <IconCheck className="i14" /> : <IconAbstain className="i14" />}
                <strong style={{ color: value === "clear" ? "var(--teal)" : "var(--coral)" }}>
                  {value === "clear" ? clear.verdict : unclear.verdict}
                </strong>
              </div>
              <p>{value === "clear" ? clear.body : unclear.body}</p>
              {value === "clear" ? (
                <div className="cites">
                  {clear.cites.map((c) => (
                    <span key={c} className="cite">
                      {c}
                    </span>
                  ))}
                </div>
              ) : (
                <>
                  <p style={{ marginTop: 18, color: "var(--text)", fontWeight: 600, fontSize: "var(--fs-small)" }}>Nexus asks for:</p>
                  <ul className="ask-list">
                    {unclear.asks.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
              <div style={{ marginTop: 22 }}>
                {value === "clear" ? <Mark kind="verified">Fix proposed, waiting for approval</Mark> : <Mark kind="abstain">No fix proposed</Mark>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
