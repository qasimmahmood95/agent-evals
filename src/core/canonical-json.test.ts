import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json.js";

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("is insensitive to property insertion order", () => {
    const x = { z: 1, a: [{ m: 1, k: 2 }] };
    const y = { a: [{ k: 2, m: 1 }], z: 1 };
    expect(canonicalJson(x)).toBe(canonicalJson(y));
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined-valued keys", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("handles primitives, null, unicode, and empty containers", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson("héllo")).toBe('"héllo"');
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
    expect(canonicalJson(0)).toBe("0");
    expect(canonicalJson(-0)).toBe("0");
  });

  it("throws on non-finite numbers, naming the path", () => {
    expect(() => canonicalJson({ a: [Number.NaN] })).toThrow(/non-finite number at \$\.a\[0\]/);
    expect(() => canonicalJson(Infinity)).toThrow(/non-finite number at \$/);
  });

  it("throws on bigint, function, symbol, and undefined array elements", () => {
    expect(() => canonicalJson({ a: 1n })).toThrow(/non-JSON value \(bigint\) at \$\.a/);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/non-JSON value \(function\)/);
    expect(() => canonicalJson([undefined])).toThrow(/undefined array element at \$\[0\]/);
  });

  it("throws on non-plain objects instead of silently serializing {}", () => {
    expect(() => canonicalJson({ when: new Date(0) })).toThrow(/non-plain object at \$\.when/);
    expect(() => canonicalJson(new Map([["a", 1]]))).toThrow(/non-plain object at \$/);
    expect(() => canonicalJson(new Set([1]))).toThrow(/non-plain object/);
    // null-prototype objects are plain data - allowed
    const nullProto = Object.create(null) as Record<string, number>;
    nullProto.a = 1;
    expect(canonicalJson(nullProto)).toBe('{"a":1}');
  });
});
