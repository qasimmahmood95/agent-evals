import type { JsonValue } from "../core/json.js";
import type { TrajectoryFixture } from "../core/trajectory.js";
import { TrajectoryRecorder } from "./recorder.js";

/**
 * The disposable agent: a declarative script of tool calls and notes,
 * executed verbatim against the tool server through the recorder. This is
 * how demo fixtures are authored with zero keys (`provenance: "scripted"`).
 * It plans nothing, retries nothing, remembers nothing - it exists to
 * generate trajectories and may be deleted without loss (CONTRIBUTING.md).
 */

export type ScriptAction =
  | { do: "call"; tool: string; args: JsonValue }
  | { do: "note"; text: string };

export interface TrajectoryScript {
  /** Versioned script id, e.g. "close-duplicates@1" - becomes agent.id. */
  id: string;
  task: { id: string; instruction: string };
  initialState: JsonValue;
  actions: ScriptAction[];
  outcome: { kind: "completed" | "aborted" | "error"; detail?: string };
}

export function runScript(
  script: TrajectoryScript,
  opts: { recordedAt: string; note?: string },
): TrajectoryFixture {
  const recorder = new TrajectoryRecorder(script.task, script.initialState);
  for (const action of script.actions) {
    if (action.do === "call") recorder.call(action.tool, action.args);
    else recorder.note(action.text);
  }
  const meta: TrajectoryFixture["meta"] = {
    recordedAt: opts.recordedAt,
    provenance: "scripted",
    agent: { id: `demo-script/${script.id}`, adapterId: "scripted-driver" },
  };
  if (opts.note !== undefined) meta.note = opts.note;
  return recorder.finish(script.outcome, meta);
}
