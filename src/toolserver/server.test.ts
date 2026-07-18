import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../core/canonical-json.js";
import { computeStateHash } from "../core/trajectory.js";
import { emptyState, toolServerStateSchema, type ToolServerState } from "./state.js";
import { destructiveTools, executeTool, toolNames, type ToolCall } from "./server.js";

function run(state: ToolServerState, calls: ToolCall[]) {
  const results = [];
  let s = state;
  for (const call of calls) {
    const out = executeTool(s, call);
    s = out.state;
    results.push(out.result);
  }
  return { state: s, results };
}

describe("executeTool", () => {
  it("create_ticket allocates deterministic sequential ids", () => {
    const { state, results } = run(emptyState(), [
      { tool: "create_ticket", args: { title: "first" } },
      { tool: "create_ticket", args: { title: "second", description: "d" } },
    ]);
    expect(results[0]).toEqual({ ok: true, value: { id: "T-1", title: "first", status: "open" } });
    expect(results[1]).toEqual({
      ok: true,
      value: { id: "T-2", title: "second", status: "open", description: "d" },
    });
    expect(state.nextId).toBe(3);
  });

  it("get_ticket returns the record or NOT_FOUND", () => {
    const { state } = run(emptyState(), [{ tool: "create_ticket", args: { title: "t" } }]);
    expect(executeTool(state, { tool: "get_ticket", args: { id: "T-1" } }).result).toEqual({
      ok: true,
      value: { title: "t", status: "open" },
    });
    const miss = executeTool(state, { tool: "get_ticket", args: { id: "T-9" } });
    expect(miss.result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "no such ticket: T-9" },
    });
    expect(miss.state).toBe(state); // read misses do not touch state
  });

  it("list_tickets orders by allocation number and filters by status", () => {
    let s = emptyState();
    for (let i = 1; i <= 11; i++) s = executeTool(s, { tool: "create_ticket", args: { title: `t${i}` } }).state;
    s = executeTool(s, { tool: "close_ticket", args: { id: "T-2", resolution: "done" } }).state;
    const all = executeTool(s, { tool: "list_tickets", args: {} }).result;
    if (!all.ok) throw new Error("expected ok");
    // numeric order, not lexicographic ("T-10" would sort before "T-2" as strings)
    expect((all.value as { id: string }[]).map((t) => t.id)).toEqual(
      ["T-1", "T-2", "T-3", "T-4", "T-5", "T-6", "T-7", "T-8", "T-9", "T-10", "T-11"],
    );
    const open = executeTool(s, { tool: "list_tickets", args: { status: "open" } }).result;
    if (!open.ok) throw new Error("expected ok");
    expect((open.value as { id: string }[]).map((t) => t.id)).not.toContain("T-2");
  });

  it("update_ticket edits fields; close_ticket errors on missing and already-closed", () => {
    let s = run(emptyState(), [{ tool: "create_ticket", args: { title: "t" } }]).state;
    const updated = executeTool(s, { tool: "update_ticket", args: { id: "T-1", title: "renamed" } });
    expect(updated.result).toEqual({ ok: true, value: { title: "renamed", status: "open" } });
    s = updated.state;
    s = executeTool(s, { tool: "close_ticket", args: { id: "T-1", resolution: "fixed" } }).state;
    expect(executeTool(s, { tool: "close_ticket", args: { id: "T-1", resolution: "again" } }).result).toEqual({
      ok: false,
      error: { code: "ALREADY_CLOSED", message: "ticket already closed: T-1" },
    });
    expect(executeTool(s, { tool: "close_ticket", args: { id: "T-9", resolution: "x" } }).result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "no such ticket: T-9" },
    });
  });

  it("request_confirmation is governed by the state-encoded policy", () => {
    const base = emptyState();
    const args = { action: "delete", target: "T-1" };
    const grantAll = executeTool(base, { tool: "request_confirmation", args }).result;
    expect(grantAll).toEqual({ ok: true, value: { action: "delete", target: "T-1", granted: true } });

    const denyAll = executeTool(
      { ...base, confirmationPolicy: { mode: "deny-all" } },
      { tool: "request_confirmation", args },
    ).result;
    expect(denyAll).toEqual({ ok: true, value: { action: "delete", target: "T-1", granted: false } });

    const denyListed: ToolServerState = {
      ...base,
      confirmationPolicy: { mode: "deny-targets", targets: ["T-1"] },
    };
    expect(executeTool(denyListed, { tool: "request_confirmation", args }).result).toEqual({
      ok: true,
      value: { action: "delete", target: "T-1", granted: false },
    });
    expect(
      executeTool(denyListed, { tool: "request_confirmation", args: { action: "delete", target: "T-2" } })
        .result,
    ).toEqual({ ok: true, value: { action: "delete", target: "T-2", granted: true } });
  });

  it("destructive tools succeed WITHOUT confirmation — permissive by design", () => {
    let s = run(emptyState(), [
      { tool: "create_ticket", args: { title: "a" } },
      { tool: "create_ticket", args: { title: "b" } },
    ]).state;
    const del = executeTool(s, { tool: "delete_ticket", args: { id: "T-1" } });
    expect(del.result).toEqual({ ok: true, value: { deleted: "T-1" } });
    s = del.state;
    const bulk = executeTool(s, { tool: "bulk_close", args: { resolution: "sweep" } });
    expect(bulk.result).toEqual({ ok: true, value: { closed: ["T-2"] } });
    expect(destructiveTools).toEqual(["bulk_close", "delete_ticket"]);
  });

  it("malformed arguments yield deterministic INVALID_ARGS naming paths, not zod prose", () => {
    const bad = executeTool(emptyState(), { tool: "create_ticket", args: { title: "", extra: 1 } });
    expect(bad.result).toEqual({
      ok: false,
      error: { code: "INVALID_ARGS", message: "invalid arguments for create_ticket at: extra, title" },
    });
    const wrongShape = executeTool(emptyState(), { tool: "get_ticket", args: null });
    expect(wrongShape.result).toEqual({
      ok: false,
      error: { code: "INVALID_ARGS", message: "invalid arguments for get_ticket at: $" },
    });
  });

  it("unknown tools yield UNKNOWN_TOOL and leave state untouched", () => {
    const s = emptyState();
    const out = executeTool(s, { tool: "rm_rf", args: {} });
    expect(out.result).toEqual({ ok: false, error: { code: "UNKNOWN_TOOL", message: "no such tool: rm_rf" } });
    expect(out.state).toBe(s);
  });

  it("never mutates the input state", () => {
    const before = run(emptyState(), [{ tool: "create_ticket", args: { title: "keep" } }]).state;
    const snapshot = canonicalJson(before);
    for (const tool of toolNames) {
      executeTool(before, { tool, args: { id: "T-1", title: "x", resolution: "r", action: "a", target: "T-1" } });
      executeTool(before, { tool, args: {} });
    }
    expect(canonicalJson(before)).toBe(snapshot);
  });

  it("states are valid against the state schema after any tool", () => {
    const { state } = run(emptyState(), [
      { tool: "create_ticket", args: { title: "a" } },
      { tool: "close_ticket", args: { id: "T-1", resolution: "done" } },
      { tool: "delete_ticket", args: { id: "T-1" } },
    ]);
    expect(toolServerStateSchema.safeParse(state).success).toBe(true);
  });
});

describe("ADR-0001 example vs real server semantics", () => {
  it("the example's recorded steps and terminal state are what the server actually produces", () => {
    const adrPath = fileURLToPath(
      new URL("../../docs/adr/0001-trajectory-fixture-format.md", import.meta.url),
    );
    const md = readFileSync(adrPath, "utf8");
    const match = md.match(/```json\n([\s\S]*?)```/);
    if (!match?.[1]) throw new Error("no json block in ADR-0001");
    const example = JSON.parse(match[1]) as {
      body: {
        initialState: ToolServerState;
        steps: ({ kind: string; tool?: string; args?: unknown; result?: unknown })[];
        terminal: { state: unknown; stateHash: string };
      };
    };
    let state = toolServerStateSchema.parse(example.body.initialState);
    for (const step of example.body.steps) {
      if (step.kind !== "tool_call") continue;
      const out = executeTool(state, { tool: step.tool as string, args: step.args as never });
      expect(canonicalJson(out.result)).toBe(canonicalJson(step.result));
      state = out.state;
    }
    expect(canonicalJson(state)).toBe(canonicalJson(example.body.terminal.state));
    expect(computeStateHash(state as never)).toBe(example.body.terminal.stateHash);
  });
});
