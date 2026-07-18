import type { JsonValue } from "../core/json.js";
import {
  computeFixtureId,
  computeStateHash,
  type Step,
  type TrajectoryFixture,
  type TrajectoryMeta,
} from "../core/trajectory.js";
import { executeTool, type ToolResult } from "../toolserver/server.js";
import { toolServerStateSchema, type ToolServerState } from "../toolserver/state.js";

/**
 * The recorder seam: wraps the tool server and accumulates ADR-0001 steps.
 * Whatever drives it - the scripted driver (M2), a live model adapter
 * (never in CI) - the emitted fixture is identical in kind.
 *
 * Deliberately clock-free: `recordedAt` is the caller's problem, passed
 * into finish(). Scripted authoring passes a fixed value so regenerated
 * fixtures are byte-identical; a live recorder passes the wall clock it
 * reads outside recorded semantics.
 */
export class TrajectoryRecorder {
  private readonly steps: Step[] = [];
  private readonly initialState: JsonValue;
  private state: ToolServerState;
  private finished = false;

  constructor(
    private readonly task: { id: string; instruction: string },
    initialState: JsonValue,
  ) {
    this.initialState = structuredClone(initialState);
    this.state = toolServerStateSchema.parse(initialState);
  }

  /** Execute a tool call against the live state and record the step. */
  call(tool: string, args: JsonValue): ToolResult {
    this.assertOpen();
    const out = executeTool(this.state, { tool, args: structuredClone(args) });
    this.steps.push({
      seq: this.steps.length,
      kind: "tool_call",
      tool,
      args: structuredClone(args),
      result: structuredClone(out.result),
    });
    this.state = out.state;
    return out.result;
  }

  /** Record free-text context. Mechanically inert (ADR-0001). */
  note(text: string): void {
    this.assertOpen();
    this.steps.push({ seq: this.steps.length, kind: "note", text });
  }

  finish(
    outcome: { kind: "completed" | "aborted" | "error"; detail?: string },
    meta: TrajectoryMeta,
  ): TrajectoryFixture {
    this.assertOpen();
    this.finished = true;
    const terminalState = structuredClone(this.state) as unknown as JsonValue;
    const body: TrajectoryFixture["body"] = {
      task: { ...this.task },
      initialState: this.initialState,
      steps: this.steps,
      terminal: {
        state: terminalState,
        stateHash: computeStateHash(terminalState),
        outcome,
      },
    };
    return { formatVersion: 1, id: computeFixtureId(body), body, meta };
  }

  private assertOpen(): void {
    if (this.finished) throw new Error("recorder already finished");
  }
}
