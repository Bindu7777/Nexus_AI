# nexus-mcp

The Nexus MCP server for engineers. Your IDE's agent fetches the evidence
Nexus asks for with the tools you are already signed into; Nexus decides
what it means. Nexus holds no Jira, GitHub, database or docs credentials and
never writes to them.

```bash
nexus-mcp            # stdio, started by your IDE (see docs/ide-setup.md)
nexus-mcp --demo     # stdio against the seeded demo company
nexus-mcp --http     # streamable HTTP inside your network (see .env.example)
nexus-mcp user add <login> <company-id>   # pilot sign-in user
```

Install from disk: `npm install -g ./nexus-mcp-0.2.0.tgz`. Container:
`docker build -t nexus-mcp:0.2.0 .` then run with a volume on `/data`.
