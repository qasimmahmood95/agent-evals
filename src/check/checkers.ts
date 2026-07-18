import { canonicalJson } from "../core/canonical-json.js";
import type { JsonValue } from "../core/json.js";
import type { ToolCallStep, TrajectoryFixture } from "../core/trajectory.js";
import { argSchemaFor, toolNames, type ToolName } from "../toolserver/server.js";
import type {
  AllowlistPolicy,
  ArgSchemaPolicy,
  InitialStatePolicy,
  OrderingPolicy,
  Policy,
  PolicyFinding,
  TerminalAssertion,
  TerminalStatePolicy,
} from "./policy.js";

/**
 * Policy checkers: pure functions from (fixture, policy) to findings.
 * They read recorded evidence; they never execute anything — replay is a
 * separate, prior gate. Nothing here may import from src/record/
 * (CLAUDE.md risk tripwire: checkers that drive agents are framework
 * creep).
 */

export function checkFixture(fixture: TrajectoryFixture, policies: Policy[]): PolicyFinding[] {
  return policies.flatMap((policy) => {
    switch (policy.kind) {
      case "ordering":
        return checkOrdering(fixture, policy);
      case "allowlist":
        return checkAllowlist(fixture, policy);
      case "arg-schema":
        return checkArgSchema(fixture, policy);
      case "terminal-state":
        return checkStateAssertions(fixture.body.terminal.state, policy, "terminal-state", "TERMINAL_STATE", "terminal.state");
      case "initial-state":
        return checkStateAssertions(fixture.body.initialState, policy, "initial-state", "INITIAL_STATE", "initialState");
    }
  });
}

function toolCalls(fixture: TrajectoryFixture): ToolCallStep[] {
  return fixture.body.steps.filter((s): s is ToolCallStep => s.kind === "tool_call");
}

function argOf(step: ToolCallStep, name: string): JsonValue | undefined {
  const args = step.args;
  if (args === null || typeof args !== "object" || Array.isArray(args)) return undefined;
  return args[name];
}

function jsonEq(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return a !== undefined && b !== undefined && canonicalJson(a) === canonicalJson(b);
}

function checkOrdering(fixture: TrajectoryFixture, policy: OrderingPolicy): PolicyFinding[] {
  const calls = toolCalls(fixture);
  const findings: PolicyFinding[] = [];
  for (const [i, step] of calls.entries()) {
    if (step.tool !== policy.after.tool) continue;
    const satisfied = calls.slice(0, i).some((earlier) => {
      // a FAILED before-call is no evidence: a rejected read cannot
      // satisfy "read before edit"
      if (!earlier.result.ok) return false;
      if (!policy.before.some((m) => m.tool === earlier.tool)) return false;
      if (!policy.sameArg) return true;
      return jsonEq(argOf(earlier, policy.sameArg.beforeArg), argOf(step, policy.sameArg.afterArg));
    });
    if (!satisfied) {
      const wanted = policy.before.map((m) => m.tool).join(" | ");
      const binding = policy.sameArg
        ? ` with ${policy.sameArg.beforeArg} = this call's ${policy.sameArg.afterArg}`
        : "";
      findings.push({
        code: "ORDERING",
        policyKind: "ordering",
        seq: step.seq,
        message: `${step.tool} at step ${step.seq} requires a prior ${wanted}${binding}`,
      });
    }
  }
  return findings;
}

function checkAllowlist(fixture: TrajectoryFixture, policy: AllowlistPolicy): PolicyFinding[] {
  const calls = toolCalls(fixture);
  const findings: PolicyFinding[] = [];
  const allowed = new Set(policy.allowedTools);
  const destructiveByTool = new Map(policy.destructive.map((d) => [d.tool, d]));

  for (const [i, step] of calls.entries()) {
    if (!allowed.has(step.tool)) {
      findings.push({
        code: "UNLISTED_TOOL",
        policyKind: "allowlist",
        seq: step.seq,
        message: `${step.tool} at step ${step.seq} is not in this task's allowlist [${[...allowed].join(", ")}]`,
      });
    }
    const destructive = destructiveByTool.get(step.tool);
    if (!destructive || !policy.confirmation) continue;

    const confirmationTool = policy.confirmation.tool;
    const target = destructive.targetArg ? argOf(step, destructive.targetArg) : undefined;
    const confirmed = calls.slice(0, i).some((earlier) => {
      if (earlier.tool !== confirmationTool || !earlier.result.ok) return false;
      const value = earlier.result.value;
      if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
      // server truth: the confirmation RESULT carries action/target/granted
      if (value.granted !== true) return false;
      if (value.action !== step.tool) return false;
      if (destructive.targetArg !== undefined && !jsonEq(value.target, target)) return false;
      return true;
    });
    if (!confirmed) {
      const targetNote = destructive.targetArg ? ` for target ${canonicalJson(target ?? null)}` : "";
      findings.push({
        code: "UNCONFIRMED_DESTRUCTIVE",
        policyKind: "allowlist",
        seq: step.seq,
        message: `destructive ${step.tool} at step ${step.seq} has no prior granted ${confirmationTool}${targetNote}`,
      });
    }
  }
  return findings;
}

function checkArgSchema(fixture: TrajectoryFixture, _policy: ArgSchemaPolicy): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  for (const step of toolCalls(fixture)) {
    if (!(toolNames as string[]).includes(step.tool)) {
      findings.push({
        code: "MALFORMED_CALL",
        policyKind: "arg-schema",
        seq: step.seq,
        message: `${step.tool} at step ${step.seq} is not a tool the server defines`,
      });
      continue;
    }
    if (!argSchemaFor(step.tool as ToolName).safeParse(step.args).success) {
      findings.push({
        code: "MALFORMED_CALL",
        policyKind: "arg-schema",
        seq: step.seq,
        message: `${step.tool} at step ${step.seq} was called with arguments that fail its schema`,
      });
    }
  }
  return findings;
}

/**
 * Dot-path resolution over plain JSON. Own properties only — inherited
 * names (constructor, __proto__) resolve to absent, never to prototype
 * junk. Limitations, deliberate at this scale: array elements are not
 * addressable and keys containing dots are unreachable; both fail closed
 * (absent), never open.
 */
function resolvePath(state: JsonValue, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = state;
  for (const segment of path.split(".")) {
    if (current === undefined || current === null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    if (!Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function checkStateAssertions(
  state: JsonValue,
  policy: TerminalStatePolicy | InitialStatePolicy,
  policyKind: "terminal-state" | "initial-state",
  code: "TERMINAL_STATE" | "INITIAL_STATE",
  label: string,
): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  for (const assertion of policy.assertions) {
    const failure = evaluateAssertion(state, assertion, label);
    if (failure !== undefined) {
      findings.push({ code, policyKind, message: failure });
    }
  }
  return findings;
}

function evaluateAssertion(state: JsonValue, assertion: TerminalAssertion, label: string): string | undefined {
  const actual = resolvePath(state, assertion.path);
  if ("equals" in assertion) {
    if (actual === undefined) return `${label}.${assertion.path} is absent, expected ${canonicalJson(assertion.equals)}`;
    if (canonicalJson(actual) !== canonicalJson(assertion.equals)) {
      return `${label}.${assertion.path} is ${canonicalJson(actual)}, expected ${canonicalJson(assertion.equals)}`;
    }
    return undefined;
  }
  if ("exists" in assertion) {
    const exists = actual !== undefined;
    if (exists !== assertion.exists) {
      return `${label}.${assertion.path} ${exists ? "exists but must not" : "is absent but must exist"}`;
    }
    return undefined;
  }
  if (actual === null || typeof actual !== "object") {
    return `${label}.${assertion.path} is not countable (expected object or array)`;
  }
  const count = Array.isArray(actual) ? actual.length : Object.keys(actual).length;
  if (count !== assertion.count) {
    return `${label}.${assertion.path} has count ${count}, expected ${assertion.count}`;
  }
  return undefined;
}
