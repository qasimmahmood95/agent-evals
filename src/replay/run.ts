import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { FixtureStore } from "../core/fixture-store.js";
import type { TrajectoryFixture } from "../core/trajectory.js";
import { replayFixture, type ReplayDivergence } from "./replayer.js";

/**
 * Replay every committed fixture under a store root. Exit codes are
 * contract (llm-evals-ts discipline): 0 all fixtures reproduce themselves,
 * 1 any fixture fails (unloadable counts as failed - skipped is never a
 * pass), 2 configuration error (missing root, or a root with no fixtures:
 * an empty replay run must not masquerade as a green one).
 *
 * The walk visits EVERY .json file at any depth - files and
 * subdirectories in the same directory are both processed, so nothing can
 * be dropped silently. Layout is enforced as it goes (ADR-0001 makes it
 * load-bearing: n = file count per task directory):
 * - a fixture file's parent directory must be named body.task.id
 *   (grouping levels above, e.g. adversarial/, are free);
 * - a fixture's filename must be <id>.json or <id>.<occurrence>.json.
 * Violations are failures, not skips.
 */

export interface ReplayRunResult {
  exitCode: 0 | 1 | 2;
  lines: string[];
}

function describeDivergence(d: ReplayDivergence): string {
  switch (d.kind) {
    case "initial-state-invalid":
      return d.message;
    case "result":
      return `step ${d.seq} (${d.tool}) result diverged\n      recorded:   ${d.recorded}\n      recomputed: ${d.recomputed}`;
    case "terminal-state":
      return `terminal state diverged\n      recorded:   ${d.recorded}\n      recomputed: ${d.recomputed}`;
  }
}

export function runReplay(rootDir: string): ReplayRunResult {
  if (!existsSync(rootDir)) {
    return { exitCode: 2, lines: [`replay: fixture root not found: ${rootDir}`] };
  }
  const store = new FixtureStore(rootDir);
  const lines: string[] = [];
  let total = 0;
  let failed = 0;

  const fail = (rel: string, detail: string) => {
    failed += 1;
    lines.push(`FAIL  ${rel}\n      ${detail}`);
  };

  const processFile = (file: string, parentDirName: string) => {
    total += 1;
    const rel = relative(rootDir, file);
    let fixture: TrajectoryFixture;
    try {
      fixture = store.loadFile(file);
    } catch (e) {
      fail(rel, `invalid fixture: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (parentDirName !== fixture.body.task.id) {
      fail(rel, `misplaced fixture: parent directory "${parentDirName}" is not its task id "${fixture.body.task.id}"`);
      return;
    }
    const name = basename(file);
    if (!new RegExp(`^${fixture.id}(\\.[1-9][0-9]*)?\\.json$`).test(name)) {
      fail(rel, `misnamed fixture: expected ${fixture.id}[.<occurrence>].json`);
      return;
    }
    const report = replayFixture(fixture);
    const tag = `${fixture.meta.provenance}, ${report.toolCalls} calls`;
    if (report.ok) {
      lines.push(`ok    ${rel}  (${tag})`);
    } else {
      fail(`${rel}  (${tag})`, describeDivergence(report.divergence as ReplayDivergence));
    }
  };

  const walk = (dir: string) => {
    // statSync (not dirent.isDirectory) so symlinked directories are followed,
    // not silently skipped
    const entries = readdirSync(dir).sort();
    for (const entry of entries) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".json")) processFile(path, basename(dir));
    }
  };
  walk(rootDir);

  if (total === 0) {
    return { exitCode: 2, lines: [`replay: no fixtures found under ${rootDir} - nothing verified`] };
  }
  lines.push(
    failed === 0
      ? `replay: ${total}/${total} fixtures reproduce themselves`
      : `replay: ${failed}/${total} fixtures FAILED to reproduce themselves`,
  );
  return { exitCode: failed === 0 ? 0 : 1, lines };
}
