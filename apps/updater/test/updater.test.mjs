import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createUpdater, setEnvValue } from '../src/updater.mjs';

const TOKEN = 'a'.repeat(40);
const ORIGINAL_ENV = 'APP_PORT=3000\nAUTOMATION_VERSION=0.1.0\nADMIN_TOKEN=keepme\n';

async function setup({ tag = 'v0.2.0', failOn = '', sleep = '0' } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'upd-'));
  await writeFile(path.join(dir, '.env'), ORIGINAL_ENV);
  await writeFile(path.join(dir, 'docker-compose.yml'), 'services: {}\n');
  const logFile = path.join(dir, 'docker.log');
  const fake = path.join(dir, 'fake-docker.sh');
  await writeFile(
    fake,
    `#!/bin/sh\necho "$*" >> "${logFile}"\nsleep ${sleep}\ncase " $* " in *" ${failOn || '__never__'} "*) exit 1;; esac\nexit 0\n`,
  );
  await chmod(fake, 0o755);

  const gh = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tag_name: tag }));
  });
  await new Promise((r) => gh.listen(0, '127.0.0.1', r));

  const server = createUpdater({
    token: TOKEN, installDir: dir, repo: 'o/r', project: 'automation',
    services: ['web', 'worker'], dockerBin: fake,
    githubApi: `http://127.0.0.1:${gh.address().port}`,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, p, token = TOKEN) =>
    fetch(base + p, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const calls = async () => {
    try { return (await readFile(logFile, 'utf8')).trim().split('\n').filter(Boolean); } catch { return []; }
  };
  const finish = async () => {
    for (let i = 0; i < 100; i++) {
      const s = await (await call('GET', '/status')).json();
      if (s.state !== 'running') return s;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('update did not finish');
  };
  const env = () => readFile(path.join(dir, '.env'), 'utf8');
  const close = () => { server.close(); gh.close(); };
  return { call, calls, finish, env, close };
}

test('auth: health is open, everything else needs the token', async () => {
  const t = await setup();
  assert.equal((await t.call('GET', '/health', null)).status, 200);
  assert.equal((await t.call('GET', '/status', null)).status, 401);
  assert.equal((await t.call('GET', '/status', 'wrong')).status, 401);
  assert.equal((await t.call('POST', '/update', null)).status, 401);
  assert.equal((await t.calls()).length, 0, 'no docker command without auth');
  t.close();
});

test('successful update pulls then recreates, and rewrites only AUTOMATION_VERSION', async () => {
  const t = await setup();
  assert.equal((await t.call('POST', '/update')).status, 202);
  const s = await t.finish();
  assert.equal(s.state, 'succeeded');
  assert.equal(s.from, '0.1.0');
  assert.equal(s.to, '0.2.0');
  assert.equal(await t.env(), 'APP_PORT=3000\nAUTOMATION_VERSION=0.2.0\nADMIN_TOKEN=keepme\n');
  const c = await t.calls();
  assert.equal(c.length, 2);
  assert.match(c[0], /^compose -p automation --project-directory \S+ -f \S+ --env-file \S+ pull web worker$/);
  assert.match(c[1], / up -d --no-build web worker$/);
  t.close();
});

test('already up to date does nothing', async () => {
  const t = await setup({ tag: 'v0.1.0' });
  await t.call('POST', '/update');
  const s = await t.finish();
  assert.equal(s.state, 'succeeded');
  assert.equal((await t.calls()).length, 0);
  assert.equal(await t.env(), ORIGINAL_ENV);
  t.close();
});

test('pull failure reverts the version and never recreates containers', async () => {
  const t = await setup({ failOn: 'pull' });
  await t.call('POST', '/update');
  const s = await t.finish();
  assert.equal(s.state, 'failed');
  assert.equal(await t.env(), ORIGINAL_ENV);
  const c = await t.calls();
  assert.equal(c.length, 1);
  assert.match(c[0], / pull /);
  t.close();
});

test('recreate failure reverts the version and retries to restore previous containers', async () => {
  const t = await setup({ failOn: 'up' });
  await t.call('POST', '/update');
  const s = await t.finish();
  assert.equal(s.state, 'failed');
  assert.equal(await t.env(), ORIGINAL_ENV);
  assert.equal((await t.calls()).filter((l) => / up /.test(l)).length, 2);
  t.close();
});

test('prerelease or odd tags are rejected without touching docker or .env', async () => {
  for (const tag of ['v1.0.0-rc1', 'latest', 'v1.0.0; rm -rf /']) {
    const t = await setup({ tag });
    await t.call('POST', '/update');
    const s = await t.finish();
    assert.equal(s.state, 'failed', tag);
    assert.equal(await t.env(), ORIGINAL_ENV);
    assert.equal((await t.calls()).length, 0);
    t.close();
  }
});

test('second update request while one is running gets 409', async () => {
  const t = await setup({ sleep: '1' });
  assert.equal((await t.call('POST', '/update')).status, 202);
  assert.equal((await t.call('POST', '/update')).status, 409);
  await t.finish();
  t.close();
});

test('config validation and env injection guards', () => {
  const base = { installDir: '/x', repo: 'o/r', project: 'p', services: ['web'], dockerBin: 'd', githubApi: 'g' };
  assert.throws(() => createUpdater({ ...base, token: 'short' }), /UPDATER_TOKEN/);
  assert.throws(() => createUpdater({ ...base, token: TOKEN, installDir: 'relative' }), /absolute/);
  assert.throws(() => createUpdater({ ...base, token: TOKEN, repo: 'not a repo' }), /owner\/repo/);
  assert.throws(() => setEnvValue('A=1\n', 'AUTOMATION_VERSION', '1.0.0\nADMIN_TOKEN=x'), /unsafe/);
  assert.equal(setEnvValue('A=1', 'B', '2'), 'A=1\nB=2\n');
});
