/** Strict x.y.z (optional leading "v"). Prereleases and anything else are not versions here. */
export function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) throw new Error('compareSemver: not a plain x.y.z version');
  for (let i = 0; i < 3; i++) {
    const d = pa[i]! - pb[i]!;
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** True only when both are real versions and `latest` is strictly newer (dev/latest never update). */
export function isNewerVersion(latest: string, current: string): boolean {
  return parseSemver(latest) !== null && parseSemver(current) !== null && compareSemver(latest, current) > 0;
}
