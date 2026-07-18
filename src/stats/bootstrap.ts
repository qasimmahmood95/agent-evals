import { mulberry32 } from "./random.js";

/**
 * Seeded percentile bootstrap on the mean of paired per-task differences —
 * the llm-evals-ts approach re-derived: pairing per task is the variance
 * reduction that makes small suites able to say anything at all; the seed
 * is part of the reported result.
 *
 * Also reports a two-sided bootstrap p-value for the null mean(diff) = 0
 * (proportion of resampled means on the other side of zero, doubled,
 * floored at 1/B) — the input Benjamini–Hochberg needs across a family.
 *
 * Returns undefined for empty input: no data is not a zero effect.
 */
export interface BootstrapResult {
  mean: number;
  lower: number;
  upper: number;
  pValue: number;
  n: number;
  B: number;
  seed: number;
}

export interface BootstrapOptions {
  B?: number;
  seed?: number;
  /** two-sided coverage, e.g. 0.95 */
  confidence?: number;
}

export function pairedMeanDiffCI(
  diffs: readonly number[],
  options: BootstrapOptions = {},
): BootstrapResult | undefined {
  const n = diffs.length;
  if (n === 0) return undefined;
  const B = options.B ?? 10_000;
  const seed = options.seed ?? 42;
  const confidence = options.confidence ?? 0.95;
  const rand = mulberry32(seed);

  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const means = new Array<number>(B);
  let atOrBelowZero = 0;
  let atOrAboveZero = 0;
  for (let b = 0; b < B; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rand() * n)] as number;
    const m = sum / n;
    means[b] = m;
    if (m <= 0) atOrBelowZero += 1;
    if (m >= 0) atOrAboveZero += 1;
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  const lower = means[Math.max(0, Math.min(B - 1, Math.floor(alpha * B)))] as number;
  const upper = means[Math.max(0, Math.min(B - 1, Math.ceil((1 - alpha) * B) - 1))] as number;
  const pValue = Math.max(1 / B, Math.min(1, 2 * Math.min(atOrBelowZero / B, atOrAboveZero / B)));
  return { mean, lower, upper, pValue, n, B, seed };
}
