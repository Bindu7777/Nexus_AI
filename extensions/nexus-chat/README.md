# Nexus defect chat

VS Code Copilot Chat participant `@nexus`. It calls the shared sandbox engine in this repository.

Install the packaged `nexus-defect-chat.vsix`. The catalog from `npm run demo` must already be running. This extension does not call a model of its own choosing: it uses the model selected in Copilot Chat, then checks that narrative against the rule-based diagnosis.

`@nexus /investigate NI-1042` runs the seeded scenario. `@nexus /investigate NEX-4` reads Jira only when credentials are set, and only with HTTP GET.
