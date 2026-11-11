"use client";

import { useState } from "react";
import { faq } from "../content";

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="section" aria-labelledby="faq-title">
      <div className="wrap grid faq-grid">
        <div className="faq-head">
          <h2 id="faq-title">{faq.headline}</h2>
        </div>
        <div className="faq-list">
          {faq.items.map((item, i) => {
            const expanded = open === i;
            return (
              <div className="faq-item" key={item.q}>
                <h3 className="faq-q">
                  <button
                    type="button"
                    id={`faq-q-${i}`}
                    aria-expanded={expanded}
                    aria-controls={`faq-a-${i}`}
                    onClick={() => setOpen(expanded ? null : i)}
                  >
                    {item.q}
                    <span className="plus" aria-hidden="true" />
                  </button>
                </h3>
                <div className="faq-a" id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} data-open={expanded}>
                  <div inert={!expanded || undefined}>
                    <p>{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
