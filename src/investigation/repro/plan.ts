// Turns a DefectSpec into a declarative reproduction by fixed rules. No model:
// pages are taken from URLs and paths named in the ticket's steps, and the
// symptom to look for comes from its quoted error text and actual behaviour.
import type { DefectSpec } from "../ticket";

export type ReproStep = { kind: "login" } | { kind: "visit"; url: string; fromStep: string };

export type Reproduction = {
  target: string;
  steps: ReproStep[];
  /** Text that, if it appears on a page or in a script error, shows the defect. */
  symptomTexts: string[];
  /** Also count a data request answered with a web page (the classic "Unexpected token '<'"). */
  checkHtmlForData: boolean;
  basis: string[];
};

const URLISH = /\bhttps?:\/\/[^\s)"'<>]+|(?<![\w/])\/[a-z0-9][\w\-/]*(?:\?[\w=&%-]*)?/gi;

export function buildReproduction(spec: DefectSpec, serviceUrl: string, options: { login: boolean }): { ok: true; reproduction: Reproduction } | { ok: false; reason: string } {
  const origin = new URL(serviceUrl).origin;
  const host = new URL(serviceUrl).hostname.replace(/^www\./, "");
  const visits: ReproStep[] = [];
  const seen = new Set<string>();
  const basis: string[] = [];
  for (const step of spec.steps) {
    for (const m of step.match(URLISH) ?? []) {
      let url: URL;
      try {
        url = new URL(m.replace(/[.,;:]+$/, ""), origin);
      } catch {
        continue;
      }
      // Only pages on the service under test. A URL to some other site is never opened.
      if (url.hostname.replace(/^www\./, "") !== host) continue;
      const target = `${origin}${url.pathname}${url.search}`;
      if (seen.has(target)) continue;
      seen.add(target);
      visits.push({ kind: "visit", url: target, fromStep: step });
      basis.push(`Open ${url.pathname}${url.search}: named in step "${step.slice(0, 120)}".`);
    }
  }
  if (!visits.length) return { ok: false, reason: "The ticket's steps name no page on the service under test, so there is nothing to open. Add the page URLs or paths to the steps." };

  const quoted = [spec.actual ?? "", ...spec.errorMessages].flatMap((t) => [...t.matchAll(/["“`]([^"”`]{4,120})["”`]/g)].map((m) => m[1]));
  const symptomTexts = [...new Set([...spec.errorMessages, ...quoted].map((t) => t.replace(/[.…]+$/, "").trim()).filter((t) => t.length >= 6))].slice(0, 6);
  for (const t of symptomTexts) basis.push(`Look for the reported text "${t}".`);
  const checkHtmlForData = /unexpected token\s*['"‘’]?</i.test([spec.actual ?? "", ...spec.errorMessages].join(" ")) || /network error/i.test(spec.actual ?? "");
  if (checkHtmlForData) basis.push("Check whether a data request is answered with a web page instead of data (the reported 'Unexpected token <').");
  return {
    ok: true,
    reproduction: { target: origin, steps: [...(options.login ? [{ kind: "login" } as ReproStep] : []), ...visits], symptomTexts, checkHtmlForData, basis },
  };
}
