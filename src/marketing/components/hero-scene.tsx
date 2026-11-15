"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scene, type SceneGroup } from "../scene";
import { useMediaQuery, useReducedMotion } from "../hooks";
import { IconCheck, IconEvidence, IconReplay, Mark } from "./icons";

const GROUPS = scene.groups.map((g) => g.id);
const groupIndex = (group: SceneGroup) => GROUPS.indexOf(group);
const TOTAL = scene.beats.length;
const TITLE = scene.ticket.title;

export function HeroScene() {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const narrow = useMediaQuery("(max-width: 719px)");
  const tapMode = narrow && !reduced;
  // The scene sits in the hero, so it plays once on load.
  const [visible, setVisible] = useState(false);
  useEffect(() => setVisible(true), []);

  const [count, setCount] = useState(0); // beats revealed
  const [typed, setTyped] = useState(0);
  const [limit, setLimit] = useState(Number.POSITIVE_INFINITY); // last group allowed to play
  const [run, setRun] = useState(0);
  const [approved, setApproved] = useState(false);
  const countRef = useRef(0);
  countRef.current = count;

  // Phones advance one group per tap.
  useEffect(() => {
    setLimit(tapMode ? Math.max(0, revealedGroup(countRef.current)) : Number.POSITIVE_INFINITY);
  }, [tapMode]);

  // Timeline: schedule the beats that are allowed to play from where we are.
  useEffect(() => {
    if (reduced) {
      setCount(TOTAL);
      setTyped(TITLE.length);
      return;
    }
    if (!visible) return;
    const start = countRef.current;
    if (start >= TOTAL) return;
    const base = scene.beats[start].at;
    const timers: number[] = [];
    for (let i = start; i < TOTAL; i += 1) {
      const beat = scene.beats[i];
      if (groupIndex(beat.group) > limit) break;
      const delay = beat.at - base + (start === 0 ? 350 : 250);
      timers.push(window.setTimeout(() => setCount((c) => Math.max(c, i + 1)), delay));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [visible, reduced, limit, run]);

  // Typing the ticket title once the ticket beat is revealed.
  useEffect(() => {
    if (reduced || count < 1 || typed >= TITLE.length) return;
    const step = Math.max(18, scene.ticket.typeMs / TITLE.length);
    const id = window.setTimeout(() => setTyped((t) => t + 1), step);
    return () => window.clearTimeout(id);
  }, [count, typed, reduced]);

  const on = useCallback((key: string) => scene.beats.slice(0, count).some((b) => b.key === key), [count]);
  const groupShown = (group: SceneGroup) => scene.beats.slice(0, count).some((b) => b.group === group);
  const current = revealedGroup(count);
  const groupDone = count > 0 && (count >= TOTAL || groupIndex(scene.beats[count].group) > current);
  const canContinue = tapMode && groupDone && count < TOTAL;
  const finished = count >= TOTAL;

  const announce = useMemo(() => (count === 0 ? "" : scene.groups[current]?.label ?? ""), [count, current]);

  function replay() {
    setApproved(false);
    setTyped(0);
    setCount(0);
    countRef.current = 0;
    setLimit(tapMode ? 0 : Number.POSITIVE_INFINITY);
    setRun((r) => r + 1);
  }

  const hidden = (group: SceneGroup) => (tapMode && !groupShown(group) ? " is-hidden" : "");

  return (
    <div ref={rootRef} className="panel scene" data-mode={tapMode ? "tap" : "auto"} role="region" aria-label={scene.label}>
      <p className="sr-only">{scene.description}</p>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <div className="scene-top">
        <span className="example-label">{scene.label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="scene-progress" aria-hidden="true">
            {GROUPS.map((g, i) => (
              <i key={g} className={count > 0 && i <= current && (i < current || groupDone) ? "is-on" : ""} />
            ))}
          </div>
          <button type="button" className="icon-btn" onClick={replay} aria-label="Replay the example investigation" title="Replay">
            <IconReplay />
          </button>
        </div>
      </div>

      <div className="scene-body" aria-hidden="false">
        {/* Ticket */}
        <div data-group="ticket" className={`scene-ticket rv${on("ticket") ? " is-on" : ""}${hidden("ticket")}`}>
          <span className="id">{scene.ticket.id}</span>
          <span className="title">
            {TITLE.slice(0, typed)}
            {typed < TITLE.length && on("ticket") ? <span className="caret" aria-hidden="true" /> : null}
            <span className="sr-only">{typed < TITLE.length ? TITLE : ""}</span>
          </span>
        </div>

        {/* Sources */}
        <div data-group="sources" className={`chips${hidden("sources")}`} aria-label="Sources">
          {scene.sources.map((s, i) => (
            <span key={s.id} className={`chip${on(`source:${i}`) ? " is-on" : ""}`}>
              {s.label}
            </span>
          ))}
        </div>

        {/* Evidence */}
        <section data-group="evidence" className={`scene-block${hidden("evidence")}`} aria-label="Evidence">
          <header>
            <span>Evidence</span>
            <Mark kind="evidence">Cited</Mark>
          </header>
          <ul className="ev-list">
            {scene.evidence.map((item, i) => (
              <li key={item.text} className={`ev rv-x${on(`evidence:${i}`) ? " is-on" : ""}`}>
                <IconEvidence />
                <span>{item.text}</span>
                <span className="cite">{item.cite}</span>
                {"code" in item && item.code ? (
                  <div className="code-snippet" role="group" aria-label={`Code excerpt ${item.cite}`}>
                    {item.code.map((line) => (
                      <div key={line.n} className={`ln${"hot" in line && line.hot ? " hot" : ""}`}>
                        <span>{line.n}</span>
                        <span>{line.text}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {/* Hypotheses */}
        <section data-group="hypotheses" className={`scene-block${hidden("hypotheses")}`} aria-label="Ranked causes">
          <header>
            <span>Causes, ranked</span>
            <span>rules decide</span>
          </header>
          <ol className="hyp-list">
            {scene.hypotheses.map((h, i) => (
              <li key={h.title} className={`hyp rv${on(`hypothesis:${i}`) ? " is-on" : ""}`}>
                <span className="rank">{i + 1}</span>
                <span className="t">{h.title}</span>
                {h.verdict === "verified" ? <Mark kind="verified">Verified</Mark> : <Mark kind="abstain">Not enough evidence</Mark>}
                <span className="d">{h.detail}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Fix */}
        <div data-group="fix" className={`fix-row${hidden("fix")}`}>
          <section className={`scene-block rv${on("diff") ? " is-on" : ""}`} aria-label="Suggested diff">
            <header>
              <span>Suggested diff · catalog/server.mjs</span>
              <span>not applied</span>
            </header>
            <div className="diff">
              {scene.diff.map((line, i) => (
                <div key={i} className={line.sign === "+" ? "add" : line.sign === "-" ? "del" : ""}>
                  <span aria-hidden="true">{line.sign}</span>
                  <span>
                    {line.sign === "+" ? <span className="sr-only">Added: </span> : line.sign === "-" ? <span className="sr-only">Removed: </span> : null}
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <div className={`approve-box rv${on("approve") ? " is-on" : ""}`}>
            {approved ? (
              <span className="approved-note" role="status">
                <IconCheck className="i14" /> Approved by you · applied in sandbox (example)
              </span>
            ) : (
              <>
                <span className="wait">Waiting for human approval</span>
                <button
                  type="button"
                  className={`btn btn--primary btn--sm approve-btn${finished && !reduced ? " is-waiting" : ""}`}
                  onClick={() => setApproved(true)}
                  disabled={!on("approve")}
                >
                  Approve fix
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {canContinue ? (
        <div className="scene-continue">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLimit((l) => l + 1)}>
            Continue · {scene.groups[current + 1]?.label}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function revealedGroup(count: number) {
  if (count === 0) return 0;
  return groupIndex(scene.beats[Math.min(count, TOTAL) - 1].group);
}
