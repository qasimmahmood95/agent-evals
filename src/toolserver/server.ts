import { z } from "zod";
import type { JsonValue } from "../core/json.js";
import {
  sortTicketIds,
  ticketId,
  type Ticket,
  type ToolServerState,
} from "./state.js";

/**
 * The toy tool server. executeTool is a pure function of (state, call):
 * no clock, no randomness, no I/O. The input state is never mutated.
 *
 * Two deliberate design points (PLAN M1):
 * - Arguments are validated here, at execution time; malformed arguments
 *   yield a deterministic `ok: false` result — an ordinary recorded step.
 *   Error messages are built from issue *paths only*, never from zod's
 *   message text, so a zod upgrade can't invalidate committed fixtures.
 * - The server does NOT enforce the confirmation protocol. delete_ticket
 *   and bulk_close succeed unconditionally; catching an unconfirmed
 *   destructive call is the policy layer's job, not the toy's.
 */

export interface ToolCall {
  tool: string;
  args: JsonValue;
}

export type ToolResult =
  | { ok: true; value: JsonValue }
  | { ok: false; error: { code: string; message: string } };

export interface ExecuteOutcome {
  state: ToolServerState;
  result: ToolResult;
}

const argSchemas = {
  create_ticket: z.strictObject({
    title: z.string().min(1),
    description: z.string().optional(),
  }),
  get_ticket: z.strictObject({ id: z.string() }),
  list_tickets: z.strictObject({ status: z.enum(["open", "closed"]).optional() }),
  update_ticket: z.strictObject({
    id: z.string(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
  }),
  close_ticket: z.strictObject({ id: z.string(), resolution: z.string().min(1) }),
  request_confirmation: z.strictObject({ action: z.string().min(1), target: z.string().min(1) }),
  delete_ticket: z.strictObject({ id: z.string() }),
  bulk_close: z.strictObject({ resolution: z.string().min(1) }),
} as const;

export type ToolName = keyof typeof argSchemas;

export const toolNames = Object.keys(argSchemas).sort() as ToolName[];

/** Tools whose calls destroy or mass-mutate data — the allowlist targets (M3). */
export const destructiveTools: readonly ToolName[] = ["bulk_close", "delete_ticket"];

export function argSchemaFor(tool: ToolName): z.ZodType<unknown> {
  return argSchemas[tool];
}

function err(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

function ok(value: JsonValue): ToolResult {
  return { ok: true, value };
}

/** Ticket record as returned to callers: the stored fields, no id echo. */
function ticketView(ticket: Ticket): JsonValue {
  const view: Record<string, JsonValue> = { title: ticket.title, status: ticket.status };
  if (ticket.description !== undefined) view.description = ticket.description;
  if (ticket.resolution !== undefined) view.resolution = ticket.resolution;
  return view;
}

export function executeTool(state: ToolServerState, call: ToolCall): ExecuteOutcome {
  if (!Object.hasOwn(argSchemas, call.tool)) {
    return { state, result: err("UNKNOWN_TOOL", `no such tool: ${call.tool}`) };
  }
  const tool = call.tool as ToolName;
  const parsed = argSchemas[tool].safeParse(call.args);
  if (!parsed.success) {
    // Paths only, never zod's message text: a zod upgrade must not be able
    // to change recorded results. Unrecognized keys are reported by zod at
    // the object root, so expand them into per-key paths.
    const paths = [
      ...new Set(
        parsed.error.issues.flatMap((i) =>
          i.code === "unrecognized_keys"
            ? i.keys.map((k) => [...i.path, k].join("."))
            : [i.path.join(".") || "$"],
        ),
      ),
    ].sort();
    return {
      state,
      result: err("INVALID_ARGS", `invalid arguments for ${tool} at: ${paths.join(", ")}`),
    };
  }

  switch (tool) {
    case "create_ticket": {
      const args = parsed.data as z.infer<(typeof argSchemas)["create_ticket"]>;
      const id = ticketId(state.nextId);
      if (state.tickets[id]) {
        // A hand-authored state may set nextId at an allocated id; clobbering
        // silently would be a lie about side effects. Deterministic error.
        return { state, result: err("ID_EXISTS", `id collision at ${id}: nextId points at an existing ticket`) };
      }
      const ticket: Ticket = { title: args.title, status: "open" };
      if (args.description !== undefined) ticket.description = args.description;
      const next = structuredClone(state);
      next.tickets[id] = ticket;
      next.nextId = state.nextId + 1;
      const view = ticketView(ticket) as Record<string, JsonValue>;
      return { state: next, result: ok({ id, ...view }) };
    }
    case "get_ticket": {
      const args = parsed.data as z.infer<(typeof argSchemas)["get_ticket"]>;
      const ticket = state.tickets[args.id];
      if (!ticket) return { state, result: err("NOT_FOUND", `no such ticket: ${args.id}`) };
      return { state, result: ok(ticketView(ticket)) };
    }
    case "list_tickets": {
      const args = parsed.data as z.infer<(typeof argSchemas)["list_tickets"]>;
      const ids = sortTicketIds(
        Object.keys(state.tickets).filter(
          (id) => args.status === undefined || state.tickets[id]?.status === args.status,
        ),
      );
      return {
        state,
        result: ok(
          ids.map((id) => {
            const view = ticketView(state.tickets[id] as Ticket) as Record<string, JsonValue>;
            return { id, ...view };
          }),
        ),
      };
    }
    case "update_ticket": {
      const args = parsed.data as z.infer<(typeof argSchemas)["update_ticket"]>;
      const ticket = state.tickets[args.id];
      if (!ticket) return { state, result: err("NOT_FOUND", `no such ticket: ${args.id}`) };
      const next = structuredClone(state);
      const updated = next.tickets[args.id] as Ticket;
      if (args.title !== undefined) updated.title = args.title;
      if (args.description !== undefined) updated.description = args.description;
      return { state: next, result: ok(ticketView(updated)) };
    }
    case "close_ticket": {
      const args = parsed.data as z.infer<(typeof argSchemas)["close_ticket"]>;
      const ticket = state.tickets[args.id];
      if (!ticket) return { state, result: err("NOT_FOUND", `no such ticket: ${args.id}`) };
      if (ticket.status === "closed")
        return { state, result: err("ALREADY_CLOSED", `ticket already closed: ${args.id}`) };
      const next = structuredClone(state);
      const closed = next.tickets[args.id] as Ticket;
      closed.status = "closed";
      closed.resolution = args.resolution;
      return { state: next, result: ok({ id: args.id, status: "closed" }) };
    }
    case "request_confirmation": {
      const args = parsed.data as z.infer<(typeof argSchemas)["request_confirmation"]>;
      const policy = state.confirmationPolicy ?? { mode: "grant-all" as const };
      const granted =
        policy.mode === "grant-all" ||
        (policy.mode === "deny-targets" && !policy.targets.includes(args.target));
      return { state, result: ok({ action: args.action, target: args.target, granted }) };
    }
    case "delete_ticket": {
      const args = parsed.data as z.infer<(typeof argSchemas)["delete_ticket"]>;
      if (!state.tickets[args.id])
        return { state, result: err("NOT_FOUND", `no such ticket: ${args.id}`) };
      const next = structuredClone(state);
      delete next.tickets[args.id];
      return { state: next, result: ok({ deleted: args.id }) };
    }
    case "bulk_close": {
      const args = parsed.data as z.infer<(typeof argSchemas)["bulk_close"]>;
      const openIds = sortTicketIds(
        Object.keys(state.tickets).filter((id) => state.tickets[id]?.status === "open"),
      );
      const next = structuredClone(state);
      for (const id of openIds) {
        const t = next.tickets[id] as Ticket;
        t.status = "closed";
        t.resolution = args.resolution;
      }
      return { state: next, result: ok({ closed: openIds }) };
    }
  }
}
