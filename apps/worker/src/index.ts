import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createLogger, loadConfig } from '@automation/shared';

const config = loadConfig();
const log = createLogger('worker', config.LOG_LEVEL);

const READY_CACHE_MS = 30_000;
let readyCache: { at: number; ok: boolean } | undefined;

/** Readiness = Chromium can actually launch and close. Cached to avoid launching on every probe. */
async function chromiumReady(): Promise<boolean> {
  if (readyCache && Date.now() - readyCache.at < READY_CACHE_MS) return readyCache.ok;
  let ok = false;
  const started = Date.now();
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    ok = true;
    log.info('browser readiness check passed', { event: 'browser.ready', durationMs: Date.now() - started });
  } catch (err) {
    log.error('browser readiness check failed', {
      event: 'browser.ready',
      errorCategory: 'browser_launch',
      error: err instanceof Error ? err.message.split('\n')[0] : 'unknown',
    });
  }
  readyCache = { at: Date.now(), ok };
  return ok;
}

const server = createServer((req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const path = (req.url ?? '/').split('?')[0];
  if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });

  if (path === '/health') return send(200, { status: 'ok', service: 'worker' });
  if (path === '/health/ready') {
    void chromiumReady().then((ok) =>
      send(ok ? 200 : 503, { status: ok ? 'ok' : 'degraded', service: 'worker', checks: { chromium: ok } }),
    );
    return;
  }
  return send(404, { error: 'not_found' });
});

server.listen(config.WORKER_PORT, '0.0.0.0', () => {
  log.info('worker listening', { event: 'worker.start', port: config.WORKER_PORT });
});

function shutdown(signal: string) {
  log.info('worker shutting down', { event: 'worker.stop', signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
