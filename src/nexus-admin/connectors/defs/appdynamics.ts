import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "appdynamics",
  category: "logs",
  displayName: "AppDynamics",
  description: "Events for the listed applications.",
  tier: "on-request",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "applications", label: "Applications", type: "list", required: true, placeholder: "checkout" }],
  reads: ["events"],
});
