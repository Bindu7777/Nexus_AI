import assert from "node:assert/strict";
import test from "node:test";
import { fetchJiraIssue, isSparseJiraText, mapJiraIssue } from "../src/lib/tickets/jira.ts";
import { resolveTicket } from "../src/lib/tickets/resolve.ts";

test("the sample NEX-4 text is sparse and does not invent measurements", () => {
  assert.equal(isSparseJiraText("Test", "test script nexus intelligence test script"), true);
  const ticket = mapJiraIssue({
    key: "NEX-4",
    fields: {
      summary: "Test",
      description: "test script nexus intelligence test script",
      issuetype: { name: "Defect test" },
      project: { key: "NEX", name: "NEXUS" },
    },
  });
  assert.equal(ticket.detail, "sparse");
  assert.equal(ticket.fallback, "seeded-scenario");
  assert.equal(ticket.readOnly, true);
  assert.match(ticket.disclaimer, /No evidence was inferred/);
  assert.match(ticket.disclaimer, /NI-1042/);
  assert.equal("lockWaitMs" in ticket, false);
  assert.doesNotMatch(ticket.symptom, /p95|lock wait/i);
});

test("a richer Defect test issue stays a Jira ticket without a seeded fallback", () => {
  const description =
    "Product reads on the catalog service time out when several shoppers open the same page. Single reads are fine. The last change holds a lock during the catalog reload.";
  const ticket = mapJiraIssue({
    key: "NEX-2",
    fields: {
      summary: "Catalog reads stall under overlap",
      description,
      issuetype: { name: "Defect test" },
      project: { key: "NEX" },
    },
  });
  assert.equal(ticket.detail, "sufficient");
  assert.equal(ticket.fallback, "none");
  assert.equal(ticket.issueType, "Defect test");
});

test("Jira reads use GET only and do not send a body", async () => {
  const calls: Array<{ url: string; method: string; hasBody: boolean }> = [];
  const result = await fetchJiraIssue(
    "NEX-4",
    {
      JIRA_BASE_URL: "https://nexusintelligence.atlassian.net",
      JIRA_EMAIL: "engineer@example.com",
      JIRA_API_TOKEN: "test-token",
      JIRA_PROJECT_KEY: "NEX",
    },
    async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET", hasBody: init?.body != null });
      return new Response(
        JSON.stringify({
          key: "NEX-4",
          fields: {
            summary: "Test",
            description: "test script nexus intelligence test script",
            issuetype: { name: "Defect test" },
            project: { key: "NEX", name: "NEXUS" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].hasBody, false);
  assert.match(calls[0].url, /^https:\/\/nexusintelligence\.atlassian\.net\/rest\/api\/3\/issue\/NEX-4/);
  if (result.ok) assert.equal(result.ticket.projectKey, "NEX");
});

test("NEX-4 without credentials does not invent an issue body", async () => {
  const ticket = await resolveTicket("NEX-4", {});
  assert.equal(ticket.source, "jira-unconfigured");
  assert.equal(ticket.detail, "unavailable");
  assert.equal(ticket.symptom, "");
  assert.equal(ticket.fallback, "none");
  assert.match(ticket.disclaimer, /NEX/);
});

test("NEX-5, NEX-6, and NEX-7 map to the sandbox scenarios without a live Jira call", () => {
  const shared = {
    issuetype: { name: "Defect test" },
    project: { key: "NEX", name: "NEXUS" },
    labels: ["nexus-demo"],
  };
  const nex5 = mapJiraIssue({
    key: "NEX-5",
    fields: {
      ...shared,
      summary: "Checkout p95 latency spikes to over 600 ms under load",
      description:
        "Simulated sandbox data. Expected agent outcome: find the cause. This is not a customer incident and it is not a measurement.",
      priority: { name: "High" },
    },
  });
  assert.equal(nex5.sandboxScenario, "lock");
  assert.equal(nex5.detail, "sufficient");
  assert.equal(nex5.severity, "High");
  assert.match(nex5.disclaimer, /simulated sandbox data/);
  assert.doesNotMatch(JSON.stringify(nex5), /lockWaitMs/);

  const nex6 = mapJiraIssue({
    key: "NEX-6",
    fields: {
      ...shared,
      summary: "Catalog returns 503 for all product pages",
      description:
        "Simulated sandbox data. Expected agent outcome: abstain and escalate the outage. No customer trace is attached.",
      priority: { name: "Highest" },
    },
  });
  assert.equal(nex6.sandboxScenario, "outage");
  assert.equal(nex6.severity, "Highest");

  const nex7 = mapJiraIssue({
    key: "NEX-7",
    fields: {
      ...shared,
      summary: "Some users see wrong cart totals",
      description:
        "Simulated sandbox data. Expected agent outcome: ask for more information. Evidence is thin. No traces, logs, or reproduction are attached.",
      priority: { name: "Medium" },
    },
  });
  assert.equal(nex7.sandboxScenario, "ask-for-info");
  assert.equal(nex7.detail, "sparse");
  assert.equal(nex7.fallback, "none");
  assert.match(nex7.ask, /Ask the engineer/);
  assert.doesNotMatch(nex7.symptom, /p95|lock wait|\$\d/);
});

test("NI-1042 stays the seeded example even though it looks like a key", async () => {
  const ticket = await resolveTicket("NI-1042", {
    JIRA_EMAIL: "engineer@example.com",
    JIRA_API_TOKEN: "test-token",
  });
  assert.equal(ticket.source, "seeded");
  assert.equal(ticket.id, "NI-1042");
});
