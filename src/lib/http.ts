import { lookup } from 'node:dns/promises';

// True if an IP literal is loopback / private / link-local / CGNAT (IPv4 or IPv6, incl. IPv4-mapped IPv6).
export function isPrivateIp(ip: string): boolean {
  const s = ip.toLowerCase();
  const v4 = s.startsWith('::ffff:') ? s.slice(7) : s;
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);
    if (a === 0 || a === 10 || a === 127) return true;          // this-host / private / loopback
    if (a === 169 && b === 254) return true;                    // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;           // private
    if (a === 192 && b === 168) return true;                    // private
    if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT 100.64/10
    if (a === 192 && b === 0 && c === 0) return true;           // 192.0.0/24
    if (a === 198 && (b === 18 || b === 19)) return true;       // 198.18/15 benchmarking
    return false;
  }
  if (s === '::1' || s === '::') return true;                   // IPv6 loopback / unspecified
  if (s.startsWith('fc') || s.startsWith('fd')) return true;    // fc00::/7 unique-local
  if (/^fe[89ab]/.test(s)) return true;                        // fe80::/10 link-local
  return false;
}

// Outbound fetch with a hard timeout. Server routes call third-party APIs
// (Gemini, BRIA, SerpAPI, newsdata, scrapers); a hung upstream must not hold a
// serverless slot for the platform's full execution limit.
// SSRF guard for routes that fetch user-supplied URLs: only plain http(s) to PUBLIC addresses. Blocks
// localhost, IPv6 literals, and private/link-local IPv4 literals — AND resolves the hostname via DNS so a
// name that points at an internal address (e.g. 127.0.0.1.nip.io or an attacker A-record -> 169.254.169.254)
// is rejected too. Fail-closed: unresolvable hosts are rejected. Async because of the DNS lookup.
export async function isSafePublicUrl(raw: string): Promise<boolean> {
  let host: string;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host.includes(':') || host.startsWith('[')) return false;          // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return !isPrivateIp(host);   // IPv4 literal
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every(a => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
