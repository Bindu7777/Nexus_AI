"use client";

import { useRef } from "react";
import { environment } from "../content";
import { useInView } from "../hooks";

const SOURCES = ["Code host", "Tracker", "Database", "Logs", "Docs"];

/** Phone version of the same diagram, stacked vertically. */
function TallDiagram({ on }: { on: boolean }) {
  return (
    <svg className={`env-svg env-tall${on ? " is-on" : ""}`} viewBox="0 0 340 600" role="img" aria-label="Architecture: your sources, the Nexus platform, the sandbox and an optional model endpoint all sit inside your network. Nothing leaves.">
      <defs>
        <marker id="env-arr-t" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 10 5 0 10z" fill="var(--cyan)" />
        </marker>
      </defs>
      <rect className="ln d1" x="6" y="6" width="328" height="540" rx="20" fill="none" stroke="var(--cobalt)" strokeWidth="1.5" style={{ ["--len" as string]: 1800 }} />
      <text className="fade d1" x="24" y="34" fontSize="13" fill="var(--muted)" fontFamily="var(--font-body)">
        Your network
      </text>
      <g className="fade d2">
        {SOURCES.map((s, i) => (
          <g key={s}>
            <rect x={24 + (i % 3) * 100} y={52 + Math.floor(i / 3) * 46} width="92" height="36" rx="9" fill="var(--raised)" stroke="var(--border)" />
            <text x={70 + (i % 3) * 100} y={75 + Math.floor(i / 3) * 46} textAnchor="middle" fontSize="12" fill="var(--text)" fontFamily="var(--font-body)">
              {s}
            </text>
          </g>
        ))}
      </g>
      <path className="ln d3" d="M170 142 V 186" stroke="var(--cyan)" strokeWidth="1.6" markerEnd="url(#env-arr-t)" style={{ ["--len" as string]: 60 }} />
      <g className="fade d2">
        <rect x="24" y="192" width="292" height="150" rx="14" fill="var(--surface)" stroke="var(--cobalt)" strokeWidth="1.5" />
        <text x="44" y="222" fontSize="15" fontWeight="600" fill="var(--text)" fontFamily="var(--font-display)">
          Nexus platform
        </text>
        {["Fixed rule engine", "Evidence store", "Audit trail"].map((t, i) => (
          <g key={t}>
            <rect x="44" y={236 + i * 34} width="252" height="26" rx="7" fill="var(--raised)" stroke="var(--border-soft)" />
            <text x="58" y={253 + i * 34} fontSize="11" fill="var(--muted)" fontFamily="var(--font-code)">
              {t}
            </text>
          </g>
        ))}
      </g>
      <g className="fade d3">
        <rect x="24" y="370" width="136" height="70" rx="12" fill="var(--raised)" stroke="var(--teal)" />
        <text x="92" y="402" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text)" fontFamily="var(--font-display)">
          Sandbox
        </text>
        <text x="92" y="422" textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-code)">
          fixes tried here
        </text>
        <rect x="180" y="370" width="136" height="70" rx="12" fill="none" stroke="var(--faint)" strokeDasharray="5 5" />
        <text x="248" y="400" textAnchor="middle" fontSize="12" fill="var(--text)" fontFamily="var(--font-body)">
          Your model
        </text>
        <text x="248" y="420" textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-code)">
          optional
        </text>
      </g>
      <g className="fade d4">
        <path d="M170 520 V 590" stroke="var(--faint)" strokeWidth="1.3" strokeDasharray="3 5" />
        <path d="M160 548 l20 20 M180 548 l-20 20" stroke="var(--coral)" strokeWidth="1.8" strokeLinecap="round" />
        <text x="196" y="580" fontSize="11" fill="var(--muted)" fontFamily="var(--font-code)">
          nothing leaves
        </text>
      </g>
    </svg>
  );
}

export function Environment() {
  const ref = useRef<HTMLElement>(null);
  const on = useInView(ref, { once: true, threshold: 0.3 });

  return (
    <section className="section section--quiet" aria-labelledby="env-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="env-title">{environment.headline}</h2>
          <p>{environment.intro}</p>
        </div>
        <figure ref={ref} className="panel env-figure">
          <svg
            className={`env-svg env-wide${on ? " is-on" : ""}`}
            viewBox="0 0 960 420"
            role="img"
            aria-labelledby="env-svg-title env-svg-desc"
          >
            <title id="env-svg-title">Architecture: everything runs inside your network</title>
            <desc id="env-svg-desc">
              Your network boundary contains your sources, the Nexus platform and a sandbox. Arrows go from the sources into Nexus. An optional, dashed link goes to a model endpoint you host, also inside the boundary. Nothing crosses the boundary to the outside.
            </desc>
            <defs>
              <marker id="env-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 10 5 0 10z" fill="var(--cyan)" />
              </marker>
            </defs>

            {/* network boundary */}
            <rect className="ln d1" x="16" y="16" width="790" height="388" rx="22" fill="none" stroke="var(--cobalt)" strokeWidth="1.5" strokeDasharray="0" style={{ ["--len" as string]: 2400 }} />
            <text className="fade d1" x="40" y="48" fontSize="14" fill="var(--muted)" fontFamily="var(--font-body)">
              Your network
            </text>

            {/* sources */}
            {SOURCES.map((s, i) => {
              const y = 86 + i * 60;
              return (
                <g key={s} className="fade d2">
                  <rect x="44" y={y} width="150" height="42" rx="10" fill="var(--raised)" stroke="var(--border)" />
                  <text x="119" y={y + 26} textAnchor="middle" fontSize="13" fill="var(--text)" fontFamily="var(--font-body)">
                    {s}
                  </text>
                  <path
                    className="ln d3"
                    d={`M196 ${y + 21} C 250 ${y + 21}, 250 210, 300 210`}
                    fill="none"
                    stroke="var(--cyan)"
                    strokeWidth="1.5"
                    markerEnd="url(#env-arr)"
                    style={{ ["--len" as string]: 260 }}
                  />
                  {on ? (
                    <circle r="4" fill="#FFB454" opacity="0">
                      <animateMotion dur="2.6s" begin={`${1.8 + i * 0.5}s`} repeatCount="indefinite" path={`M196 ${y + 21} C 250 ${y + 21}, 250 210, 300 210`} />
                      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="2.6s" begin={`${1.8 + i * 0.5}s`} repeatCount="indefinite" />
                    </circle>
                  ) : null}
                </g>
              );
            })}

            {/* platform */}
            <g className="fade d2">
              <rect x="304" y="120" width="230" height="180" rx="16" fill="var(--surface)" stroke="var(--cobalt)" strokeWidth="1.5" />
              <text x="324" y="152" fontSize="16" fontWeight="600" fill="var(--text)" fontFamily="var(--font-display)">
                Nexus platform
              </text>
              {["Fixed rule engine", "Evidence store", "Audit trail"].map((t, i) => (
                <g key={t}>
                  <rect x="324" y={170 + i * 40} width="190" height="30" rx="8" fill="var(--raised)" stroke="var(--border-soft)" />
                  <text x="338" y={190 + i * 40} fontSize="12" fill="var(--muted)" fontFamily="var(--font-code)">
                    {t}
                  </text>
                </g>
              ))}
            </g>

            {/* sandbox */}
            <g className="fade d3">
              <rect x="604" y="230" width="170" height="84" rx="14" fill="var(--raised)" stroke="var(--teal)" strokeWidth="1.2" />
              <text x="689" y="266" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--text)" fontFamily="var(--font-display)">
                Sandbox
              </text>
              <text x="689" y="288" textAnchor="middle" fontSize="11" fill="var(--muted)" fontFamily="var(--font-code)">
                fixes tried here first
              </text>
              <path className="ln d4" d="M536 250 C 570 250, 570 272, 600 272" fill="none" stroke="var(--teal)" strokeWidth="1.5" style={{ ["--len" as string]: 120 }} />
            </g>

            {/* optional model endpoint */}
            <g className="fade d4">
              <rect x="604" y="96" width="170" height="70" rx="14" fill="none" stroke="var(--faint)" strokeDasharray="5 5" />
              <text x="689" y="126" textAnchor="middle" fontSize="13" fill="var(--text)" fontFamily="var(--font-body)">
                Your model endpoint
              </text>
              <text x="689" y="146" textAnchor="middle" fontSize="11" fill="var(--muted)" fontFamily="var(--font-code)">
                optional
              </text>
              <path d="M536 170 C 570 170, 570 132, 600 132" fill="none" stroke="var(--faint)" strokeWidth="1.3" strokeDasharray="4 5" />
            </g>

            {/* outside: nothing crosses */}
            <g className="fade d4">
              <text x="884" y="190" textAnchor="middle" fontSize="13" fill="var(--muted)" fontFamily="var(--font-body)">
                Outside
              </text>
              <path d="M786 214 H 862" stroke="var(--faint)" strokeWidth="1.3" strokeDasharray="3 5" />
              <path d="M816 202 l16 24 M832 202 l-16 24" stroke="var(--coral)" strokeWidth="1.8" strokeLinecap="round" />
              {on ? (
                <circle cx="806" cy="214" r="4" fill="none" stroke="var(--coral)" strokeWidth="2" opacity="0">
                  <animate attributeName="r" values="4;22" dur="2.4s" begin="2.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.9;0" dur="2.4s" begin="2.4s" repeatCount="indefinite" />
                </circle>
              ) : null}
              <text x="884" y="250" textAnchor="middle" fontSize="11" fill="var(--muted)" fontFamily="var(--font-code)">
                nothing leaves
              </text>
            </g>
          </svg>
          <TallDiagram on={on} />
        </figure>
        <ul className="env-statements">
          {environment.statements.map((s) => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
