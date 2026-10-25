// Optional self-update service. Zero dependencies on purpose.
//
// Security model:
//  - Mounts the Docker socket (root-equivalent on the host), so it is opt-in and must only be
//    reachable on the internal Compose network.
//  - Every route except /health requires a bearer token.
//  - POST /update takes NO user input. The target version comes from the project's GitHub
//    releases and must match a strict x.y.z pattern. Commands run without a shell.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual, createHash } from 'node:crypto';
import { readFile, writeFile, rename, stat, chown } from 'node:fs/promises';
import path from 'node:path';

const SEMVER = /^\d+\.\d+\.\d+$/;
const MAX_LOG_LINES = 200;

const digest = (s) => createHash('sha256').update(s).digest();
const tokenOk = (given, expected) => timingSafeEqual(digest(given), digest(expected));

/** Replace or append KEY=value in .env text. Value must be a safe literal. */
export function setEnvValue(text, key, value) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error('unsafe env key/value');
  }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return text.endsWith('\n') || text === '' ? `${text}${line}\n` : `${text}\n${line}\n`;
}

export function getEnvValue(text, key) {
  const m = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
  return m ? m[1].trim() : undefined;
}

/**
 * @param {{token:string, installDir:string, repo:string, project:string, services:string[],
 *   dockerBin:string, githubApi:string}} cfg
 */
export function createUpdater(cfg) {
  if (!cfg.token || cfg.token.length < 32) throw new Error('UPDATER_TOKEN must be at least 32 chars');
  if (!path.isAbsolute(cfg.installDir)) throw new Error('INSTALL_DIR must be absolute');
  if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) throw new Error('UPDATE_REPO must be owner/repo');
  if (!cfg.services.every((s) => /^[a-z][a-z0-9_-]*$/.test(s))) throw new Error('bad service name');

  const envFile = path.join(cfg.installDir, '.env');
  const composeFile = path.join(cfg.installDir, 'docker-compose.yml');
  const state = { state: 'idle', startedAt: null, finishedAt: null, from: null, to: null, log: [] };

  const log = (msg) => {
    state.log.push(`${new Date().toISOString()} ${String(msg).slice(0, 500)}`);
    if (state.log.length > MAX_LOG_LINES) state.log.shift();
  };

  const compose = (args) =>
    new Promise((resolve) => {
      const full = [
        'compose', '-p', cfg.project, '--project-directory', cfg.installDir,
        '-f', composeFile, '--env-file', envFile, ...args,
      ];
      log(`$ docker ${args.join(' ')}`);
      const child = spawn(cfg.dockerBin, full, { stdio: ['ignore', 'pipe', 'pipe'] });
      const pipe = (stream) =>
        stream.on('data', (b) => String(b).split('\n').filter(Boolean).forEach(log));
      pipe(child.stdout);
      pipe(child.stderr);
      child.on('error', (e) => { log(`spawn error: ${e.message}`); resolve(127); });
      child.on('close', (code) => resolve(code ?? 1));
    });

  async function latestVersion() {
    const res = await fetch(`${cfg.githubApi}/repos/${cfg.repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'automation-updater' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`release lookup failed: HTTP ${res.status}`);
    const body = await res.json();
    const version = String(body.tag_name ?? '').replace(/^v/, '');
    if (!SEMVER.test(version)) throw new Error('latest release tag is not a plain x.y.z version');
    return version;
  }

  async function writeEnvAtomic(text) {
    const tmp = `${envFile}.tmp`;
    const owner = await stat(envFile);
    await writeFile(tmp, text, { mode: 0o600 });
    // Keep the installing user's ownership so they can still read/edit .env after an update.
    try { await chown(tmp, owner.uid, owner.gid); } catch { /* not root (e.g. tests) */ }
    await rename(tmp, envFile);
  }

  async function runUpdate() {
    let original;
    try {
      original = await readFile(envFile, 'utf8');
      const current = getEnvValue(original, 'AUTOMATION_VERSION') ?? 'latest';
      state.from = current;
      const target = await latestVersion();
      state.to = target;
      log(`current=${current} latest=${target}`);
      if (current === target) {
        log('already up to date');
        state.state = 'succeeded';
        return;
      }
      await writeEnvAtomic(setEnvValue(original, 'AUTOMATION_VERSION', target));

      if ((await compose(['pull', ...cfg.services])) !== 0) {
        await writeEnvAtomic(original);
        log('pull failed; version change reverted, running containers untouched');
        state.state = 'failed';
        return;
      }
      if ((await compose(['up', '-d', '--no-build', ...cfg.services])) !== 0) {
        await writeEnvAtomic(original);
        log('recreate failed; version reverted, attempting to restore previous containers');
        await compose(['up', '-d', '--no-build', ...cfg.services]);
        state.state = 'failed';
        return;
      }
      log(`updated to ${target}`);
      state.state = 'succeeded';
    } catch (e) {
      log(`error: ${e.message}`);
      if (original !== undefined) {
        try { await writeEnvAtomic(original); } catch { /* best effort */ }
      }
      state.state = 'failed';
    } finally {
      state.finishedAt = new Date().toISOString();
    }
  }

  return http.createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const url = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && url === '/health') return send(200, { status: 'ok', service: 'updater' });

    const auth = req.headers.authorization ?? '';
    const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!given || !tokenOk(given, cfg.token)) return send(401, { error: 'unauthorized' });

    if (req.method === 'GET' && url === '/status') return send(200, state);
    if (req.method === 'POST' && url === '/update') {
      if (state.state === 'running') return send(409, { error: 'update_in_progress' });
      Object.assign(state, {
        state: 'running', startedAt: new Date().toISOString(), finishedAt: null,
        from: null, to: null, log: [],
      });
      void runUpdate();
      return send(202, { state: 'running' });
    }
    return send(404, { error: 'not_found' });
  });
}
