import { z } from "zod";
import { hashJson } from "./hash.js";
import type { JsonValue } from "./json.js";

/**
 * The trajectory fixture format, per ADR-0001. zod owns shape; hash
 * *correctness* (id, terminal.stateHash) is loader logic — see
 * parseTrajectoryFixture.
 */

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex chars (sha256)");

/** Filesystem-safe by construction: task ids name fixture directories. */
const taskIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "task id must be lowercase alphanumeric with hyphens");

const isoDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    "expected ISO 8601 datetime",
  );

const toolCallStepSchema = z.strictObject({
  seq: z.number().int().nonnegative(),
  kind: z.literal("tool_call"),
  tool: z.string().min(1),
  args: jsonValueSchema,
  result: z.union([
    z.strictObject({ ok: z.literal(true), value: jsonValueSchema }),
    z.strictObject({
      ok: z.literal(false),
      error: z.strictObject({ code: z.string().min(1), message: z.string() }),
    }),
  ]),
});

const noteStepSchema = z.strictObject({
  seq: z.number().int().nonnegative(),
  kind: z.literal("note"),
  text: z.string(),
});

const stepSchema = z.discriminatedUnion("kind", [toolCallStepSchema, noteStepSchema]);

const trajectoryBodySchema = z.strictObject({
  task: z.strictObject({
    id: taskIdSchema,
    instruction: z.string().min(1),
  }),
  initialState: jsonValueSchema,
  steps: z.array(stepSchema).superRefine((steps, ctx) => {
    steps.forEach((step, i) => {
      if (step.seq !== i) {
        ctx.addIssue({
          code: "custom",
          path: [i, "seq"],
          message: `steps must be contiguous from 0: expected seq ${i}, got ${step.seq}`,
        });
      }
    });
  }),
  terminal: z.strictObject({
    state: jsonValueSchema,
    stateHash: sha256HexSchema,
    outcome: z.strictObject({
      kind: z.enum(["completed", "aborted", "error"]),
      detail: z.string().optional(),
    }),
  }),
});

const trajectoryMetaSchema = z.strictObject({
  recordedAt: isoDateTimeSchema,
  provenance: z.enum(["live-record", "scripted", "hand-authored"]),
  agent: z.strictObject({
    id: z.string().min(1),
    adapterId: z.string().min(1),
  }),
  note: z.string().optional(),
});

export const trajectoryFixtureSchema = z.strictObject({
  formatVersion: z.literal(1),
  id: sha256HexSchema,
  body: trajectoryBodySchema,
  meta: trajectoryMetaSchema,
});

export type TrajectoryFixture = z.infer<typeof trajectoryFixtureSchema>;
export type TrajectoryBody = TrajectoryFixture["body"];
export type Step = TrajectoryBody["steps"][number];
export type ToolCallStep = Extract<Step, { kind: "tool_call" }>;
export type NoteStep = Extract<Step, { kind: "note" }>;
export type TrajectoryMeta = TrajectoryFixture["meta"];
export type Provenance = TrajectoryMeta["provenance"];

export function computeFixtureId(body: TrajectoryBody): string {
  return hashJson(body);
}

export function computeStateHash(state: JsonValue): string {
  return hashJson(state);
}

/** Shape violation (zod) — carries field-level issue paths. */
export class FixtureShapeError extends Error {
  constructor(readonly issues: readonly { path: string; message: string }[]) {
    super(`invalid trajectory fixture:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
    this.name = "FixtureShapeError";
  }
}

/** Stored hash disagrees with recomputation — the fixture is not trusted. */
export class FixtureIntegrityError extends Error {
  constructor(
    readonly field: "id" | "terminal.stateHash",
    readonly stored: string,
    readonly computed: string,
  ) {
    super(`fixture integrity failure at ${field}: stored ${stored}, computed ${computed}`);
    this.name = "FixtureIntegrityError";
  }
}

/**
 * The only sanctioned way to turn untrusted JSON into a TrajectoryFixture:
 * zod validates shape, then both content hashes are recomputed and must
 * match what the file claims. A fixture that fails either check does not
 * exist as far as the harness is concerned.
 */
export function parseTrajectoryFixture(raw: unknown): TrajectoryFixture {
  const parsed = trajectoryFixtureSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FixtureShapeError(
      parsed.error.issues.map((i) => ({ path: i.path.join(".") || "$", message: i.message })),
    );
  }
  const fixture = parsed.data;
  const computedId = computeFixtureId(fixture.body);
  if (computedId !== fixture.id) {
    throw new FixtureIntegrityError("id", fixture.id, computedId);
  }
  const computedStateHash = computeStateHash(fixture.body.terminal.state);
  if (computedStateHash !== fixture.body.terminal.stateHash) {
    throw new FixtureIntegrityError("terminal.stateHash", fixture.body.terminal.stateHash, computedStateHash);
  }
  return fixture;
}
