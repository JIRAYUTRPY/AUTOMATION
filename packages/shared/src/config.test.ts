import { describe, expect, it } from 'vitest';
import { LIMITS, loadConfig } from './config';

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const c = loadConfig({});
    expect(c.CRAWL_MAX_PAGES).toBe(100);
    expect(c.CRAWL_MAX_CONCURRENCY).toBe(2);
    expect(c.NAVIGATION_TIMEOUT_MS).toBe(15_000);
    expect(c.JOB_TIMEOUT_MS).toBe(600_000);
    expect(c.ALLOWED_ORIGINS).toEqual([]);
  });

  it('rejects values above the server-side upper bound', () => {
    expect(() => loadConfig({ CRAWL_MAX_PAGES: String(LIMITS.maxPages + 1) })).toThrow(
      /CRAWL_MAX_PAGES/,
    );
  });

  it('treats empty strings as unset and parses origin lists', () => {
    const c = loadConfig({ APP_PORT: '', ALLOWED_ORIGINS: 'https://a.example, https://b.example' });
    expect(c.APP_PORT).toBe(3000);
    expect(c.ALLOWED_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });
});
