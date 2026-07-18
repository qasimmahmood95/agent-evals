import { describe, expect, it } from "vitest";
import { benjaminiHochberg } from "./benjamini-hochberg.js";

describe("benjaminiHochberg", () => {
  // Golden values from an independent Python implementation (docs/evidence/m4)
  it("matches independently computed golden q-values", () => {
    const golden = [0.025, 0.05, 0.05, 0.025, 0.2];
    const computed = benjaminiHochberg([0.01, 0.04, 0.03, 0.005, 0.2]);
    for (const [i, g] of golden.entries()) expect(computed[i]).toBeCloseTo(g, 12);
    const q = benjaminiHochberg([0.6, 0.07, 0.9]);
    expect(q[0]).toBeCloseTo(0.9, 12);
    expect(q[1]).toBeCloseTo(0.21, 12);
    expect(q[2]).toBeCloseTo(0.9, 12);
  });

  it("handles edges: empty, single, ties, all-equal", () => {
    expect(benjaminiHochberg([])).toEqual([]);
    expect(benjaminiHochberg([0.03])).toEqual([0.03]);
    expect(benjaminiHochberg([0.05, 0.05])).toEqual([0.05, 0.05]);
  });

  it("rejects out-of-range p-values loudly", () => {
    expect(() => benjaminiHochberg([0.5, 1.2])).toThrow(RangeError);
    expect(() => benjaminiHochberg([-0.1])).toThrow(RangeError);
    expect(() => benjaminiHochberg([Number.NaN])).toThrow(RangeError);
  });

  it("property: q >= p, q <= 1, and q is monotone in p-rank", () => {
    const ps = [0.001, 0.011, 0.019, 0.02, 0.05, 0.11, 0.27, 0.44, 0.56, 0.8];
    const qs = benjaminiHochberg(ps);
    for (const [i, p] of ps.entries()) {
      expect(qs[i]).toBeGreaterThanOrEqual(p);
      expect(qs[i]).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < ps.length; i++) {
      expect(qs[i]).toBeGreaterThanOrEqual(qs[i - 1] as number); // sorted input → sorted q
    }
  });

  it("property: permutation-equivariant", () => {
    const ps = [0.03, 0.2, 0.005, 0.6];
    const qs = benjaminiHochberg(ps);
    const perm = [2, 0, 3, 1];
    const permuted = perm.map((i) => ps[i] as number);
    const qsPermuted = benjaminiHochberg(permuted);
    for (const [j, i] of perm.entries()) {
      expect(qsPermuted[j]).toBeCloseTo(qs[i] as number, 12);
    }
  });
});
