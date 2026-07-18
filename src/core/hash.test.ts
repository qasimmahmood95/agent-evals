import { describe, expect, it } from "vitest";
import { hashJson, sha256Hex } from "./hash.js";

describe("sha256Hex", () => {
  // Golden values verified independently: node:crypto and GNU coreutils
  // sha256sum agree (docs/evidence/m1).
  it("matches the well-known empty-string digest", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches an independently computed digest", () => {
    expect(sha256Hex('{"a":1}')).toBe(
      "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
    );
  });
});

describe("hashJson", () => {
  it("hashes the canonical serialization, so key order is irrelevant", () => {
    expect(hashJson({ a: 1 })).toBe("015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862");
    expect(hashJson({ b: [2, "x"], a: 1 })).toBe(
      "454597f51f0e5988dd7d0864f82e826d91fd43ed815a21bb06cd7181e8547a2f",
    );
  });
});
