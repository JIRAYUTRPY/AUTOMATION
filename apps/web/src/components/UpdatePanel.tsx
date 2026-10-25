'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Status {
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
  checkError: string | null;
  updaterEnabled: boolean;
  updaterReachable: boolean;
}
interface Progress {
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  from: string | null;
  to: string | null;
  log: string[];
}
type Phase = 'idle' | 'confirming' | 'running' | 'succeeded' | 'failed';

const MANUAL = 'docker compose pull && docker compose up -d';

export function UpdatePanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(`/api/update/status${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as Status);
      setLoadError(null);
    } catch {
      setLoadError('Could not load version information.');
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  function poll(adminToken: string) {
    let restartingTicks = 0;
    timer.current = setInterval(async () => {
      try {
        const res = await fetch('/api/update', { headers: { 'x-admin-token': adminToken }, cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        restartingTicks = 0;
        const p = (await res.json()) as Progress;
        setLog(p.log);
        if (p.state === 'succeeded' || p.state === 'failed') {
          if (timer.current) clearInterval(timer.current);
          setPhase(p.state);
          setMessage(p.state === 'succeeded' ? `Update finished (${p.from ?? '?'} to ${p.to ?? '?'}).` : 'Update failed. Your previous version was kept.');
          setToken('');
          void load(true);
        }
      } catch {
        // The web container itself is restarted by the update; keep polling quietly.
        restartingTicks += 1;
        setMessage(restartingTicks > 1 ? 'The application is restarting...' : null);
        if (restartingTicks > 90) {
          if (timer.current) clearInterval(timer.current);
          setPhase('failed');
          setMessage('The application did not come back. Check `docker compose ps` and logs on the server.');
        }
      }
    }, 2000);
  }

  async function start() {
    setMessage(null);
    const adminToken = token;
    const res = await fetch('/api/update', { method: 'POST', headers: { 'x-admin-token': adminToken } });
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (res.status === 202) {
      setPhase('running');
      setLog([]);
      poll(adminToken);
    } else if (res.status === 409 && body.error === 'update_in_progress') {
      setPhase('running');
      poll(adminToken);
    } else {
      setMessage(body.message ?? 'Could not start the update.');
    }
  }

  if (loadError) return <p role="alert" className="text-sm text-red-700">{loadError}</p>;
  if (!status) return <p className="text-sm text-neutral-600">Checking version...</p>;

  const canUpdate = status.updaterEnabled && status.updaterReachable;

  return (
    <section aria-labelledby="update-heading" className="mt-8 rounded-lg border border-neutral-300 p-4">
      <h2 id="update-heading" className="text-lg font-semibold">Version</h2>
      <p className="mt-2 text-sm">
        Installed: <code>{status.currentVersion}</code>
        {status.latestVersion && <> &middot; Latest: <code>{status.latestVersion}</code></>}
      </p>
      {status.checkError && <p className="mt-1 text-sm text-neutral-700">{status.checkError}</p>}

      <div aria-live="polite" className="mt-3 text-sm">
        {status.updateAvailable ? (
          <p>
            A new version is available.{' '}
            {status.releaseUrl && (
              <a className="underline" href={status.releaseUrl} target="_blank" rel="noopener noreferrer">Release notes</a>
            )}
          </p>
        ) : (
          status.latestVersion && <p>You are on the latest version.</p>
        )}
        {message && <p className="mt-2">{message}</p>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded border border-neutral-400 px-4" onClick={() => void load(true)}>
          Check for updates
        </button>
        {status.updateAvailable && canUpdate && phase === 'idle' && (
          <button type="button" className="min-h-11 rounded bg-neutral-900 px-4 text-white" onClick={() => setPhase('confirming')}>
            Update to {status.latestVersion}
          </button>
        )}
      </div>

      {phase === 'confirming' && (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void start(); }}>
          <p className="text-sm">
            This pulls the new images and restarts the web and worker containers. Running scans and
            tests will be interrupted. Back up the data volume first if it matters.
          </p>
          <label className="block text-sm font-medium" htmlFor="admin-token">Admin token (ADMIN_TOKEN from .env)</label>
          <input
            id="admin-token" type="password" autoComplete="off" required value={token}
            onChange={(e) => setToken(e.target.value)}
            className="min-h-11 w-full max-w-md rounded border border-neutral-400 px-3"
          />
          <div className="flex gap-2">
            <button type="submit" className="min-h-11 rounded bg-neutral-900 px-4 text-white">Confirm update</button>
            <button type="button" className="min-h-11 rounded border border-neutral-400 px-4" onClick={() => { setPhase('idle'); setToken(''); }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {(phase === 'running' || log.length > 0) && (
        <pre aria-label="Update log" className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-100 p-3 text-xs">
          {log.join('\n') || 'Starting...'}
        </pre>
      )}

      {phase === 'succeeded' && (
        <button type="button" className="mt-3 min-h-11 rounded bg-neutral-900 px-4 text-white" onClick={() => window.location.reload()}>
          Reload page
        </button>
      )}

      {!canUpdate && (
        <p className="mt-4 text-sm text-neutral-700">
          In-app update is not enabled{status.updaterEnabled ? ' (updater unreachable)' : ''}. To update manually,
          run this in the install directory: <code className="break-all">{MANUAL}</code>
        </p>
      )}
    </section>
  );
}
