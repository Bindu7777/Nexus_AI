import { integrations } from "../content";

function OneWay({ source, reads, id }: { source: string; reads: string[]; id: string }) {
  return (
    <svg className="int-svg" viewBox="0 0 300 130" role="img" aria-label={`${source} to Nexus. Nexus reads ${reads.join(", ")}. The arrow only points into Nexus; nothing is written back.`}>
      <defs>
        <marker id={`m-${id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 10 5 0 10z" fill="var(--cyan)" />
        </marker>
      </defs>
      <rect x="4" y="24" width="96" height="44" rx="10" fill="var(--raised)" stroke="var(--border)" />
      <text x="52" y="51" textAnchor="middle" fontSize="13" fill="var(--text)" fontFamily="var(--font-body)">
        {source}
      </text>
      <rect x="200" y="24" width="96" height="44" rx="10" fill="var(--surface)" stroke="var(--cobalt)" />
      <text x="248" y="51" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--text)" fontFamily="var(--font-display)">
        Nexus
      </text>
      <path d="M104 46 H194" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M104 46 H194" stroke="var(--cyan)" strokeWidth="1.5" className="flow" markerEnd={`url(#m-${id})`} />
      <text x="150" y="36" textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-code)">
        read
      </text>
      <path d="M194 98 H110" stroke="var(--faint)" strokeWidth="1.2" strokeDasharray="3 5" />
      <path d="M144 90 l12 16 M156 90 l-12 16" stroke="var(--coral)" strokeWidth="1.6" strokeLinecap="round" />
      <text x="150" y="124" textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-code)">
        no writes back
      </text>
    </svg>
  );
}

function Names({ hidden }: { hidden?: boolean }) {
  return (
    <ul aria-hidden={hidden || undefined}>
      {integrations.names.map((n) => (
        <li key={n.name} className="name-tag">
          {n.name}
          <small>{integrations.statusLabel[n.status]}</small>
        </li>
      ))}
    </ul>
  );
}

export function Integrations() {
  return (
    <section className="section" aria-labelledby="int-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="int-title">{integrations.headline}</h2>
        </div>
        <div className="int-grid">
          {integrations.diagrams.map((d) => (
            <div className="int-cell" key={d.id}>
              <h3>{d.title}</h3>
              <p className="src">{d.source}, as an example</p>
              <OneWay source={d.source} reads={d.reads} id={d.id} />
              <div className="int-reads" aria-hidden="true">
                {d.reads.map((r) => (
                  <span key={r}>{r}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="marquee" aria-label="Integrations and their status">
          <div className="marquee-track">
            <Names />
            <Names hidden />
          </div>
        </div>
        <p className="int-caption">{integrations.caption}</p>
      </div>
    </section>
  );
}
