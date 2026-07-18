import { existsSync } from "node:fs";
import { relative } from "node:path";
import { FixtureStore } from "../core/fixture-store.js";
import type { TrajectoryFixture } from "../core/trajectory.js";
import { replayFixture, type ReplayDivergence } from "./replayer.js";

/**
 * Replay every committed fixture under a store root. Exit codes are
 * contract (llm-evals-ts discipline): 0 all fixtures reproduce themselves,
 * 1 any fixture fails (unloadable counts as failed — skipped is never a
 * pass), 2 configuration error (missing root, or a root with no fixtures:
 * an empty replay run must not masquerade as a green one).
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

  const walk = (s: FixtureStore) => {
    for (const taskId of s.taskIds()) {
      // one level of nesting is reserved for suite grouping (e.g. adversarial/)
      const nested = new FixtureStore(s.dirFor(taskId));
      if (s.filesFor(taskId).length === 0 && nested.taskIds().length > 0) {
        walk(nested);
        continue;
      }
      for (const file of s.filesFor(taskId)) {
        total += 1;
        const rel = relative(rootDir, file);
        let fixture: TrajectoryFixture;
        try {
          fixture = s.loadFile(file);
        } catch (e) {
          failed += 1;
          lines.push(`FAIL  ${rel}\n      invalid fixture: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        const report = replayFixture(fixture);
        const tag = `${fixture.meta.provenance}, ${report.toolCalls} calls`;
        if (report.ok) {
          lines.push(`ok    ${rel}  (${tag})`);
        } else {
          failed += 1;
          lines.push(`FAIL  ${rel}  (${tag})\n      ${describeDivergence(report.divergence as ReplayDivergence)}`);
        }
      }
    }
  };
  walk(store);

  if (total === 0) {
    return { exitCode: 2, lines: [`replay: no fixtures found under ${rootDir} — nothing verified`] };
  }
  lines.push(
    failed === 0
      ? `replay: ${total}/${total} fixtures reproduce themselves`
      : `replay: ${failed}/${total} fixtures FAILED to reproduce themselves`,
  );
  return { exitCode: failed === 0 ? 0 : 1, lines };
}
