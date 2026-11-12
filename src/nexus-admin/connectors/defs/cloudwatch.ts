import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "cloudwatch",
  category: "logs",
  displayName: "AWS CloudWatch Logs",
  description: "Log events from the listed log groups.",
  tier: "next",
  deployments: ["cloud"],
  fields: [tokenField()],
  scopeFields: [{ name: "logGroups", label: "Log groups", type: "list", required: true, placeholder: "/aws/lambda/api" }],
  reads: ["log events"],
});
