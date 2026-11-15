# Nexus MCP server, HTTP mode, for an install inside the customer's network.
# Build from packages/nexus-mcp after `npm run nexus-mcp:build`:
#   docker build -t nexus-mcp:0.2.0 packages/nexus-mcp
# No telemetry. At run time the only outbound call is to the configured
# identity provider's key set (NEXUS_OIDC_JWKS_URL), if one is set.
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json ./
# Native modules (better-sqlite3, argon2) install their prebuilt binaries here, at build time.
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY dist ./dist
COPY services ./services

RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production \
    NEXUS_HTTP_HOST=0.0.0.0 \
    NEXUS_HTTP_PORT=4320 \
    NEXUS_IDE_DB=/data/ide.sqlite
VOLUME ["/data"]
EXPOSE 4320
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:4320/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "dist/nexus-mcp.mjs"]
CMD ["--http"]
