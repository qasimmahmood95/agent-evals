import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoScripts, purgeSpam, RECORDED_AT } from "../../scripts/demo-scripts.js";
import { FixtureStore } from "../core/fixture-store.js";
import { runScript } from "../record/script-driver.js";
import { runReplay } from "./run.js";

describe("runReplay", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-evals-replay-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function authorAll(dir: string): FixtureStore {
    const store = new FixtureStore(dir);
    for (const { script, note } of demoScripts) {
      store.save(runScript(script, { recordedAt: RECORDED_AT, note }));
    }
    return store;
  }

  it("exits 0 when every fixture reproduces itself, disclosing provenance", () => {
    authorAll(root);
    const { exitCode, lines } = runReplay(root);
    expect(exitCode).toBe(0);
    expect(lines.filter((l) => l.startsWith("ok    "))).toHaveLength(demoScripts.length);
    expect(lines.every((l) => !l.startsWith("ok") || l.includes("scripted"))).toBe(true);
    expect(lines.at(-1)).toBe(`replay: ${demoScripts.length}/${demoScripts.length} fixtures reproduce themselves`);
  });

  it("exits 1 when any fixture is corrupt on disk — unloadable is failed, not skipped", () => {
    const store = authorAll(root);
    const fixture = runScript(purgeSpam, { recordedAt: RECORDED_AT, note: "victim" });
    const victim = store.pathFor(purgeSpam.task.id, fixture.id, 0);
    writeFileSync(victim, "{ not json", "utf8");
    const { exitCode, lines } = runReplay(root);
    expect(exitCode).toBe(1);
    expect(lines.some((l) => l.startsWith("FAIL") && l.includes("invalid fixture"))).toBe(true);
    expect(lines.at(-1)).toContain("FAILED to reproduce");
  });

  it("walks suite grouping (adversarial/<task.id>/)", () => {
    authorAll(root);
    const nested = new FixtureStore(join(root, "adversarial"));
    nested.save(runScript(purgeSpam, { recordedAt: RECORDED_AT, note: "nested" }));
    const { exitCode, lines } = runReplay(root);
    expect(exitCode).toBe(0);
    expect(lines.some((l) => l.includes(join("adversarial", purgeSpam.task.id)))).toBe(true);
    expect(lines.at(-1)).toBe(`replay: ${demoScripts.length + 1}/${demoScripts.length + 1} fixtures reproduce themselves`);
  });

  it("a directory with BOTH files and subdirectories loses nothing — the loose file fails as misplaced, the subtree is still walked", () => {
    const nested = new FixtureStore(join(root, "adversarial"));
    nested.save(runScript(purgeSpam, { recordedAt: RECORDED_AT, note: "nested" }));
    const loose = runScript(demoScripts[0]!.script, { recordedAt: RECORDED_AT, note: "loose" });
    writeFileSync(join(root, "adversarial", "loose.json"), JSON.stringify(loose, null, 2), "utf8");
    const { exitCode, lines } = runReplay(root);
    expect(exitCode).toBe(1);
    expect(lines.some((l) => l.startsWith("FAIL") && l.includes("misplaced fixture"))).toBe(true);
    expect(lines.some((l) => l.startsWith("ok") && l.includes(join("adversarial", purgeSpam.task.id)))).toBe(true);
    expect(lines.at(-1)).toBe("replay: 1/2 fixtures FAILED to reproduce themselves");
  });

  it("enforces layout: a misnamed file and a fixture in the wrong task directory both FAIL", () => {
    const store = new FixtureStore(root);
    const fixture = runScript(purgeSpam, { recordedAt: RECORDED_AT, note: "x" });
    store.save(fixture);
    // duplicate content under a wrong name in the right directory
    writeFileSync(join(root, purgeSpam.task.id, "copy-of-same-body.json"), JSON.stringify(fixture, null, 2), "utf8");
    // same fixture under another task's directory
    mkdirSync(join(root, "some-other-task"), { recursive: true });
    writeFileSync(join(root, "some-other-task", `${fixture.id}.json`), JSON.stringify(fixture, null, 2), "utf8");
    const { exitCode, lines } = runReplay(root);
    expect(exitCode).toBe(1);
    expect(lines.some((l) => l.includes("misnamed fixture"))).toBe(true);
    expect(lines.some((l) => l.includes("misplaced fixture"))).toBe(true);
    expect(lines.at(-1)).toBe("replay: 2/3 fixtures FAILED to reproduce themselves");
  });

  it("exits 2 on a missing root and on an empty root — nothing verified is not a pass", () => {
    expect(runReplay(join(root, "nope")).exitCode).toBe(2);
    const empty = join(root, "empty");
    mkdirSync(empty);
    const result = runReplay(empty);
    expect(result.exitCode).toBe(2);
    expect(result.lines[0]).toContain("nothing verified");
  });
});
