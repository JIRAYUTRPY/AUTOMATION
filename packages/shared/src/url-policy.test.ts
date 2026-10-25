import { describe, expect, it } from 'vitest';
import {
  UrlPolicyError,
  isInScope,
  isProhibitedIp,
  normalizeCrawlUrl,
  validatePublicUrl,
  validateUrlSyntax,
} from './url-policy';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof UrlPolicyError ? e.code : 'other';
  }
};

describe('isProhibitedIp', () => {
  it.each([
    '0.0.0.0', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1', '64:ff9b::a00:1',
    '2002:7f00:1::1', '2001:db8::1', 'not-an-ip',
  ])('blocks %s', (ip) => expect(isProhibitedIp(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => expect(isProhibitedIp(ip)).toBe(false),
  );
});

describe('validateUrlSyntax', () => {
  it.each([
    ['not a url', 'malformed'],
    ['ftp://example.com', 'unsupported_protocol'],
    ['file:///etc/passwd', 'unsupported_protocol'],
    ['javascript:alert(1)', 'unsupported_protocol'],
    ['https://user:pw@example.com', 'credentials_not_allowed'],
    ['https://example.com:22', 'port_not_allowed'],
    ['http://localhost', 'prohibited_hostname'],
    ['http://app.localhost', 'prohibited_hostname'],
    ['http://printer.local', 'prohibited_hostname'],
    ['http://metadata.google.internal', 'prohibited_hostname'],
    ['http://127.0.0.1', 'prohibited_address'],
    ['http://2130706433', 'prohibited_address'],
    ['http://0x7f.1', 'prohibited_address'],
    ['http://[::1]', 'prohibited_address'],
    ['http://169.254.169.254/latest/meta-data', 'prohibited_address'],
  ])('rejects %s as %s', (raw, expected) => {
    try {
      validateUrlSyntax(raw);
      throw new Error('expected rejection');
    } catch (e) {
      expect((e as UrlPolicyError).code).toBe(expected);
    }
  });

  it('accepts a normal public URL', () => {
    expect(validateUrlSyntax('https://example.com/path').hostname).toBe('example.com');
  });
});

describe('validatePublicUrl', () => {
  it('rejects when ANY resolved address is private', async () => {
    const resolve = async () => ['93.184.216.34', '10.0.0.5'];
    expect(await code(validatePublicUrl('https://example.com', { resolve }))).toBe('prohibited_address');
  });
  it('accepts when all addresses are public', async () => {
    const resolve = async () => ['93.184.216.34', '2606:4700:4700::1111'];
    expect(await code(validatePublicUrl('https://example.com', { resolve }))).toBe('ok');
  });
  it('reports DNS failures', async () => {
    const resolve = async () => {
      throw new Error('ENOTFOUND');
    };
    expect(await code(validatePublicUrl('https://nope.example', { resolve }))).toBe('dns_failure');
  });
  it('never resolves when syntax is invalid', async () => {
    let called = false;
    const resolve = async () => {
      called = true;
      return ['93.184.216.34'];
    };
    await code(validatePublicUrl('ftp://example.com', { resolve }));
    expect(called).toBe(false);
  });
});

describe('normalizeCrawlUrl', () => {
  it('strips fragments, default ports, and sorts/filters query', () => {
    expect(normalizeCrawlUrl('HTTPS://Example.com:443/a?b=2&a=1&utm_source=x#top', { keepQuery: 'all' })).toBe(
      'https://example.com/a?a=1&b=2',
    );
  });
  it('drops all query params by default', () => {
    expect(normalizeCrawlUrl('https://example.com/a?x=1')).toBe('https://example.com/a');
  });
  it('keeps only allowlisted params', () => {
    expect(normalizeCrawlUrl('https://example.com/a?page=2&sid=9', { keepQuery: ['page'] })).toBe(
      'https://example.com/a?page=2',
    );
  });
});

describe('isInScope', () => {
  it('requires same origin', () => {
    expect(isInScope('https://example.com/a', 'https://example.com')).toBe(true);
    expect(isInScope('https://other.com/a', 'https://example.com')).toBe(false);
    expect(isInScope('http://example.com/a', 'https://example.com')).toBe(false);
  });
  it('respects path prefix on segment boundaries', () => {
    expect(isInScope('https://example.com/docs/x', 'https://example.com', '/docs')).toBe(true);
    expect(isInScope('https://example.com/docs', 'https://example.com', '/docs')).toBe(true);
    expect(isInScope('https://example.com/docsx', 'https://example.com', '/docs')).toBe(false);
    expect(isInScope('https://example.com/other', 'https://example.com', '/docs')).toBe(false);
  });
});
