// Turns a DefectSpec into a declarative reproduction by fixed rules. No model:
// pages are taken from URLs and paths named in the ticket's steps, and the
// symptom to look for comes from its quoted error text and actual behaviour.
import type { DefectSpec } from "../ticket";

export type ReproStep =
  | { kind: "login" }
  | { kind: "visit"; url: string; fromStep: string }
  /** Click the first visible control named by one of the targets (accessible name, label, title or icon). */
  | { kind: "click"; targets: string[]; fromStep: string };

/**
 * "Click on the Heart / Like icon on the top-right corner of the card" →
 * ["Heart", "Like"]. Fixed rules: the words after "click", cut at the first
 * place word (on, in, at, of…), without "icon/button/link", split on "/" or "or".
 */
export function clickTargets(step: string): string[] {
  const m = step.match(/\b(?:click|tap|press)(?:s|ed|ing)?\b(?:\s+on)?(?:\s+the)?\s+(.+)/i);
  if (!m) return [];
  const phrase = m[1].split(/\s+(?:on|in|at|of|from|to|inside|within|next|near|for)\s+|[(.,;:]/i)[0];
  return [
    ...new Set(
      phrase
        .split(/\s*\/\s*|\s+or\s+/i)
        .map((t) => t.replace(/\b(icon|button|link|btn|toggle)\b/gi, "").replace(/["“”']/g, "").trim())
        .filter((t) => t.length >= 2 && t.length <= 40),
    ),
  ].slice(0, 4);
}

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
    const before = visits.length;
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
    // A step with no page of its own that clicks something: click it on the current page.
    if (visits.length === before && visits.some((v) => v.kind === "visit")) {
      const targets = clickTargets(step);
      if (targets.length) {
        visits.push({ kind: "click", targets, fromStep: step });
        basis.push(`Click the ${targets.map((t) => `"${t}"`).join(" or ")} control: step "${step.slice(0, 120)}".`);
      }
    }
  }
  if (!visits.length) return { ok: false, reason: "The ticket's steps name no page on the service under test, so there is nothing to open. Add the page URLs or paths to the steps." };

  const quoted = [spec.actual ?? "", ...spec.errorMessages].flatMap((t) => [...t.matchAll(/["“`]([^"”`]{4,120})["”`]/g)].map((m) => m[1]));
  const exact = [...spec.errorMessages, ...quoted].map((t) => t.replace(/[.…]+$/, "").trim()).filter((t) => t.length >= 6);
  // "Network error: Unexpected token" → also "Network error": the label part of a
  // "Label: detail" message, which the page may show with a different detail.
  const labels = exact.map((t) => t.match(/^([A-Za-z][A-Za-z ]{6,40}?)\s*[:\-–]\s+\S/)?.[1]?.trim()).filter((t): t is string => !!t && t.split(/\s+/).length >= 2);
  const symptomTexts = [...new Set([...exact, ...labels])].slice(0, 6);
  for (const t of symptomTexts) basis.push(`Look for the reported text "${t}".`);
  const checkHtmlForData = /unexpected token\s*['"‘’]?</i.test([spec.actual ?? "", ...spec.errorMessages].join(" ")) || /network error/i.test(spec.actual ?? "");
  if (checkHtmlForData) basis.push("Check whether a data request is answered with a web page instead of data (the reported 'Unexpected token <').");
  return {
    ok: true,
    reproduction: { target: origin, steps: [...(options.login ? [{ kind: "login" } as ReproStep] : []), ...visits], symptomTexts, checkHtmlForData, basis },
  };
}
