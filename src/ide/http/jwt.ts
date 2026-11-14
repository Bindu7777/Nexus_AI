// Verifies access tokens issued by the company's own identity provider
// (OAuth 2.1 / OpenID Connect) with node:crypto. No dependency.
//
// Checks, every call: signature against the IdP's JWKS, allowed algorithm,
// issuer, audience (this Nexus server only), expiry and not-before.
import { createPublicKey, verify as verifySig, type JsonWebKey, type KeyObject } from "node:crypto";

export type OidcConfig = {
  issuer: string;
  jwksUrl: string;
  /** This server's resource identifier. Tokens for anything else are refused. */
  audience: string;
  /** Fixed company for this install, or a claim to read it from. */
  companyId?: string;
  companyClaim?: string;
  algorithms?: string[];
  /** Scopes required on every token; nexus.approve is checked separately. */
  requiredScope?: string;
};

export type Verified = { sub: string; label: string; companyId: string; scopes: string[]; expiresAt: number; clientId: string | null };

export class TokenError extends Error {}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

const ALGS: Record<string, { hash: string | null; kty: string; dsa?: "ieee-p1363" }> = {
  RS256: { hash: "sha256", kty: "RSA" },
  RS384: { hash: "sha384", kty: "RSA" },
  RS512: { hash: "sha512", kty: "RSA" },
  PS256: { hash: "sha256", kty: "RSA" },
  ES256: { hash: "sha256", kty: "EC", dsa: "ieee-p1363" },
  ES384: { hash: "sha384", kty: "EC", dsa: "ieee-p1363" },
  EdDSA: { hash: null, kty: "OKP" },
};

export function createJwksVerifier(config: OidcConfig, fetchImpl: typeof fetch = fetch, now = () => Date.now()) {
  const allowed = new Set(config.algorithms?.length ? config.algorithms : ["RS256", "ES256", "EdDSA", "PS256"]);
  for (const a of allowed) if (!ALGS[a]) throw new Error(`Unsupported algorithm ${a}.`);
  const u = new URL(config.jwksUrl);
  if (u.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new Error("The JWKS URL must use https.");
  let cache: { at: number; keys: Jwk[] } | null = null;

  async function keys(force = false): Promise<Jwk[]> {
    if (!force && cache && now() - cache.at < 10 * 60_000) return cache.keys;
    const res = await fetchImpl(config.jwksUrl, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new TokenError(`The identity provider's key set answered HTTP ${res.status}.`);
    const body = (await res.json()) as { keys?: Jwk[] };
    cache = { at: now(), keys: Array.isArray(body.keys) ? body.keys : [] };
    return cache.keys;
  }

  return async function verifyJwt(token: string): Promise<Verified> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new TokenError("Not a JWT.");
    let header: { alg?: string; kid?: string; typ?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(b64url(parts[0]).toString("utf8"));
      claims = JSON.parse(b64url(parts[1]).toString("utf8"));
    } catch {
      throw new TokenError("The token could not be read.");
    }
    const alg = header.alg ?? "";
    if (!allowed.has(alg)) throw new TokenError(`Algorithm ${alg || "none"} is not allowed.`);
    const spec = ALGS[alg];
    const pick = (list: Jwk[]) => list.filter((k) => k.kty === spec.kty && (!header.kid || k.kid === header.kid) && (!k.alg || k.alg === alg) && (!k.use || k.use === "sig"));
    let candidates = pick(await keys());
    if (!candidates.length) candidates = pick(await keys(true));
    if (!candidates.length) throw new TokenError("No signing key matches this token.");
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    const sig = b64url(parts[2]);
    const ok = candidates.some((jwk) => {
      let key: KeyObject;
      try {
        key = createPublicKey({ key: jwk, format: "jwk" });
      } catch {
        return false;
      }
      const opts = alg.startsWith("PS") ? { key, padding: 6, saltLength: Number(spec.hash!.slice(3)) / 8 } : spec.dsa ? { key, dsaEncoding: spec.dsa } : key;
      try {
        return verifySig(spec.hash, data, opts as never, sig);
      } catch {
        return false;
      }
    });
    if (!ok) throw new TokenError("The token signature is not valid.");
    const t = Math.floor(now() / 1000);
    const skew = 60;
    if (claims.iss !== config.issuer) throw new TokenError("The token was issued by a different identity provider.");
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(config.audience)) throw new TokenError("The token is not meant for this Nexus server.");
    if (typeof claims.exp !== "number" || claims.exp + skew < t) throw new TokenError("The token has expired.");
    if (typeof claims.nbf === "number" && claims.nbf - skew > t) throw new TokenError("The token is not valid yet.");
    if (typeof claims.sub !== "string" || !claims.sub) throw new TokenError("The token names no user.");
    const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : Array.isArray(claims.scp) ? claims.scp.map(String) : [];
    if (config.requiredScope && !scopes.includes(config.requiredScope)) throw new TokenError(`The token lacks the ${config.requiredScope} scope.`);
    const company = config.companyClaim ? claims[config.companyClaim] : config.companyId;
    if (typeof company !== "string" || !company) throw new TokenError("The token names no company.");
    const label = [claims.email, claims.preferred_username, claims.name, claims.sub].find((v) => typeof v === "string" && v) as string;
    return { sub: claims.sub, label, companyId: company, scopes, expiresAt: claims.exp * 1000, clientId: typeof claims.client_id === "string" ? claims.client_id : typeof claims.azp === "string" ? claims.azp : null };
  };
}
