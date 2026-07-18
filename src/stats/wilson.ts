/**
 * Wilson score interval for a binomial proportion. Chosen over the normal
 * approximation because it behaves at the boundaries (k=0, k=n) and at
 * small n — exactly where this repo's demo-scale suites live.
 * Golden values verified against an independent Python implementation
 * (docs/evidence/m4).
 */
export interface WilsonInterval {
  lower: number;
  upper: number;
}

const Z95 = 1.959963984540054;

export function wilson(successes: number, n: number, z: number = Z95): WilsonInterval | undefined {
  if (n <= 0 || !Number.isInteger(successes) || successes < 0 || successes > n) return undefined;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}
