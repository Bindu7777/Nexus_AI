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
  /** fetch/XHR responses with HTTP 4xx/5xx. */
  failedData: { url: string; status: number }[];
  /** Visible text of the page, trimmed. */
  text: string;
  error: string | null;
};

export type Assertion = { name: string; page: string; expected: string; actual: string; passed: boolean; showsDefect: boolean };

export function judgeRun(repro: Reproduction, pages: PageObservation[]): { reproduced: boolean; assertions: Assertion[] } {
  const assertions: Assertion[] = [];
  for (const p of pages) {
    const page = new URL(p.url).pathname;
    if (p.error) {
      assertions.push({ name: "Page opens", page, expected: "opens", actual: p.error, passed: false, showsDefect: false });
      continue;
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
  return { reproduced: assertions.some((a) => a.showsDefect), assertions };
}
