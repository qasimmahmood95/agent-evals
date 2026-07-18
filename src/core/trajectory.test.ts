import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeFixtureId,
  FixtureIntegrityError,
  FixtureShapeError,
  parseTrajectoryFixture,
  type TrajectoryFixture,
} from "./trajectory.js";

const adrPath = fileURLToPath(new URL("../../docs/adr/0001-trajectory-fixture-format.md", import.meta.url));

/** The ADR's example is executable documentation: extract its JSON block. */
function adrExample(): unknown {
  const md = readFileSync(adrPath, "utf8");
  const match = md.match(/```json\n([\s\S]*?)```/);
  if (!match?.[1]) throw new Error("no ```json block found in ADR-0001");
  return JSON.parse(match[1]);
}

function validFixture(): TrajectoryFixture {
  return parseTrajectoryFixture(adrExample());
}

describe("parseTrajectoryFixture", () => {
  it("accepts the ADR-0001 example verbatim (round-trips)", () => {
    const raw = adrExample();
    const fixture = parseTrajectoryFixture(raw);
    expect(fixture).toEqual(raw);
  });

  it("rejects a tampered result (id no longer matches body)", () => {
    const fixture = structuredClone(validFixture());
    const step = fixture.body.steps[0];
    if (step?.kind !== "tool_call") throw new Error("expected tool_call step");
    step.result = { ok: false, error: { code: "NOT_FOUND", message: "forged" } };
    expect(() => parseTrajectoryFixture(fixture)).toThrow(FixtureIntegrityError);
    expect(() => parseTrajectoryFixture(fixture)).toThrow(/integrity failure at id/);
  });

  it("rejects a wrong stateHash even when the id is recomputed to match", () => {
    const fixture = structuredClone(validFixture());
    fixture.body.terminal.stateHash = "0".repeat(64);
    fixture.id = computeFixtureId(fixture.body);
    expect(() => parseTrajectoryFixture(fixture)).toThrow(/integrity failure at terminal\.stateHash/);
  });

  it("rejects reordered steps (contiguity) with a field-level path", () => {
    const fixture = structuredClone(validFixture()) as unknown as {
      body: { steps: { seq: number }[] };
    };
    const steps = fixture.body.steps;
    [steps[0], steps[1]] = [steps[1] as { seq: number }, steps[0] as { seq: number }];
    try {
      parseTrajectoryFixture(fixture);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FixtureShapeError);
      const issues = (e as FixtureShapeError).issues;
      expect(issues.some((i) => i.path.includes("body.steps.0.seq"))).toBe(true);
    }
  });

  it("rejects unknown provenance, short hashes, and unknown keys with paths", () => {
    const base = structuredClone(validFixture()) as unknown as Record<string, unknown>;

    const badProvenance = structuredClone(base);
    (badProvenance.meta as Record<string, unknown>).provenance = "vibes";
    expect(() => parseTrajectoryFixture(badProvenance)).toThrow(FixtureShapeError);
    expect(() => parseTrajectoryFixture(badProvenance)).toThrow(/meta\.provenance/);

    const shortHash = structuredClone(base);
    shortHash.id = "3f61c9";
    expect(() => parseTrajectoryFixture(shortHash)).toThrow(/id: expected 64 lowercase hex/);

    const extraKey = structuredClone(base);
    extraKey.expectedVerdict = "pass"; // fixtures never embed verdicts (ground rule 1)
    expect(() => parseTrajectoryFixture(extraKey)).toThrow(FixtureShapeError);
  });

  it("rejects a task id that is not filesystem-safe", () => {
    const fixture = structuredClone(validFixture());
    fixture.body.task.id = "../escape";
    fixture.id = computeFixtureId(fixture.body);
    expect(() => parseTrajectoryFixture(fixture)).toThrow(/task\.id/);
  });
});
