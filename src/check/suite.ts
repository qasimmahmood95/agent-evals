import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { readdirSync } from "node:fs";
import { z } from "zod";
import { FixtureStore } from "../core/fixture-store.js";
import type { TrajectoryFixture } from "../core/trajectory.js";
import { issuePaths } from "../core/zod-issues.js";
import { replayFixture } from "../replay/replayer.js";
import { toolNames } from "../toolserver/server.js";
import { checkFixture } from "./checkers.js";
import { policySchema, violationCodes, type Policy } from "./policy.js";

/**
 * A suite binds fixtures to policies and — for negative suites — to
 * expected violations. Fixture paths are explicit (file or task
 * directory), resolved relative to the suite file: check never infers
 * scope by walking the trajectories tree (PLAN M3).
 *
 * Exit codes are contract: 0 findings match expectations exactly (a clean
 * suite expects none), 1 mismatch or any integrity failure, 2
 * configuration error. Integrity failures — a fixture that will not load
 * or replay — are never expectable: policies assert over evidence, and
 * broken evidence cannot be assented to.
 */

export const suiteSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().optional(),
  cases: z
    .array(
      z.strictObject({
        task: z.string().min(1),
        fixtures: z.array(z.string().min(1)).min(1),
        policies: z.array(policySchema).min(1),
      }),
    )
    .min(1),
  expectedViolations: z
    .array(
      z.strictObject({
        task: z.string().min(1),
        code: z.enum(violationCodes),
        /** pin the violation to a step — "caught for the right reason" */
        seq: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
});

export type Suite = z.infer<typeof suiteSchema>;

export interface CheckRunResult {
  exitCode: 0 | 1 | 2;
  lines: string[];
}

function configError(lines: string[]): CheckRunResult {
  return { exitCode: 2, lines };
}

/**
 * Every tool name a policy references must exist on the server: a
 * misspelled matcher would otherwise match zero steps and pass silently —
 * the "skipped is never a pass" failure mode, one typo away.
 */
function unknownPolicyTools(policies: Policy[]): string[] {
  const known = new Set<string>(toolNames);
  const referenced: string[] = [];
  for (const policy of policies) {
    if (policy.kind === "ordering") {
      referenced.push(...policy.before.map((m) => m.tool), policy.after.tool);
    } else if (policy.kind === "allowlist") {
      referenced.push(...policy.allowedTools, ...policy.destructive.map((d) => d.tool));
      if (policy.confirmation) referenced.push(policy.confirmation.tool);
    }
  }
  return [...new Set(referenced.filter((t) => !known.has(t)))].sort();
}

/** Refs resolve relative to the suite file, including ../ — acceptable for
 * reviewed committed config driven by a local CLI. */
function resolveFixtureFiles(suiteDir: string, ref: string): string[] | undefined {
  const path = resolve(suiteDir, ref);
  if (!existsSync(path)) return undefined;
  if (statSync(path).isDirectory()) {
    const files = readdirSync(path)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => join(path, f));
    return files.length > 0 ? files : undefined;
  }
  return [path];
}

export interface TaskTally {
  files: number;
  passes: number;
}

export type SuiteEvaluation =
  | { kind: "config-error"; lines: string[] }
  | {
      kind: "evaluated";
      suite: Suite;
      lines: string[];
      integrityFailures: number;
      /** per-task sample tallies: a file passes when it has zero findings */
      perTask: Map<string, TaskTally>;
      violations: { task: string; code: string; seq?: number }[];
    };

/**
 * Shared evaluation core: load, integrity-check, replay, and policy-check
 * every fixture a suite binds. runCheck layers expectation matching on
 * top; the gate (M4) layers baselines and statistics on top.
 */
export function evaluateSuite(suitePath: string): SuiteEvaluation {
  if (!existsSync(suitePath)) return { kind: "config-error", lines: [`check: suite not found: ${suitePath}`] };
  let rawSuite: unknown;
  try {
    rawSuite = JSON.parse(readFileSync(suitePath, "utf8"));
  } catch (e) {
    return {
      kind: "config-error",
      lines: [`check: unreadable suite ${suitePath}: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
  const parsed = suiteSchema.safeParse(rawSuite);
  if (!parsed.success) {
    return {
      kind: "config-error",
      lines: [`check: invalid suite ${suitePath} at: ${issuePaths(parsed.error.issues).join(", ")}`],
    };
  }
  const suite = parsed.data;
  for (const suiteCase of suite.cases) {
    const unknown = unknownPolicyTools(suiteCase.policies);
    if (unknown.length > 0) {
      return {
        kind: "config-error",
        lines: [`check: case ${suiteCase.task}: policies reference unknown tools: ${unknown.join(", ")}`],
      };
    }
  }
  const suiteDir = dirname(resolve(suitePath));
  const store = new FixtureStore("."); // used only for loadFile
  const lines: string[] = [`suite ${suite.name}`];

  let integrityFailures = 0;
  const violations: { task: string; code: string; seq?: number }[] = [];
  const perTask = new Map<string, TaskTally>();

  for (const suiteCase of suite.cases) {
    const tally = perTask.get(suiteCase.task) ?? { files: 0, passes: 0 };
    perTask.set(suiteCase.task, tally);
    for (const ref of suiteCase.fixtures) {
      const files = resolveFixtureFiles(suiteDir, ref);
      if (!files) {
        return {
          kind: "config-error",
          lines: [`check: case ${suiteCase.task}: no fixtures at ${ref} — nothing to assert is not a pass`],
        };
      }
      for (const file of files) {
        const rel = relative(process.cwd(), file);
        let fixture: TrajectoryFixture;
        try {
          fixture = store.loadFile(file);
        } catch (e) {
          integrityFailures += 1;
          lines.push(`FAIL  ${rel}\n      unloadable fixture: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        if (fixture.body.task.id !== suiteCase.task) {
          return {
            kind: "config-error",
            lines: [`check: case ${suiteCase.task}: fixture ${rel} records task ${fixture.body.task.id}`],
          };
        }
        const replay = replayFixture(fixture);
        if (!replay.ok) {
          integrityFailures += 1;
          lines.push(`FAIL  ${rel}\n      fixture does not replay — policies not consulted (${replay.divergence?.kind})`);
          continue;
        }
        tally.files += 1;
        const findings = checkFixture(fixture, suiteCase.policies);
        const tag = `${fixture.meta.provenance}, ${suiteCase.policies.length} policies`;
        if (findings.length === 0) {
          tally.passes += 1;
          lines.push(`ok    ${rel}  (${tag})`);
        } else {
          for (const finding of findings) {
            const violation: { task: string; code: string; seq?: number } = {
              task: suiteCase.task,
              code: finding.code,
            };
            if (finding.seq !== undefined) violation.seq = finding.seq;
            violations.push(violation);
            lines.push(`VIOLATION [${finding.code}]  ${rel}  (${tag})\n      ${finding.message}`);
          }
        }
      }
    }
  }

  return { kind: "evaluated", suite, lines, integrityFailures, perTask, violations };
}

export function runCheck(suitePath: string): CheckRunResult {
  const evaluation = evaluateSuite(suitePath);
  if (evaluation.kind === "config-error") return configError(evaluation.lines);
  const { suite, lines, integrityFailures, violations: actual } = evaluation;

  const expected = suite.expectedViolations ?? [];

  // seq-aware matching: an expectation with a seq consumes only a
  // violation at that exact step ("caught for the right reason"); one
  // without a seq consumes any violation of that task+code. Seq-pinned
  // expectations match first so a loose one cannot steal their target.
  const remaining = [...actual];
  const missing: string[] = [];
  const describe = (v: { task: string; code: string; seq?: number }) =>
    v.seq === undefined ? `${v.task}:${v.code}` : `${v.task}:${v.code}@step${v.seq}`;
  const pinnedFirst = [...expected].sort((a, b) => Number(b.seq !== undefined) - Number(a.seq !== undefined));
  for (const exp of pinnedFirst) {
    const i = remaining.findIndex(
      (v) => v.task === exp.task && v.code === exp.code && (exp.seq === undefined || v.seq === exp.seq),
    );
    if (i === -1) missing.push(describe(exp));
    else remaining.splice(i, 1);
  }
  const unexpected = remaining.map(describe).sort();
  missing.sort();

  if (integrityFailures > 0) {
    lines.push(`suite ${suite.name}: FAIL — ${integrityFailures} fixture(s) failed integrity/replay`);
    return { exitCode: 1, lines };
  }
  if (missing.length === 0 && unexpected.length === 0) {
    lines.push(
      expected.length === 0
        ? `suite ${suite.name}: PASS — no violations`
        : `suite ${suite.name}: PASS — all ${expected.length} expected violation(s) found, nothing else`,
    );
    return { exitCode: 0, lines };
  }
  if (missing.length > 0) lines.push(`suite ${suite.name}: expected violations NOT found: ${missing.join(", ")}`);
  if (unexpected.length > 0) lines.push(`suite ${suite.name}: unexpected violations: ${unexpected.join(", ")}`);
  lines.push(`suite ${suite.name}: FAIL`);
  return { exitCode: 1, lines };
}
