import { describe, expect, it } from "vitest";
import { pairedMeanDiffCI } from "./bootstrap.js";

describe("pairedMeanDiffCI", () => {
  it("returns undefined for empty input — no data is not a zero effect", () => {
    expect(pairedMeanDiffCI([])).toBeUndefined();
  });

  it("is exactly reproducible from the same seed, and different for a different seed", () => {
    const diffs = [-0.6, -0.6, -0.2, 0];
    const a = pairedMeanDiffCI(diffs, { seed: 42 });
    const b = pairedMeanDiffCI(diffs, { seed: 42 });
    const c = pairedMeanDiffCI(diffs, { seed: 43 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("degenerate cases: all-zero diffs give [0,0]; a single value gives [v,v]", () => {
    const zero = pairedMeanDiffCI([0, 0, 0, 0]);
    expect(zero).toMatchObject({ mean: 0, lower: 0, upper: 0 });
    const single = pairedMeanDiffCI([-0.4]);
    expect(single).toMatchObject({ mean: -0.4, lower: -0.4, upper: -0.4 });
    // with every resample identical, the p-value floor applies
    expect(zero?.pValue).toBeGreaterThan(0);
  });

  it("property: CI bounds lie within [min, max] of the diffs and bracket the mean", () => {
    const cases = [
      [-0.6, -0.6, -0.2, 0],
      [0.1, 0.3, 0.2, 0.4, 0.15],
      [-1, 1],
      [0.5, -0.5, 0.25, -0.25, 0],
    ];
    for (const diffs of cases) {
      const r = pairedMeanDiffCI(diffs, { B: 2000 });
      if (!r) throw new Error("unexpected undefined");
      expect(r.lower).toBeGreaterThanOrEqual(Math.min(...diffs));
      expect(r.upper).toBeLessThanOrEqual(Math.max(...diffs));
      expect(r.lower).toBeLessThanOrEqual(r.mean + 1e-12);
      expect(r.upper).toBeGreaterThanOrEqual(r.mean - 1e-12);
    }
  });

  it("property: a uniformly negative sample yields a CI excluding zero and a small p", () => {
    const r = pairedMeanDiffCI([-0.4, -0.6, -0.5, -0.3, -0.45, -0.55], { B: 4000 });
    if (!r) throw new Error("unexpected undefined");
    expect(r.upper).toBeLessThan(0);
    expect(r.pValue).toBeLessThanOrEqual(2 / 4000 + 1e-12);
  });

  it("property: the CI narrows as n grows (same underlying diffs repeated)", () => {
    const base = [-0.2, 0.1, -0.1, 0.05];
    const small = pairedMeanDiffCI(base, { B: 4000 });
    const large = pairedMeanDiffCI([...base, ...base, ...base, ...base, ...base, ...base], { B: 4000 });
    if (!small || !large) throw new Error("unexpected undefined");
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });

  it("reports its n, B, and seed — every aggregate carries its provenance", () => {
    const r = pairedMeanDiffCI([0.1, -0.1], { B: 500, seed: 7 });
    expect(r).toMatchObject({ n: 2, B: 500, seed: 7 });
  });
});
