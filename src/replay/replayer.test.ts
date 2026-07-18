import { describe, expect, it } from "vitest";
import { demoScripts, purgeSpam, recoverFromMiss, RECORDED_AT } from "../../scripts/demo-scripts.js";
import {
  computeFixtureId,
  computeStateHash,
  parseTrajectoryFixture,
  type TrajectoryFixture,
} from "../core/trajectory.js";
import { runScript } from "../record/script-driver.js";
import { replayFixture } from "./replayer.js";

function authored(): TrajectoryFixture {
  return runScript(purgeSpam, { recordedAt: RECORDED_AT, note: "test" });
}

/** Re-seal a tampered body so the loader passes and REPLAY must catch it. */
function reseal(fixture: TrajectoryFixture): TrajectoryFixture {
  fixture.body.terminal.stateHash = computeStateHash(fixture.body.terminal.state);
  fixture.id = computeFixtureId(fixture.body);
  return parseTrajectoryFixture(fixture);
}

describe("replayFixture", () => {
  it("every demo fixture reproduces itself", () => {
    for (const { script, note } of demoScripts) {
      const fixture = runScript(script, { recordedAt: RECORDED_AT, note });
      const report = replayFixture(fixture);
      expect(report.ok, `${script.task.id} should replay`).toBe(true);
      expect(report.toolCalls).toBeGreaterThan(0);
    }
  });

  it("an edited result diverges at that step, naming seq and tool", () => {
    const fixture = structuredClone(authored());
    const step = fixture.body.steps[3]; // delete_ticket
    if (step?.kind !== "tool_call") throw new Error("expected tool_call");
    step.result = { ok: true, value: { deleted: "T-2" } }; // claims it deleted the wrong ticket
    const report = replayFixture(reseal(fixture));
    expect(report.ok).toBe(false);
    expect(report.divergence).toMatchObject({ kind: "result", seq: 3, tool: "delete_ticket" });
  });

  it("an edited terminal state diverges after all steps replay clean", () => {
    const fixture = structuredClone(authored());
    const terminal = fixture.body.terminal.state as { tickets: Record<string, { status: string }> };
    (terminal.tickets["T-2"] as { status: string }).status = "closed"; // history says otherwise
    const report = replayFixture(reseal(fixture));
    expect(report.ok).toBe(false);
    expect(report.divergence?.kind).toBe("terminal-state");
    expect(report.toolCalls).toBe(3); // every step replayed before the terminal check caught it
  });

  it("reordered steps diverge at the first step whose result no longer matches", () => {
    const fixture = structuredClone(
      runScript(recoverFromMiss, { recordedAt: RECORDED_AT, note: "test" }),
    );
    const steps = fixture.body.steps;
    // move close_ticket before list_tickets; renumber to stay loader-valid
    [steps[2], steps[3]] = [steps[3] as (typeof steps)[number], steps[2] as (typeof steps)[number]];
    steps.forEach((s, i) => (s.seq = i));
    const report = replayFixture(reseal(fixture));
    expect(report.ok).toBe(false);
    // the moved close succeeds identically, but list_tickets now sees T-2
    // closed while the recording shows it open
    expect(report.divergence).toMatchObject({ kind: "result", seq: 3, tool: "list_tickets" });
  });

  it("a STATELESS reorder replays clean - replay is physics, ordering is policy (M3)", () => {
    // confirmation moved AFTER the delete it was supposed to precede:
    // every result still reproduces (request_confirmation reads no ticket
    // state), so effect replay accepts it. Catching it is the ordering/
    // allowlist policy's job - this test documents that boundary.
    const fixture = structuredClone(authored());
    const steps = fixture.body.steps;
    [steps[2], steps[3]] = [steps[3] as (typeof steps)[number], steps[2] as (typeof steps)[number]];
    steps.forEach((s, i) => (s.seq = i));
    const report = replayFixture(reseal(fixture));
    expect(report.ok).toBe(true);
  });

  it("an initial state that is not a valid tool-server state is reported, not executed", () => {
    const fixture = structuredClone(authored());
    fixture.body.initialState = { tickets: {}, nextId: 1, extraField: true };
    const report = replayFixture(reseal(fixture));
    expect(report.ok).toBe(false);
    expect(report.divergence).toMatchObject({ kind: "initial-state-invalid" });
    expect((report.divergence as { message: string }).message).toContain("extraField");
  });
});
