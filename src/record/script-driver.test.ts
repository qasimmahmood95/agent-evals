import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { closeDuplicates, demoScripts, RECORDED_AT } from "../../scripts/demo-scripts.js";
import { parseTrajectoryFixture } from "../core/trajectory.js";
import { TrajectoryRecorder } from "./recorder.js";
import { runScript } from "./script-driver.js";

describe("runScript / TrajectoryRecorder", () => {
  it("every demo script produces a fixture the loader accepts", () => {
    for (const { script, note } of demoScripts) {
      const fixture = runScript(script, { recordedAt: RECORDED_AT, note });
      expect(() => parseTrajectoryFixture(fixture)).not.toThrow();
      expect(fixture.meta.provenance).toBe("scripted");
      expect(fixture.meta.agent.adapterId).toBe("scripted-driver");
    }
  });

  it("the close-duplicates script reproduces the ADR-0001 example EXACTLY", () => {
    const adrPath = fileURLToPath(
      new URL("../../docs/adr/0001-trajectory-fixture-format.md", import.meta.url),
    );
    const md = readFileSync(adrPath, "utf8");
    const match = md.match(/```json\n([\s\S]*?)```/);
    if (!match?.[1]) throw new Error("no json block in ADR-0001");
    const example = JSON.parse(match[1]) as unknown;
    const authored = runScript(closeDuplicates, { recordedAt: RECORDED_AT, note: "M2 demo fixture" });
    expect(authored).toEqual(example);
  });

  it("a recorder cannot be used after finish", () => {
    const recorder = new TrajectoryRecorder(
      { id: "demo-task", instruction: "x" },
      { tickets: {}, nextId: 1 },
    );
    recorder.call("list_tickets", {});
    recorder.finish(
      { kind: "completed" },
      {
        recordedAt: RECORDED_AT,
        provenance: "scripted",
        agent: { id: "t", adapterId: "t" },
      },
    );
    expect(() => recorder.call("list_tickets", {})).toThrow(/already finished/);
    expect(() => recorder.note("late")).toThrow(/already finished/);
    expect(() =>
      recorder.finish(
        { kind: "completed" },
        { recordedAt: RECORDED_AT, provenance: "scripted", agent: { id: "t", adapterId: "t" } },
      ),
    ).toThrow(/already finished/);
  });

  it("the recorder snapshots args and results — later mutation cannot rewrite history", () => {
    const recorder = new TrajectoryRecorder(
      { id: "demo-task", instruction: "x" },
      { tickets: {}, nextId: 1 },
    );
    const args = { title: "original" };
    recorder.call("create_ticket", args);
    args.title = "mutated after the fact";
    const fixture = recorder.finish(
      { kind: "completed" },
      { recordedAt: RECORDED_AT, provenance: "scripted", agent: { id: "t", adapterId: "t" } },
    );
    const step = fixture.body.steps[0];
    if (step?.kind !== "tool_call") throw new Error("expected tool_call");
    expect(step.args).toEqual({ title: "original" });
    expect(() => parseTrajectoryFixture(fixture)).not.toThrow();
  });
});
