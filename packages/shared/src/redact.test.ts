import { describe, expect, it } from 'vitest';
import { redactUrl } from './redact';

describe('redactUrl', () => {
  it('redacts sensitive params and credentials, keeps others', () => {
    const out = redactUrl('https://user:pw@example.com/a?token=abc&page=2&API_KEY=x');
    expect(out).not.toContain('abc');
    expect(out).not.toContain('pw@');
    expect(out).toContain('page=2');
    expect(out).toContain('REDACTED');
  });

  it('does not echo invalid input', () => {
    expect(redactUrl('not a url token=secret')).toBe('[INVALID_URL]');
  });
});
