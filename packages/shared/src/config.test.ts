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

describe('loadConfig update settings', () => {
  it('defaults to updater disabled and dev version', () => {
    const c = loadConfig({});
    expect(c.UPDATER_ENABLED).toBe(false);
    expect(c.APP_VERSION).toBe('dev');
    expect(c.ADMIN_TOKEN).toBeUndefined();
  });
  it('rejects short admin tokens and malformed repos', () => {
    expect(() => loadConfig({ ADMIN_TOKEN: 'short' })).toThrow(/ADMIN_TOKEN/);
    expect(() => loadConfig({ UPDATE_REPO: 'not a repo' })).toThrow(/UPDATE_REPO/);
  });
});
