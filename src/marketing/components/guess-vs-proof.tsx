"use client";

import { useRef, useState } from "react";
import { guessVsProof } from "../content";
import { IconAbstain, IconCheck, IconDrag, IconEvidence } from "./icons";

function GuessSide() {
  const g = guessVsProof.guess;
  return (
    <div className="compare-inner">
      <div>
        <p className="compare-side-label">{g.label}</p>
        <p className="guess-text">{g.body}</p>
      </div>
      <div style={{ alignSelf: "center" }}>
        <p className="compare-side-label">Sources</p>
        <div style={{ display: "grid", gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ height: 38, borderRadius: 8, border: "1px dashed var(--border)", opacity: 0.7 }} />
          ))}
        </div>
        <span className="sticker">{g.sticker}</span>
      </div>
    </div>
  );
}

function ProofSide() {
  const p = guessVsProof.proof;
  return (
    <div className="compare-inner">
      <div>
        <p className="compare-side-label">
          <IconEvidence className="i14" /> {p.label} · evidence chain
        </p>
        <ol className="proof-chain">
          {p.chain.map((c) => (
            <li key={c.cite}>
              <span className="cite">{c.cite}</span>
              <span>{c.text}</span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <p className="compare-side-label">{p.label} · verdict</p>
        <p className="proof-rule">{p.rule}</p>
        <p style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center", color: "var(--teal)", fontWeight: 600 }}>
          <IconCheck className="i14" /> {p.verdict}
        </p>
        <div className="proof-unverified">
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", color: "var(--coral)", fontWeight: 600 }}>
            <IconAbstain className="i14" /> Could not verify
          </span>
          <ul>
            {p.unverified.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function GuessVsProof() {
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  function fromPointer(clientX: number) {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    setPos(Math.min(96, Math.max(4, ((clientX - box.left) / box.width) * 100)));
  }

  return (
    <section className="section" aria-labelledby="gvp-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="gvp-title">{guessVsProof.headline}</h2>
          <p>{guessVsProof.intro}</p>
        </div>
        <div
          ref={boxRef}
          className="compare"
          style={{ ["--pos" as string]: `${pos}%` }}
          data-dragging={dragging}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).tagName === "INPUT") return;
            setDragging(true);
            (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
            fromPointer(event.clientX);
          }}
          onPointerMove={(event) => dragging && fromPointer(event.clientX)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
        >
          <div className="compare-layer compare-guess">
            <GuessSide />
          </div>
          <div className="compare-layer compare-proof">
            <ProofSide />
          </div>
          <input
            className="compare-range"
            type="range"
            min={4}
            max={96}
            value={Math.round(pos)}
            onChange={(event) => setPos(Number(event.target.value))}
            aria-label="Divider between a typical AI answer and the Nexus answer"
            aria-valuetext={`${Math.round(100 - pos)} percent showing Nexus`}
          />
          <div className="compare-handle" aria-hidden="true">
            <span>
              <IconDrag className="i14" />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
