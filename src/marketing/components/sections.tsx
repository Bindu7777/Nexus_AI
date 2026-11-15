// Server-rendered sections with no interactivity of their own.
import { finalCta, trust } from "../content";
import { PilotButton } from "./pilot-button";

export function Trust() {
  return (
    <section className="section section--quiet" id="trust" aria-labelledby="trust-title">
      <div className="wrap grid trust-grid">
        <div className="trust-head">
          <h2 id="trust-title">{trust.headline}</h2>
          <p>{trust.footnote}</p>
        </div>
        <ol className="trust-list">
          {trust.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="section" aria-labelledby="final-title" style={{ paddingBottom: 0 }}>
      <div className="wrap">
        <div className="final">
          <svg className="trail-line" viewBox="0 0 520 300" aria-hidden="true">
            <defs>
              <linearGradient id="trail-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#3B6BFF" />
                <stop offset="0.5" stopColor="#4F8BFF" />
                <stop offset="1" stopColor="#22D3EE" />
              </linearGradient>
            </defs>
            <path className="trail-path" d="M20 240 C 120 240, 140 120, 240 140 S 380 60, 480 70" fill="none" stroke="url(#trail-g)" strokeWidth="2" />
            {[
              [20, 240],
              [240, 140],
              [480, 70],
            ].map(([x, y], i) => (
              <circle key={i} className="trail-dot" cx={x} cy={y} r={i === 2 ? 9 : 6} fill={i === 2 ? "#2DD4BF" : "#FFB454"} />
            ))}
          </svg>
          <h2 id="final-title">{finalCta.headline}</h2>
          <p>{finalCta.subhead}</p>
          <PilotButton label={finalCta.button} />
        </div>
      </div>
    </section>
  );
}
