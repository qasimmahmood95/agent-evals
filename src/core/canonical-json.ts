/**
 * Deterministic JSON serialization: object keys sorted recursively,
 * `undefined`-valued keys dropped, array order preserved.
 *
 * Everything that feeds a fixture hash (bodies, states, results) must go
 * through this, so semantically identical values always produce identical
 * hashes regardless of property insertion order.
 *
 * Stricter than plain JSON.stringify where silence would hide
 * nondeterminism: non-finite numbers (NaN, ±Infinity) throw instead of
 * serializing as null, and so do bigint, function, and symbol values —
 * a fixture body containing any of them is a bug at the producer, not
 * data to be smoothed over.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value, "$"));
}

function sortValue(value: unknown, path: string): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`canonicalJson: non-finite number at ${path}`);
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`canonicalJson: non-JSON value (${typeof value}) at ${path}`);
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      if (v === undefined) throw new TypeError(`canonicalJson: undefined array element at ${path}[${i}]`);
      return sortValue(v, `${path}[${i}]`);
    });
  }
  if (value !== null && typeof value === "object") {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      // Date, Map, Set, class instances: Object.entries would silently
      // serialize these as {} (toJSON is ignored too) — a producer bug,
      // not data.
      throw new TypeError(`canonicalJson: non-plain object at ${path}`);
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortValue(v, `${path}.${k}`)]));
  }
  return value;
}
