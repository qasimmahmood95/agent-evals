import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeFixtureId, parseTrajectoryFixture, type TrajectoryFixture } from "./trajectory.js";

/**
 * Content-addressed fixture store, per ADR-0001.
 *
 * Layout: <root>/<task.id>/<id>.json with occurrence suffixes
 * (<id>.1.json, <id>.2.json, …) for repeat recordings whose bodies are
 * identical. Existing files are NEVER overwritten — every recording is a
 * new file, so the file count per task directory is the visible sample
 * size n, whether or not sampled runs happened to be identical.
 */
export class FixtureStore {
  constructor(readonly rootDir: string) {}

  dirFor(taskId: string): string {
    return join(this.rootDir, taskId);
  }

  pathFor(taskId: string, id: string, occurrence = 0): string {
    const name = occurrence === 0 ? `${id}.json` : `${id}.${occurrence}.json`;
    return join(this.dirFor(taskId), name);
  }

  /**
   * Persist a fixture as a new file, never overwriting: an id already on
   * disk gets the next free occurrence slot, with its own meta. The
   * fixture's id is recomputed and must match its body — the store refuses
   * to write a lie.
   */
  save(fixture: TrajectoryFixture): { path: string; occurrence: number } {
    const computedId = computeFixtureId(fixture.body);
    if (computedId !== fixture.id) {
      throw new Error(`refusing to save fixture: id ${fixture.id} does not match body hash ${computedId}`);
    }
    const taskId = fixture.body.task.id;
    let occurrence = 0;
    while (existsSync(this.pathFor(taskId, fixture.id, occurrence))) occurrence += 1;
    const path = this.pathFor(taskId, fixture.id, occurrence);
    mkdirSync(this.dirFor(taskId), { recursive: true });
    writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    return { path, occurrence };
  }

  /** All fixture files for a task, in deterministic (filename) order. */
  filesFor(taskId: string): string[] {
    const dir = this.dirFor(taskId);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => join(dir, f));
  }

  /** Sample size n for a task = number of fixture files (ADR-0001). */
  countFor(taskId: string): number {
    return this.filesFor(taskId).length;
  }

  /** Load and integrity-check every fixture for a task. */
  loadAll(taskId: string): TrajectoryFixture[] {
    return this.filesFor(taskId).map((path) => this.loadFile(path));
  }

  loadFile(path: string): TrajectoryFixture {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      throw new Error(`unreadable fixture at ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      return parseTrajectoryFixture(raw);
    } catch (e) {
      if (e instanceof Error) e.message = `${path}: ${e.message}`;
      throw e;
    }
  }

  /** Task directories present under the root, sorted. */
  taskIds(): string[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  }
}
