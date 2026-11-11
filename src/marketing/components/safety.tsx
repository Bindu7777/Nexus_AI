import { safety } from "../content";

const SRC_Y = [96, 158, 220, 282, 344];
const CORE = { x: 330, y: 238 };
const EDGE_X = 452;

function curve(y: number) {
  const sx = 170;
  return `M${sx} ${y + 20} C ${sx + 64} ${y + 20}, ${CORE.x - 110} ${CORE.y}, ${CORE.x - 50} ${CORE.y}`;
}

function Perimeter() {
  const d = safety.diagram;
  return (
    <svg className="perimeter-svg" viewBox="0 0 600 440" role="img" aria-label="Diagram: inside your company network, five sources send evidence into Nexus. A packet that tries to leave is blocked at the network boundary. Nothing leaves.">
      <defs>
        <radialGradient id="core-glow">
          <stop offset="0" stopColor="#22D3EE" stopOpacity="0.35" />
          <stop offset="1" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="edge-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3B6BFF" />
          <stop offset="0.5" stopColor="#22D3EE" />
          <stop offset="1" stopColor="#3B6BFF" />
        </linearGradient>
      </defs>

      {/* company boundary */}
      <rect x="16" y="30" width={EDGE_X - 16} height="392" rx="30" style={{ fill: "color-mix(in srgb, var(--cobalt) 6%, transparent)" }} stroke="none" />
      <rect className="ants" x="16" y="30" width={EDGE_X - 16} height="392" rx="30" fill="none" stroke="url(#edge-g)" strokeWidth="2" strokeDasharray="7 9" />
      <g transform="translate(40 62)">
        <path d="M2 7V5a4 4 0 0 1 8 0v2" fill="none" stroke="var(--cyan)" strokeWidth="1.6" strokeLinecap="round" />
        <rect x="0" y="7" width="12" height="9" rx="2" fill="var(--cyan)" />
        <text x="22" y="14" fontSize="15" fill="var(--text)" fontFamily="var(--font-body)" fontWeight="600">
          {d.boundary}
        </text>
      </g>

      {/* sources and evidence flowing in */}
      {d.sources.map((label, i) => {
        const y = SRC_Y[i];
        const path = curve(y);
        return (
          <g key={label}>
            <path d={path} fill="none" stroke="var(--border)" strokeWidth="1.5" />
            <rect x="44" y={y} width="126" height="40" rx="11" fill="var(--raised)" stroke="var(--border)" />
            <circle cx="62" cy={y + 20} r="4" fill="var(--teal)" />
            <text x="76" y={y + 25} fontSize="15" fill="var(--text)" fontFamily="var(--font-body)">
              {label}
            </text>
            <circle r="4.5" fill="#FFB454" opacity="0">
              <animateMotion dur="2.8s" begin={`${i * 0.55}s`} repeatCount="indefinite" path={path} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.2 1" />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="2.8s" begin={`${i * 0.55}s`} repeatCount="indefinite" />
            </circle>
          </g>
        );
      })}

      {/* Nexus core */}
      <circle cx={CORE.x} cy={CORE.y} r="90" fill="url(#core-glow)" />
      <circle cx={CORE.x} cy={CORE.y} r="50" fill="none" stroke="var(--cyan)" strokeWidth="1.2" opacity="0.6">
        <animate attributeName="r" values="50;76" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.55;0" dur="2.6s" repeatCount="indefinite" />
      </circle>
      <circle cx={CORE.x} cy={CORE.y} r="50" fill="var(--surface)" stroke="var(--cobalt)" strokeWidth="2" />
      <text x={CORE.x} y={CORE.y + 2} textAnchor="middle" fontSize="19" fontWeight="600" fill="var(--text)" fontFamily="var(--font-display)">
        {d.core}
      </text>
      <text x={CORE.x} y={CORE.y + 22} textAnchor="middle" fontSize="11" fill="var(--muted)" fontFamily="var(--font-code)">
        read-only
      </text>

      {/* an attempt to leave, stopped at the boundary */}
      <path d={`M${CORE.x + 52} ${CORE.y} H ${EDGE_X - 6}`} stroke="var(--faint)" strokeWidth="1.4" strokeDasharray="3 6" />
      <circle r="5" fill="var(--coral)" opacity="0">
        <animateMotion id="leak" dur="1.1s" begin="1.2s;stop.end+0.9s" path={`M${CORE.x + 52} ${CORE.y} H ${EDGE_X - 8}`} fill="freeze" />
        <set attributeName="opacity" to="1" begin="leak.begin" />
        <set attributeName="opacity" to="0" begin="leak.end" />
      </circle>
      <circle cx={EDGE_X} cy={CORE.y} r="4" fill="none" stroke="var(--coral)" strokeWidth="2.5" opacity="0">
        <animate id="stop" attributeName="r" from="5" to="26" dur="0.9s" begin="leak.end" fill="freeze" />
        <animate attributeName="opacity" values="1;0" dur="0.9s" begin="leak.end" fill="freeze" />
      </circle>
      <g transform={`translate(${EDGE_X - 13} ${CORE.y - 16})`}>
        <path d="M13 1 25 5.5V15c0 7.5-5.2 13.4-12 16-6.8-2.6-12-8.5-12-16V5.5Z" fill="var(--canvas)" stroke="var(--cobalt)" strokeWidth="2" />
        <path d="M8.5 16.5 12 20l6-7" fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x={EDGE_X - 14} y={CORE.y + 74} textAnchor="end" fontSize="12" fill="var(--coral)" fontFamily="var(--font-body)" fontWeight="600">
        {d.blocked}
      </text>

      {/* outside */}
      <text x="528" y="200" textAnchor="middle" fontSize="14" fill="var(--muted)" fontFamily="var(--font-body)">
        {d.outside}
      </text>
      <rect x="478" y="214" width="100" height="48" rx="12" fill="none" stroke="var(--faint)" strokeDasharray="4 5" />
      <text x="528" y="243" textAnchor="middle" fontSize="11" fill="var(--faint)" fontFamily="var(--font-code)">
        third parties
      </text>
      <text x="528" y="290" textAnchor="middle" fontSize="12" fill="var(--muted)" fontFamily="var(--font-code)">
        {d.outsideNote}
      </text>
    </svg>
  );
}

function PointIcon({ kind }: { kind: "shield" | "lock" | "check" }) {
  if (kind === "shield") {
    return (
      <span className="pt-icon pt-icon--shield" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2.5 20 5.5V12c0 5-3.5 8.6-8 10-4.5-1.4-8-5-8-10V5.5Z" />
          <path d="m8.5 12 2.4 2.4L15.5 9.8" />
        </svg>
      </span>
    );
  }
  if (kind === "lock") {
    return (
      <span className="pt-icon pt-icon--lock" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path className="shackle" d="M8 11V8a4 4 0 0 1 8 0v3" />
          <rect x="5" y="11" width="14" height="10" rx="2.5" />
          <path d="M12 15v2.5" />
        </svg>
      </span>
    );
  }
  return (
    <span className="pt-icon pt-icon--check" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c.8-3.6 3.6-5.5 7-5.5" />
        <path className="tick" d="m14.5 18 2 2 4-4.5" />
      </svg>
    </span>
  );
}

export function Safety() {
  return (
    <section className="section safety tone-dark" id="safety" aria-labelledby="safety-title">
      <div className="wrap grid safety-grid">
        <div className="safety-copy">
          <div className="section-head" style={{ marginBottom: 32 }}>
            <h2 id="safety-title">{safety.headline}</h2>
            <p>{safety.lead}</p>
          </div>
          <ul className="safety-points">
            {safety.points.map((p) => (
              <li key={p.title}>
                <PointIcon kind={p.icon} />
                <div>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="safety-visual">
          <div className="panel perimeter-panel">
            <Perimeter />
          </div>
        </div>
      </div>
    </section>
  );
}
