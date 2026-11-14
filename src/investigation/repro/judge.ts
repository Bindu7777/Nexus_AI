// Decides from observations whether the defect showed up. Plain comparisons
// with expected and actual values logged. Never a model's opinion.
import type { Reproduction } from "./plan";

export type PageObservation = {
  url: string;
  finalUrl: string;
  status: number | null;
  /** Script errors thrown on the page. */
  pageErrors: string[];
  /** console.error messages. */
  consoleErrors: string[];
  /** fetch/XHR responses that came back as an HTML page. */
  htmlForData: { url: string; status: number; contentType: string }[];
  /** fetch/XHR responses with HTTP 4xx/5xx, or status 0 when the request failed in the network (for example, blocked by CORS). */
  failedData: { url: string; status: number; error?: string }[];
  /** Visible text of the page, trimmed. */
  text: string;
  /** Visible text without the header, navigation and footer. */
  mainText?: string;
  /** The page shows a password field. */
  hasPasswordField?: boolean;
  /** For a click step: what was clicked. Shown instead of the path. */
  label?: string;
  error: string | null;
};

/**
 * A page that asks the visitor to sign in instead of showing its content: a
 * password field, a sign-in address, or a body that is little more than a
 * "log in" prompt. Only meaningful when the run is not signed in.
 */
export function looksLikeSignInWall(p: PageObservation): boolean {
  if (p.hasPasswordField) return true;
  try {
    if (/\/(log-?in|sign-?in|auth|customer-login)\b/i.test(new URL(p.finalUrl).pathname)) return true;
  } catch {
    // keep going
  }
  const main = (p.mainText ?? "").trim();
  return main.length > 0 && main.length < 200 && /\b(log ?in|sign ?in)\b/i.test(main);
}

export type Assertion = { name: string; page: string; expected: string; actual: string; passed: boolean; showsDefect: boolean };

export function judgeRun(
  repro: Reproduction,
  pages: PageObservation[],
  options: { loggedIn?: boolean } = {},
): { reproduced: boolean; assertions: Assertion[]; needsSignIn: string[] } {
  const assertions: Assertion[] = [];
  const needsSignIn: string[] = [];
  for (const p of pages) {
    const page = p.label ? `${new URL(p.url).pathname} · ${p.label}` : new URL(p.url).pathname;
    if (p.error) {
      assertions.push({ name: "Page opens", page, expected: "opens", actual: p.error, passed: false, showsDefect: false });
      continue;
    }
    if (!p.label && !options.loggedIn && looksLikeSignInWall(p)) {
      // Not a pass and not the defect: this page could not be checked.
      needsSignIn.push(page);
      assertions.push({ name: "Page shows its content", page, expected: "the page's content", actual: "a sign-in prompt (needs a signed-in customer)", passed: false, showsDefect: false });
    }
    const statusOk = p.status != null && p.status < 400;
    assertions.push({ name: "Page loads without an HTTP error", page, expected: "HTTP status below 400", actual: `HTTP ${p.status ?? "none"}`, passed: statusOk, showsDefect: !statusOk });
    const haystack = `${p.text}\n${p.pageErrors.join("\n")}\n${p.consoleErrors.join("\n")}`.toLowerCase();
    for (const t of repro.symptomTexts) {
      const seen = haystack.includes(t.toLowerCase());
      assertions.push({ name: `Reported text is absent`, page, expected: `"${t}" not shown`, actual: seen ? `"${t}" shown` : "not shown", passed: !seen, showsDefect: seen });
    }
    if (repro.checkHtmlForData) {
      const bad = p.htmlForData;
      assertions.push({
        name: "Data requests return data, not a web page",
        page,
        expected: "0 data requests answered with HTML",
        actual: bad.length ? `${bad.length}: ${bad.slice(0, 3).map((b) => `${new URL(b.url).pathname} → ${b.status} ${b.contentType}`).join("; ")}` : "0",
        passed: bad.length === 0,
        showsDefect: bad.length > 0,
      });
    }
    if (repro.checkHtmlForData) {
      const failed = p.failedData.filter((f) => f.status >= 500 || f.status === 0);
      const cors = p.consoleErrors.find((m) => /CORS policy/i.test(m));
      const describe = (f: { url: string; status: number; error?: string }) =>
        `${new URL(f.url).host}${new URL(f.url).pathname} → ${f.status === 0 ? `failed in the network (${f.error ?? "no response"})` : f.status}`;
      assertions.push({
        name: "Data requests complete without a server or network error",
        page,
        expected: "0 data requests failed (HTTP 5xx or no response)",
        actual: failed.length ? `${failed.length}: ${failed.slice(0, 3).map(describe).join("; ")}${cors ? `. Browser: ${cors.slice(0, 220)}` : ""}` : "0",
        passed: failed.length === 0,
        // The reported "Network error" is what a page shows when its data request fails.
        showsDefect: failed.length > 0,
      });
    }
    assertions.push({
      name: "No script errors",
      page,
      expected: "0 script errors",
      actual: p.pageErrors.length ? `${p.pageErrors.length}: ${p.pageErrors[0].slice(0, 140)}` : "0",
      passed: p.pageErrors.length === 0,
      // A script error alone is recorded, but only counts as the defect when it carries the reported text.
      showsDefect: false,
    });
  }
  return { reproduced: assertions.some((a) => a.showsDefect), assertions, needsSignIn: [...new Set(needsSignIn)] };
}
