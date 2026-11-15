// Sign-in to a Nexus server in HTTP mode (OAuth 2.1 with PKCE), for the
// extension's own connection. Tokens live in VS Code's SecretStorage. This
// signs in to Nexus only: Nexus never asks for Jira, GitHub, database or
// docs credentials.
import { randomBytes } from "node:crypto";
import http from "node:http";
import * as vscode from "vscode";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export class NexusOAuthProvider implements OAuthClientProvider {
  private verifier = "";
  private expectedState = "";
  constructor(
    private secrets: vscode.SecretStorage,
    private serverUrl: string,
    private port: number,
  ) {}

  private key(name: string) {
    return `nexus.oauth.${name}.${this.serverUrl}`;
  }

  get redirectUrl() {
    return `http://127.0.0.1:${this.port}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Nexus for VS Code",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      // The extension is where the engineer approves, so it asks for the approve scope.
      scope: "nexus.investigate nexus.approve",
    };
  }

  state() {
    this.expectedState = randomBytes(18).toString("base64url");
    return this.expectedState;
  }

  async clientInformation() {
    const raw = await this.secrets.get(this.key("client"));
    return raw ? (JSON.parse(raw) as OAuthClientInformationMixed) : undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed) {
    await this.secrets.store(this.key("client"), JSON.stringify(info));
  }

  async tokens() {
    const raw = await this.secrets.get(this.key("tokens"));
    return raw ? (JSON.parse(raw) as OAuthTokens) : undefined;
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.secrets.store(this.key("tokens"), JSON.stringify(tokens));
  }

  async redirectToAuthorization(url: URL) {
    // Only ever open the sign-in page of the configured Nexus server.
    if (new URL(this.serverUrl).origin !== url.origin) throw new Error("The sign-in page is not on the configured Nexus server.");
    await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
  }

  async saveCodeVerifier(v: string) {
    this.verifier = v;
  }

  async codeVerifier() {
    return this.verifier;
  }

  async signOut() {
    await this.secrets.delete(this.key("tokens"));
  }

  /** Waits on the loopback address for the browser's redirect and returns the code. */
  waitForCode(timeoutMs = 5 * 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const u = new URL(req.url ?? "/", this.redirectUrl);
        if (u.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const code = u.searchParams.get("code");
        const state = u.searchParams.get("state");
        const ok = Boolean(code) && (!this.expectedState || state === this.expectedState);
        res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
        res.end(ok ? "<!doctype html><title>Nexus</title><p>Signed in to Nexus. You can close this tab and return to VS Code.</p>" : "<!doctype html><title>Nexus</title><p>Sign-in failed. Try again from VS Code.</p>");
        server.close();
        clearTimeout(timer);
        if (ok) resolve(code!);
        else reject(new Error("The sign-in did not return a valid code."));
      });
      const timer = setTimeout(() => {
        server.close();
        reject(new Error("Sign-in timed out."));
      }, timeoutMs);
      server.on("error", reject);
      server.listen(this.port, "127.0.0.1");
    });
  }
}
