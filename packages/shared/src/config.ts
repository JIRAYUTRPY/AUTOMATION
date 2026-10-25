import { z } from 'zod';

/** Hard upper bounds enforced regardless of what the environment requests. */
export const LIMITS = {
  maxPages: 500,
  maxConcurrency: 4,
  maxNavigationTimeoutMs: 60_000,
  maxJobTimeoutMs: 3_600_000,
  maxBrowserConcurrency: 4,
} as const;

const intFromEnv = (def: number, max: number, min = 1) =>
  z.coerce.number().int().min(min).max(max).default(def);

const schema = z.object({
  APP_PORT: intFromEnv(3000, 65535),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().min(1).default('file:./data/automation.db'),
  ARTIFACT_DIR: z.string().min(1).default('./data/artifacts'),
  ARTIFACT_RETENTION_DAYS: intFromEnv(30, 3650),
  WORKER_PORT: intFromEnv(4001, 65535),
  BROWSER_CONCURRENCY: intFromEnv(2, LIMITS.maxBrowserConcurrency),
  CRAWL_MAX_PAGES: intFromEnv(100, LIMITS.maxPages),
  CRAWL_MAX_CONCURRENCY: intFromEnv(2, LIMITS.maxConcurrency),
  NAVIGATION_TIMEOUT_MS: intFromEnv(15_000, LIMITS.maxNavigationTimeoutMs, 1000),
  JOB_TIMEOUT_MS: intFromEnv(600_000, LIMITS.maxJobTimeoutMs, 1000),
  ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
});

export type AppConfig = z.infer<typeof schema>;

/** Parse and validate configuration. Throws a readable error on invalid values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  return result.data;
}
