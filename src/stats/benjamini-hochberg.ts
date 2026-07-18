/**
 * Benjamini–Hochberg step-up adjusted q-values (monotone-enforced).
 * Controls FDR across a family of suite comparisons so a gate over many
 * suites cannot inflate its false-REGRESSION rate. Golden values verified
 * against an independent Python implementation (docs/evidence/m4).
 */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  if (pValues.some((p) => !(p >= 0 && p <= 1))) {
    throw new RangeError("benjaminiHochberg: p-values must be in [0, 1]");
  }
  const order = [...pValues.keys()].sort((a, b) => (pValues[a] as number) - (pValues[b] as number));
  const q = new Array<number>(m).fill(0);
  let prev = 1;
  for (let rank = m; rank >= 1; rank--) {
    const i = order[rank - 1] as number;
    prev = Math.min(prev, ((pValues[i] as number) * m) / rank);
    q[i] = prev;
  }
  return q;
}
