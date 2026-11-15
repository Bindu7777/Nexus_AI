import { pilotPrice, pricing } from "../pricing";
import { IconCheck, Mark } from "./icons";
import { PilotButton } from "./pilot-button";

export function Pricing() {
  const [main, pilot, enterprise] = pricing.plans;
  return (
    <section className="section" id="pricing" aria-labelledby="pricing-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="pricing-title">{pricing.headline}</h2>
        </div>
        <div className="price-grid">
          <article className="panel plan-main" aria-labelledby="plan-main-name">
            <div className="plan-name">
              <span id="plan-main-name">{main.name}</span>
              <span className="plan-tag">Launch pricing</span>
            </div>
            <div className="price-big">
              <strong>{main.price}</strong>
              <span>{main.cadence}</span>
            </div>
            <p className="plan-summary">{main.summary}</p>
            <ul className="plan-features">
              {main.features.map((f) => (
                <li key={f.label}>
                  <span>
                    <IconCheck />
                    {f.label}
                  </span>
                  {f.status === "planned" ? <Mark kind="planned">Planned</Mark> : null}
                </li>
              ))}
            </ul>
            <PilotButton label={main.cta.label} />
          </article>
          <div className="plan-side">
            {[pilot, enterprise].map((plan) => (
              <article key={plan.id} className="plan-quiet" aria-labelledby={`plan-${plan.id}`}>
                <span id={`plan-${plan.id}`} style={{ fontWeight: 600 }}>
                  {plan.name}
                </span>
                <span className="price">{plan.id === "pilot" ? pilotPrice() : plan.price}</span>
                <p>{plan.summary}</p>
                <PilotButton label={plan.cta.label} variant="ghost" arrow={false} />
              </article>
            ))}
          </div>
        </div>
        <p className="price-note">{pricing.note}</p>
      </div>
    </section>
  );
}
