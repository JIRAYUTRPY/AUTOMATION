import { createHash, timingSafeEqual } from 'node:crypto';
import { isNewerVersion, loadConfig, parseSemver } from '@automation/shared';

const CACHE_MS = 60 * 60 * 1000;
let cache: { at: number; repo: string; value: LatestRelease } | undefined;

export interface LatestRelease {
  version: string | null;
  url: string | null;
  error?: string;
}

/** Latest published (non-draft, non-prerelease) GitHub release, cached for an hour. */
export async function getLatestRelease(repo: string, force = false): Promise<LatestRelease> {
  if (!force && cache && cache.repo === repo && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: LatestRelease;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'automation-web' },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    if (res.status === 404) {
      value = { version: null, url: null, error: 'No release has been published yet.' };
    } else if (!res.ok) {
      value = { version: null, url: null, error: `Release lookup failed (HTTP ${res.status}).` };
    } else {
      const body = (await res.json()) as { tag_name?: string; html_url?: string };
      const tag = String(body.tag_name ?? '').replace(/^v/, '');
      value = parseSemver(tag)
        ? { version: tag, url: typeof body.html_url === 'string' ? body.html_url : null }
        : { version: null, url: null, error: 'Latest release tag is not a plain x.y.z version.' };
    }
  } catch {
    value = { version: null, url: null, error: 'Could not reach GitHub to check for updates.' };
  }
  cache = { at: Date.now(), repo, value };
  return value;
}

export async function getUpdateStatus(force = false) {
  const config = loadConfig();
  const latest = await getLatestRelease(config.UPDATE_REPO, force);
  let updaterReachable = false;
  if (config.UPDATER_ENABLED) {
    try {
      const r = await fetch(`${config.UPDATER_URL}/health`, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
      updaterReachable = r.ok;
    } catch {
      updaterReachable = false;
    }
  }
  return {
    currentVersion: config.APP_VERSION,
    latestVersion: latest.version,
    releaseUrl: latest.url,
    updateAvailable: latest.version !== null && isNewerVersion(latest.version, config.APP_VERSION),
    checkError: latest.error ?? null,
    updaterEnabled: config.UPDATER_ENABLED,
    updaterReachable,
  };
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** 'disabled' when no ADMIN_TOKEN is configured; otherwise constant-time comparison. */
export function checkAdminToken(req: Request): 'ok' | 'denied' | 'disabled' {
  const expected = loadConfig().ADMIN_TOKEN;
  if (!expected) return 'disabled';
  const given = req.headers.get('x-admin-token') ?? '';
  return given && timingSafeEqual(digest(given), digest(expected)) ? 'ok' : 'denied';
}

/** Call the updater sidecar. Never forwards user input: path and method are fixed by callers. */
export async function updaterRequest(path: '/update' | '/status', method: 'GET' | 'POST') {
  const config = loadConfig();
  if (!config.UPDATER_ENABLED || !config.UPDATER_TOKEN) return null;
  return fetch(`${config.UPDATER_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${config.UPDATER_TOKEN}` },
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
  });
}
