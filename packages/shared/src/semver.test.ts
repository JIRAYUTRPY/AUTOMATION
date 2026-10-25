import { describe, expect, it } from 'vitest';
import { compareSemver, isNewerVersion, parseSemver } from './semver';

describe('semver', () => {
  it('parses plain versions only', () => {
    expect(parseSemver('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseSemver('1.2.3-rc1')).toBeNull();
    expect(parseSemver('latest')).toBeNull();
  });
  it('compares numerically, not lexically', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0);
    expect(compareSemver('0.0.9', '0.1.0')).toBe(-1);
  });
  it('never offers an update from dev/latest or to prereleases', () => {
    expect(isNewerVersion('0.2.0', 'dev')).toBe(false);
    expect(isNewerVersion('0.2.0', 'latest')).toBe(false);
    expect(isNewerVersion('0.2.0-rc1', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
  });
});
