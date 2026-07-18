import { canonicalJson } from "../core/canonical-json.js";
import type { TrajectoryFixture } from "../core/trajectory.js";
import { issuePaths } from "../core/zod-issues.js";
import { executeTool } from "../toolserver/server.js";
import { toolServerStateSchema, type ToolServerState } from "../toolserver/state.js";

/**
 * Effect replay - the integrity gate (ADR-0001). Hydrate a fresh server
 * from initialState, re-execute every tool_call in seq order against the
 * CURRENT tool server, and require every recomputed result and the final
 * state to equal the recording under canonical JSON. The first divergence
 * is reported with its step; a fixture that cannot reproduce itself is
 * invalid evidence, whatever policies might say about it.
 *
 * PRECONDITION: the fixture came through parseTrajectoryFixture (every
 * path in run.ts and suite.ts does), which proved id and stateHash match
 * the content. replayFixture itself re-checks neither - its job is
 * proving the recorded content matches recomputed reality. Callers
 * passing hand-built literals get physics verification only.
 */

export type ReplayDivergence =
  | { kind: "initial-state-invalid"; message: string }
  | { kind: "result"; seq: number; tool: string; recorded: string; recomputed: string }
  | { kind: "terminal-state"; recorded: string; recomputed: string };

export interface ReplayReport {
  ok: boolean;
  toolCalls: number;
  divergence?: ReplayDivergence;
}

export function replayFixture(fixture: TrajectoryFixture): ReplayReport {
  const hydrated = toolServerStateSchema.safeParse(fixture.body.initialState);
  if (!hydrated.success) {
    const paths = issuePaths(hydrated.error.issues);
    return {
      ok: false,
      toolCalls: 0,
      divergence: {
        kind: "initial-state-invalid",
        message: `initialState is not a valid tool-server state at: ${paths.join(", ")}`,
      },
    };
  }

  let state: ToolServerState = hydrated.data;
  let toolCalls = 0;
  for (const step of fixture.body.steps) {
    if (step.kind !== "tool_call") continue;
    toolCalls += 1;
    const out = executeTool(state, { tool: step.tool, args: structuredClone(step.args) });
    const recorded = canonicalJson(step.result);
    const recomputed = canonicalJson(out.result);
    if (recorded !== recomputed) {
      return {
        ok: false,
        toolCalls,
        divergence: { kind: "result", seq: step.seq, tool: step.tool, recorded, recomputed },
      };
    }
    state = out.state;
  }

  const recordedTerminal = canonicalJson(fixture.body.terminal.state);
  const recomputedTerminal = canonicalJson(state);
  if (recordedTerminal !== recomputedTerminal) {
    return {
      ok: false,
      toolCalls,
      divergence: { kind: "terminal-state", recorded: recordedTerminal, recomputed: recomputedTerminal },
    };
  }

  return { ok: true, toolCalls };
}
