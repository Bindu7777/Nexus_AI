# Nexus defect investigation

Use the custom agent in `.github/agents/nexus-investigator.agent.md`. The shared backend is the Nexus MCP server. Do not hardcode a model. The Copilot model picker is the model for the session.

The `@nexus` VS Code extension is optional. The built-in custom agent is the default path.

This is a sandbox demonstration. Do not claim production readiness, a proven production fix, or any percentage saving. The rule-based engine is the guardrail. A model may narrate the result, but it must not invent measurements.

Jira, when used, is read-only. Project key `NEX` (project name NEXUS) at https://nexusintelligence.atlassian.net. Defect issue type name: `Defect test`. Never create, edit, or transition an issue.

Ticket routing:

- `NI-1042` is the offline seeded example. Run the lock scenario.
- `NEX-5` (label `nexus-demo`, simulated sandbox data, High) maps to the lock scenario. Expected result: the rules find catalog lock contention from the live sandbox run.
- `NEX-6` (label `nexus-demo`, simulated sandbox data, Highest) maps to the outage scenario. Expected result: abstain and escalate. Do not call it lock contention.
- `NEX-7` (label `nexus-demo`, simulated sandbox data, Medium) is thin evidence about cart totals. Ask for traces, logs, or a reproduction. Do not measure a stand-in scenario and do not invent cart numbers.
- Any other Jira issue is fetched with HTTP GET only. If the text is too thin to describe a defect, say so. Do not invent evidence from it.

The OpenTelemetry Astronomy Shop target is a placeholder and is not running. Measure only `sandbox-catalog`.

Steps, in order, using only the Nexus MCP tools:

1. `get_ticket` with the ticket key. If the ticket is unavailable because Jira is not configured, stop. Do not invent the issue body.
2. If the ticket asks for more information, stop after saying what is missing.
3. `measure_service` for the mapped scenario. The load is live against the local catalog.
4. `collect_evidence`. Cite records. Source citations include `services/catalog/server.mjs` and the line range.
5. `diagnose`. Report the hypothesis, evidence, confidence (`high`, `low`, or `none`), and whether the rules abstain.
6. If the diagnosis abstains, do not propose a remediation. Summarize the abstain reason and label the result simulated/sandbox.
7. Otherwise `propose_remediation`. State that the proposal is not applied.
8. Ask the engineer to type the approval phrase `APPLY_SANDBOX_REMEDIATION`. Do not call `apply_sandbox_remediation` before that phrase. Any other token must be refused.
9. After the phrase, call `apply_sandbox_remediation` with that token, then `validate`.
10. Summarize with the evidence citations and an explicit simulated/sandbox label. The validation result is a sandbox check, not a production verification.
