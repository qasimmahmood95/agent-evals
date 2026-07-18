import { describe, expect, it } from "vitest";
import { wilson } from "./wilson.js";

describe("wilson", () => {
  // Golden values from an independent Python implementation (docs/evidence/m4)
  it("matches independently computed golden values", () => {
    expect(wilson(8, 10)?.lower).toBeCloseTo(0.4901624715, 9);
    expect(wilson(8, 10)?.upper).toBeCloseTo(0.9433178485, 9);
    expect(wilson(0, 10)?.lower).toBe(0);
    expect(wilson(0, 10)?.upper).toBeCloseTo(0.2775327999, 9);
    expect(wilson(10, 10)?.lower).toBeCloseTo(0.7224672001, 9);
    expect(wilson(10, 10)?.upper).toBeCloseTo(1, 12);
    expect(wilson(1, 1)?.lower).toBeCloseTo(0.2065493144, 9);
    expect(wilson(45, 50)?.lower).toBeCloseTo(0.7863976856, 9);
    expect(wilson(45, 50)?.upper).toBeCloseTo(0.9565242351, 9);
    expect(wilson(3, 4)?.lower).toBeCloseTo(0.3006418426, 9);
  });

  it("returns undefined for undefined quantities — never a fake zero", () => {
    expect(wilson(0, 0)).toBeUndefined();
    expect(wilson(-1, 10)).toBeUndefined();
    expect(wilson(11, 10)).toBeUndefined();
    expect(wilson(2.5, 10)).toBeUndefined();
  });

  it("property: interval always contains p̂ and sits inside [0, 1]", () => {
    for (let n = 1; n <= 30; n++) {
      for (let k = 0; k <= n; k++) {
        const ci = wilson(k, n);
        if (!ci) throw new Error("unexpected undefined");
        const p = k / n;
        expect(ci.lower).toBeGreaterThanOrEqual(0);
        expect(ci.upper).toBeLessThanOrEqual(1);
        expect(ci.lower).toBeLessThanOrEqual(p + 1e-12);
        expect(ci.upper).toBeGreaterThanOrEqual(p - 1e-12);
      }
    }
  });

  it("property: interval narrows as n grows at fixed p̂", () => {
    const w10 = wilson(5, 10);
    const w100 = wilson(50, 100);
    const w1000 = wilson(500, 1000);
    if (!w10 || !w100 || !w1000) throw new Error("unexpected undefined");
    expect(w100.upper - w100.lower).toBeLessThan(w10.upper - w10.lower);
    expect(w1000.upper - w1000.lower).toBeLessThan(w100.upper - w100.lower);
  });
});
