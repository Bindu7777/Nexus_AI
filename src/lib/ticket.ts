export const seededTicket = {
  id: "NI-1042",
  kind: "Seeded example",
  title: "Product page reads stall when several shoppers browse at once",
  service: "catalog (local sandbox)",
  openedAt: "7 Nov 2026, 09:40 IST",
  severity: "Example severity 2",
  reporter: "Seeded scenario",
  symptom:
    "One shopper can open a product promptly. When several product reads overlap, responses stretch and a few clients give up. The last change to this sandbox read path rebuilds the catalog snapshot on every request while holding the catalog lock.",
  ask: "Show the slowdown from evidence collected in the sandbox, then propose a change an engineer can validate here before anything is shipped.",
  disclaimer:
    "This ticket was written for the demo. It is not a Jira issue, and it was not synced from a tracker.",
};
