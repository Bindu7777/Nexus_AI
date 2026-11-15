// Log platforms that are placeholders for now. Each will read through the
// platform's query API with a read-only key, behind the same interface.
import { createStubConnector } from "../stub";

export const createDatadogLogsConnector = () =>
  createStubConnector({ id: "datadog-logs", kind: "logs", description: "Datadog Logs (placeholder)." });
export const createCloudWatchLogsConnector = () =>
  createStubConnector({ id: "cloudwatch-logs", kind: "logs", description: "AWS CloudWatch Logs (placeholder)." });
export const createLokiLogsConnector = () =>
  createStubConnector({ id: "loki-logs", kind: "logs", description: "Grafana Loki (placeholder)." });
export const createSentryConnector = () =>
  createStubConnector({ id: "sentry", kind: "logs", description: "Sentry issues and events (placeholder)." });
