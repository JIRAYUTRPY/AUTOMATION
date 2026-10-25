import { redactUrl } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  jobId?: string;
  projectId?: string;
  url?: string;
  status?: string;
  durationMs?: number;
  errorCategory?: string;
  event?: string;
  [key: string]: unknown;
}

const FORBIDDEN_KEYS = /^(cookie|cookies|authorization|password|passwd|token|set-cookie)$/i;

export function createLogger(service: string, level: LogLevel = 'info') {
  const emit = (lvl: LogLevel, msg: string, fields: LogFields = {}) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (FORBIDDEN_KEYS.test(k)) continue;
      safe[k] = k === 'url' && typeof v === 'string' ? redactUrl(v) : v;
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), level: lvl, service, msg, ...safe });
    (lvl === 'error' ? process.stderr : process.stdout).write(line + '\n');
  };
  return {
    debug: (m: string, f?: LogFields) => emit('debug', m, f),
    info: (m: string, f?: LogFields) => emit('info', m, f),
    warn: (m: string, f?: LogFields) => emit('warn', m, f),
    error: (m: string, f?: LogFields) => emit('error', m, f),
  };
}
