// Blocks connection tests from reaching internal or metadata addresses unless
// the admin explicitly allowed that target.
import { lookup } from "node:dns/promises";
import net from "node:net";

function v4ToInt(ip: string) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4(ip: string, cidr: string) {
  const [base, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

const V4_BLOCKED = ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4"];

export function isInternalAddress(ip: string) {
  if (net.isIPv4(ip)) return V4_BLOCKED.some((c) => inV4(ip, c));
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("::ffff:")) return isInternalAddress(lower.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower) || lower.startsWith("fd00:ec2");
  }
  return true;
}

export type TargetCheck = { ok: true; host: string } | { ok: false; message: string };

/** Validates a URL (http/https only, no embedded credentials) and its resolved addresses. */
export async function checkUrlTarget(raw: string, allowInternal: boolean): Promise<TargetCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: `"${raw}" is not a valid URL.` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, message: "Only http and https URLs are allowed." };
  if (url.username || url.password) return { ok: false, message: "Do not put credentials in the URL. Use the token field." };
  return checkHostTarget(url.hostname, allowInternal);
}

export async function checkHostTarget(hostname: string, allowInternal: boolean): Promise<TargetCheck> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, message: "A host is required." };
  let addresses: string[];
  try {
    addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    return { ok: false, message: `The host "${host}" could not be resolved from the Nexus server.` };
  }
  const metadata = addresses.some((a) => a === "169.254.169.254" || a.toLowerCase() === "fd00:ec2::254");
  if (metadata) return { ok: false, message: "That address is a cloud metadata endpoint and is always blocked." };
  if (!allowInternal && addresses.some(isInternalAddress)) {
    return {
      ok: false,
      message: `"${host}" resolves to a private or loopback address. If this system is inside the customer's network, tick "allow a private address" for this connection.`,
    };
  }
  return { ok: true, host };
}
