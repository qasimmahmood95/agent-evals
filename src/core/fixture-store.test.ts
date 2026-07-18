import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FixtureStore } from "./fixture-store.js";
import {
  computeFixtureId,
  computeStateHash,
  type TrajectoryFixture,
} from "./trajectory.js";

function makeFixture(overrides: {
  taskId?: string;
  instruction?: string;
  note?: string;
  recordedAt?: string;
}): TrajectoryFixture {
  const state = { tickets: {}, nextId: 1 };
  const body: TrajectoryFixture["body"] = {
    task: { id: overrides.taskId ?? "demo-task", instruction: overrides.instruction ?? "do the thing" },
    initialState: state,
    steps: [
      {
        seq: 0,
        kind: "tool_call",
        tool: "list_tickets",
        args: {},
        result: { ok: true, value: [] },
      },
    ],
    terminal: {
      state,
      stateHash: computeStateHash(state),
      outcome: { kind: "completed" },
    },
  };
  const meta: TrajectoryFixture["meta"] = {
    recordedAt: overrides.recordedAt ?? "2026-07-18T00:00:00.000Z",
    provenance: "hand-authored",
    agent: { id: "test", adapterId: "test" },
  };
  if (overrides.note !== undefined) meta.note = overrides.note;
  return { formatVersion: 1, id: computeFixtureId(body), body, meta };
}

describe("FixtureStore", () => {
  let root: string;
  let store: FixtureStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-evals-store-"));
    store = new FixtureStore(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("saves under <task.id>/<id>.json and loads back identically", () => {
    const fixture = makeFixture({});
    const { path, occurrence } = store.save(fixture);
    expect(occurrence).toBe(0);
    expect(path).toBe(join(root, "demo-task", `${fixture.id}.json`));
    expect(store.loadAll("demo-task")).toEqual([fixture]);
  });

  it("gives identical bodies occurrence suffixes and never overwrites meta", () => {
    const first = makeFixture({ note: "first recording" });
    const second = makeFixture({ note: "second recording", recordedAt: "2026-07-19T00:00:00.000Z" });
    expect(second.id).toBe(first.id); // identical bodies, different meta

    expect(store.save(first).occurrence).toBe(0);
    const saved = store.save(second);
    expect(saved.occurrence).toBe(1);
    expect(saved.path).toBe(join(root, "demo-task", `${first.id}.1.json`));

    const onDisk = JSON.parse(readFileSync(store.pathFor("demo-task", first.id, 0), "utf8")) as TrajectoryFixture;
    expect(onDisk.meta.note).toBe("first recording"); // untouched
    expect(store.countFor("demo-task")).toBe(2); // n counts files, not distinct ids
  });

  it("gives distinct bodies distinct files at occurrence 0", () => {
    store.save(makeFixture({ instruction: "variant a" }));
    store.save(makeFixture({ instruction: "variant b" }));
    const files = store.filesFor("demo-task");
    expect(files).toHaveLength(2);
    expect(files.every((f) => !f.includes(".1.json"))).toBe(true);
  });

  it("refuses to save a fixture whose id does not match its body", () => {
    const fixture = makeFixture({});
    const forged = { ...fixture, id: "0".repeat(64) };
    expect(() => store.save(forged)).toThrow(/integrity failure at id/);
    expect(store.countFor("demo-task")).toBe(0);
  });

  it("refuses to save a fixture whose stateHash does not match its terminal state", () => {
    const fixture = structuredClone(makeFixture({}));
    fixture.body.terminal.stateHash = "0".repeat(64);
    fixture.id = computeFixtureId(fixture.body); // id consistent with the lie
    expect(() => store.save(fixture)).toThrow(/integrity failure at terminal\.stateHash/);
    expect(store.countFor("demo-task")).toBe(0);
  });

  it("refuses to save a fixture whose task id would escape the store root", () => {
    // bypass makeFixture's typed builder: construct the malicious body directly
    const fixture = structuredClone(makeFixture({}));
    fixture.body.task.id = "../../escaped-dir";
    fixture.id = computeFixtureId(fixture.body); // hash covers the malicious id, so it is "consistent"
    expect(() => store.save(fixture)).toThrow(/task\.id/);
    expect(store.taskIds()).toEqual([]);
  });

  it("integrity-checks on load: a tampered file on disk is rejected, naming the file", () => {
    const fixture = makeFixture({});
    const { path } = store.save(fixture);
    const tampered = structuredClone(fixture) as { body: { task: { instruction: string } } };
    tampered.body.task.instruction = "rewritten history";
    // bypass the store's save guard to simulate on-disk tampering
    writeFileSync(path, JSON.stringify(tampered, null, 2), "utf8");
    expect(() => store.loadAll("demo-task")).toThrow(new RegExp(fixture.id.slice(0, 8)));
    expect(() => store.loadAll("demo-task")).toThrow(/integrity failure at id/);
  });

  it("lists task ids and returns empty for unknown tasks", () => {
    store.save(makeFixture({ taskId: "task-b" }));
    store.save(makeFixture({ taskId: "task-a" }));
    expect(store.taskIds()).toEqual(["task-a", "task-b"]);
    expect(store.filesFor("nope")).toEqual([]);
    expect(store.countFor("nope")).toBe(0);
  });
});
