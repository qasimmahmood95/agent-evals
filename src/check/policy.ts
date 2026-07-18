import { z } from "zod";
import { jsonValueSchema } from "../core/trajectory.js";

/**
 * Trajectory policies — the assertion side of the evidence/assertion split
 * (ground rule 1). A policy declares what a trajectory is allowed to do;
 * it lives in a suite file under policies/, never inside a fixture.
 * Policies are plain JSON (same parser, same canonical rules as fixtures;
 * description fields do the job comments would).
 */

const stepMatcherSchema = z.strictObject({
  tool: z.string().min(1),
});

/**
 * Every step matching `after` must be preceded by a step matching one of
 * `before`; with `sameArg`, the earlier step's args[beforeArg] must equal
 * the later step's args[afterArg] (canonical JSON equality).
 */
export const orderingPolicySchema = z.strictObject({
  kind: z.literal("ordering"),
  description: z.string().optional(),
  before: z.array(stepMatcherSchema).min(1),
  after: stepMatcherSchema,
  sameArg: z.strictObject({ beforeArg: z.string().min(1), afterArg: z.string().min(1) }).optional(),
});

/**
 * The side-effect allowlist. Two rules:
 * - every tool called must be in allowedTools (UNLISTED_TOOL otherwise);
 * - every call to a tool listed in `destructive` must be preceded by a
 *   successful `confirmation.tool` call whose RESULT (server truth, not
 *   agent claim) has granted === true, action === the destructive tool's
 *   name, and — when the destructive entry names a targetArg — target
 *   equal to the destructive call's args[targetArg]
 *   (UNCONFIRMED_DESTRUCTIVE otherwise).
 *
 * Stated limitation: a granted confirmation is neither consumed nor
 * expiring — one grant for (action, target) licenses any number of later
 * matching destructive calls in the trajectory. Defensible at toy scale
 * with per-target matching; a oneUse flag is the extension point if that
 * ever stops being true.
 */
export const allowlistPolicySchema = z
  .strictObject({
    kind: z.literal("allowlist"),
    description: z.string().optional(),
    allowedTools: z.array(z.string().min(1)).min(1),
    destructive: z.array(
      z.strictObject({ tool: z.string().min(1), targetArg: z.string().min(1).optional() }),
    ),
    confirmation: z
      .strictObject({ tool: z.string().min(1) })
      .optional(),
  })
  .refine((p) => p.destructive.length === 0 || p.confirmation !== undefined, {
    message: "confirmation is required when destructive tools are listed",
    path: ["confirmation"],
  });

/**
 * Re-validate every recorded call's arguments against the CURRENT tool
 * server's schemas, and flag recorded INVALID_ARGS / UNKNOWN_TOOL results:
 * such steps replay fine (the error is deterministic), but a well-behaved
 * agent doesn't send malformed calls (MALFORMED_CALL).
 */
export const argSchemaPolicySchema = z.strictObject({
  kind: z.literal("arg-schema"),
  description: z.string().optional(),
});

const terminalAssertionSchema = z.union([
  z.strictObject({ path: z.string().min(1), equals: jsonValueSchema }),
  z.strictObject({ path: z.string().min(1), exists: z.boolean() }),
  z.strictObject({ path: z.string().min(1), count: z.number().int().nonnegative() }),
]);

/** Declarative assertions over terminal.state (TERMINAL_STATE on failure). */
export const terminalStatePolicySchema = z.strictObject({
  kind: z.literal("terminal-state"),
  description: z.string().optional(),
  assertions: z.array(terminalAssertionSchema).min(1),
});

/**
 * Declarative assertions over initialState (INITIAL_STATE on failure) —
 * same grammar as terminal-state. Exists to pin the SCENARIO: a
 * hand-authored fixture could otherwise weaken the environment (e.g. swap
 * a deny-targets confirmation policy for grant-all) and pass a policy
 * whose meaning depended on it.
 */
export const initialStatePolicySchema = z.strictObject({
  kind: z.literal("initial-state"),
  description: z.string().optional(),
  assertions: z.array(terminalAssertionSchema).min(1),
});

export const policySchema = z.discriminatedUnion("kind", [
  orderingPolicySchema,
  allowlistPolicySchema,
  argSchemaPolicySchema,
  terminalStatePolicySchema,
  initialStatePolicySchema,
]);

export type OrderingPolicy = z.infer<typeof orderingPolicySchema>;
export type AllowlistPolicy = z.infer<typeof allowlistPolicySchema>;
export type ArgSchemaPolicy = z.infer<typeof argSchemaPolicySchema>;
export type TerminalStatePolicy = z.infer<typeof terminalStatePolicySchema>;
export type InitialStatePolicy = z.infer<typeof initialStatePolicySchema>;
export type Policy = z.infer<typeof policySchema>;
export type TerminalAssertion = z.infer<typeof terminalAssertionSchema>;

/** Violation codes are part of the reporting contract. */
export const violationCodes = [
  "ORDERING",
  "UNLISTED_TOOL",
  "UNCONFIRMED_DESTRUCTIVE",
  "MALFORMED_CALL",
  "TERMINAL_STATE",
  "INITIAL_STATE",
] as const;
export type ViolationCode = (typeof violationCodes)[number];

export interface PolicyFinding {
  code: ViolationCode;
  policyKind: Policy["kind"];
  /** seq of the offending step, when the violation is step-shaped. */
  seq?: number;
  message: string;
}
