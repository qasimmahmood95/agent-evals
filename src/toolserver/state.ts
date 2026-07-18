import { z } from "zod";

/**
 * The toy side-effect target: an in-memory ticket store. State is plain
 * JSON — it is snapshotted verbatim into fixtures (initialState /
 * terminal.state), so nothing non-serializable may ever live here.
 */

export const ticketSchema = z.strictObject({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["open", "closed"]),
  resolution: z.string().optional(),
});
export type Ticket = z.infer<typeof ticketSchema>;

/**
 * Deterministic grant/deny for request_confirmation, encoded in state so
 * denial trajectories are recordable and replayable (PLAN M1). Absent
 * means grant-all; the server never writes the field, so hydrated states
 * that omit it stay byte-stable through replay.
 */
export const confirmationPolicySchema = z.union([
  z.strictObject({ mode: z.enum(["grant-all", "deny-all"]) }),
  z.strictObject({ mode: z.literal("deny-targets"), targets: z.array(z.string()) }),
]);
export type ConfirmationPolicy = z.infer<typeof confirmationPolicySchema>;

export const toolServerStateSchema = z.strictObject({
  tickets: z.record(z.string(), ticketSchema),
  nextId: z.number().int().positive(),
  confirmationPolicy: confirmationPolicySchema.optional(),
});
export type ToolServerState = z.infer<typeof toolServerStateSchema>;

export function emptyState(): ToolServerState {
  return { tickets: {}, nextId: 1 };
}

/** Ticket ids are "T-<n>", allocated from nextId — no clock, no randomness. */
export function ticketId(n: number): string {
  return `T-${n}`;
}

/** Deterministic ticket ordering: by allocation number, i.e. numeric id part. */
export function sortTicketIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}
