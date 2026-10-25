import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * URL policy (FR-02). This is application-level validation only. It does NOT replace
 * network-level egress controls: DNS can change between check and use, so the worker
 * must also be blocked from private ranges at the network layer.
 */

export type UrlRejectionCode =
  | 'malformed'
  | 'unsupported_protocol'
  | 'credentials_not_allowed'
  | 'port_not_allowed'
  | 'prohibited_hostname'
  | 'prohibited_address'
  | 'dns_failure'
  | 'out_of_scope';

export class UrlPolicyError extends Error {
  constructor(
    public readonly code: UrlRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = 'UrlPolicyError';
  }
}

// ---------- IP classification ----------

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

function isProhibitedIPv4(o: number[]): boolean {
  const [a, b, c] = o as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expand an IPv6 literal to 8 16-bit groups, or null if invalid. */
function parseIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);

  // Embedded dotted IPv4 tail, e.g. ::ffff:1.2.3.4
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill('0'), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

function embeddedV4(g: number[], i: number): number[] {
  return [g[i]! >> 8, g[i]! & 255, g[i + 1]! >> 8, g[i + 1]! & 255];
}

function isProhibitedIPv6(g: number[]): boolean {
  const allZeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroUntil(7) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  if (allZeroUntil(5) && g[5] === 0xffff) return isProhibitedIPv4(embeddedV4(g, 6)); // v4-mapped
  if (allZeroUntil(6)) return true; // deprecated v4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isProhibitedIPv4(embeddedV4(g, 6)); // NAT64
  }
  if (g[0] === 0x2002) return isProhibitedIPv4(embeddedV4(g, 1)); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0]! & 0xffc0) === 0xfec0) return true; // deprecated site-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** True if the IP literal is not a safe public destination. Unparseable input is prohibited. */
export function isProhibitedIp(ip: string): boolean {
  const family = isIP(ip.replace(/^\[|\]$/g, ''));
  const bare = ip.replace(/^\[|\]$/g, '');
  if (family === 4) {
    const o = parseIPv4(bare);
    return o ? isProhibitedIPv4(o) : true;
  }
  if (family === 6) {
    const g = parseIPv6(bare);
    return g ? isProhibitedIPv6(g) : true;
  }
  return true;
}

// ---------- URL validation ----------

const PROHIBITED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata', 'instance-data']);

export interface ValidateOptions {
  allowedPorts?: number[];
  /** Injectable for tests. Must return every address the name resolves to. */
  resolve?: (hostname: string) => Promise<string[]>;
}

const defaultResolve = async (hostname: string): Promise<string[]> => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

/** Synchronous checks that never touch the network. */
export function validateUrlSyntax(raw: string, opts: ValidateOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UrlPolicyError('malformed', 'The URL is not valid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlPolicyError('unsupported_protocol', 'Only http and https URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new UrlPolicyError('credentials_not_allowed', 'URLs with embedded credentials are not allowed.');
  }
  const allowedPorts = opts.allowedPorts ?? [80, 443];
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!allowedPorts.includes(port)) {
    throw new UrlPolicyError('port_not_allowed', `Port ${port} is not allowed.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (
    host === 'localhost' ||
    METADATA_HOSTS.has(host) ||
    PROHIBITED_SUFFIXES.some((s) => host.endsWith(s))
  ) {
    throw new UrlPolicyError('prohibited_hostname', 'This hostname is not a public destination.');
  }
  if (isIP(host) !== 0 && isProhibitedIp(host)) {
    throw new UrlPolicyError(
      'prohibited_address',
      'This address is private, loopback, link-local, multicast or otherwise prohibited.',
    );
  }
  return url;
}

/**
 * Full validation: syntax, then DNS resolution with EVERY returned address checked.
 * Call again after each redirect and before each navigation.
 * Returns the parsed URL and the validated addresses (for logging/pinning by the caller).
 */
export async function validatePublicUrl(
  raw: string,
  opts: ValidateOptions = {},
): Promise<{ url: URL; addresses: string[] }> {
  const url = validateUrlSyntax(raw, opts);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return { url, addresses: [host] };

  let addresses: string[];
  try {
    addresses = await (opts.resolve ?? defaultResolve)(host);
  } catch {
    throw new UrlPolicyError('dns_failure', 'The hostname could not be resolved.');
  }
  if (addresses.length === 0) {
    throw new UrlPolicyError('dns_failure', 'The hostname did not resolve to any address.');
  }
  const bad = addresses.find(isProhibitedIp);
  if (bad !== undefined) {
    throw new UrlPolicyError(
      'prohibited_address',
      'The hostname resolves to a prohibited (private or internal) address.',
    );
  }
  return { url, addresses };
}

// ---------- Normalization and scope ----------

const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_ga|ref)$/i;

export interface NormalizeOptions {
  /** Query params to keep. 'none' drops all, 'all' keeps all, otherwise an allowlist of names. */
  keepQuery?: 'none' | 'all' | string[];
}

/** Canonical crawl identity: no fragment, lowercase host, default port dropped, sorted query. */
export function normalizeCrawlUrl(raw: string, opts: NormalizeOptions = {}): string {
  const url = new URL(raw);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }
  const keep = opts.keepQuery ?? 'none';
  const params = [...url.searchParams.entries()].filter(([k]) => {
    if (keep === 'none') return false;
    if (keep === 'all') return !TRACKING_PARAMS.test(k);
    return keep.includes(k);
  });
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = '';
  for (const [k, v] of params) url.searchParams.append(k, v);
  if (url.pathname === '') url.pathname = '/';
  return url.toString();
}

/** True if `candidate` shares the scope's origin and sits under its path prefix. */
export function isInScope(candidate: string, scopeOrigin: string, pathPrefix = '/'): boolean {
  let c: URL;
  try {
    c = new URL(candidate);
  } catch {
    return false;
  }
  if (c.origin !== new URL(scopeOrigin).origin) return false;
  const prefix = pathPrefix.endsWith('/') ? pathPrefix : `${pathPrefix}/`;
  return c.pathname === pathPrefix || (c.pathname + '/').startsWith(prefix) || pathPrefix === '/';
}
