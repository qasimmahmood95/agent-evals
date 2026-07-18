import { describe, expect, it } from "vitest";
import { canonicalJson } from "../core/canonical-json.js";
import { emptyState, type ToolServerState } from "./state.js";
import { executeTool, type ToolCall } from "./server.js";

/**
 * The M1 determinism property (PLAN M1 DoD): any interleaving of tool
 * calls, replayed twice from the same state, yields identical results and
 * identical terminal states. Seeded PRNG - no Math.random - so a failure
 * is reproducible from the seed named in the assertion message.
 */

/** Deterministic 32-bit LCG (Numerical Recipes constants). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomCall(rand: () => number, callIndex: number): ToolCall {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const id = `T-${Math.floor(rand() * 8) + 1}`;
  const tools: readonly (() => ToolCall)[] = [
    () => ({ tool: "create_ticket", args: { title: `t${callIndex}` } }),
    () => ({ tool: "get_ticket", args: { id } }),
    () => {
      const args: Record<string, string> = {};
      if (rand() >= 0.5) args.status = pick(["open", "closed"]);
      return { tool: "list_tickets", args };
    },
    () => ({ tool: "update_ticket", args: { id, title: `renamed${callIndex}` } }),
    () => ({ tool: "close_ticket", args: { id, resolution: `r${callIndex}` } }),
    () => ({ tool: "request_confirmation", args: { action: "delete", target: id } }),
    () => ({ tool: "delete_ticket", args: { id } }),
    () => ({ tool: "bulk_close", args: { resolution: `sweep${callIndex}` } }),
    // malformed calls are part of the property: validation errors must be deterministic too
    () => ({ tool: "create_ticket", args: { title: "" } }),
    () => ({ tool: "no_such_tool", args: { id } }),
  ];
  return pick(tools)();
}

function runSequence(initial: ToolServerState, calls: ToolCall[]) {
  let state = initial;
  const results: string[] = [];
  for (const call of calls) {
    const out = executeTool(state, call);
    state = out.state;
    results.push(canonicalJson(out.result));
  }
  return { terminal: canonicalJson(state), results };
}

describe("tool server determinism (property)", () => {
  it("any call sequence replayed twice from the same state is identical", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rand = lcg(seed);
      const length = 1 + Math.floor(rand() * 40);
      const calls = Array.from({ length }, (_, i) => randomCall(rand, i));

      const first = runSequence(emptyState(), calls);
      const second = runSequence(emptyState(), calls);

      expect(second.terminal, `terminal state diverged (seed ${seed})`).toBe(first.terminal);
      expect(second.results, `results diverged (seed ${seed})`).toEqual(first.results);
    }
  });

  it("replaying from a canonical-JSON round-tripped state is identical (snapshot fidelity)", () => {
    for (let seed = 100; seed <= 120; seed++) {
      const rand = lcg(seed);
      const calls = Array.from({ length: 20 }, (_, i) => randomCall(rand, i));
      // build a non-trivial mid-state, snapshot it as a fixture would, resume both ways
      const mid = runSequenceState(emptyState(), calls.slice(0, 10));
      const rehydrated = JSON.parse(canonicalJson(mid)) as ToolServerState;
      const a = runSequence(mid, calls.slice(10));
      const b = runSequence(rehydrated, calls.slice(10));
      expect(b.terminal, `seed ${seed}`).toBe(a.terminal);
      expect(b.results, `seed ${seed}`).toEqual(a.results);
    }
  });
});

function runSequenceState(initial: ToolServerState, calls: ToolCall[]): ToolServerState {
  let state = initial;
  for (const call of calls) state = executeTool(state, call).state;
  return state;
}
