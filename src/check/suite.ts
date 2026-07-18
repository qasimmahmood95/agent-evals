import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { readdirSync } from "node:fs";
import { z } from "zod";
import { FixtureStore } from "../core/fixture-store.js";
import type { TrajectoryFixture } from "../core/trajectory.js";
import { issuePaths } from "../core/zod-issues.js";
import { replayFixture } from "../replay/replayer.js";
import { checkFixture } from "./checkers.js";
import { policySchema, type PolicyFinding } from "./policy.js";

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
    .array(z.strictObject({ task: z.string().min(1), code: z.string().min(1) }))
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

export function runCheck(suitePath: string): CheckRunResult {
  if (!existsSync(suitePath)) return configError([`check: suite not found: ${suitePath}`]);
  let rawSuite: unknown;
  try {
    rawSuite = JSON.parse(readFileSync(suitePath, "utf8"));
  } catch (e) {
    return configError([`check: unreadable suite ${suitePath}: ${e instanceof Error ? e.message : String(e)}`]);
  }
  const parsed = suiteSchema.safeParse(rawSuite);
  if (!parsed.success) {
    return configError([
      `check: invalid suite ${suitePath} at: ${issuePaths(parsed.error.issues).join(", ")}`,
    ]);
  }
  const suite = parsed.data;
  const suiteDir = dirname(resolve(suitePath));
  const store = new FixtureStore("."); // used only for loadFile
  const lines: string[] = [`suite ${suite.name}`];

  let integrityFailures = 0;
  const actual: { task: string; code: string }[] = [];

  for (const suiteCase of suite.cases) {
    for (const ref of suiteCase.fixtures) {
      const files = resolveFixtureFiles(suiteDir, ref);
      if (!files) {
        return configError([`check: case ${suiteCase.task}: no fixtures at ${ref} — nothing to assert is not a pass`]);
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
          return configError([
            `check: case ${suiteCase.task}: fixture ${rel} records task ${fixture.body.task.id}`,
          ]);
        }
        const replay = replayFixture(fixture);
        if (!replay.ok) {
          integrityFailures += 1;
          lines.push(`FAIL  ${rel}\n      fixture does not replay — policies not consulted (${replay.divergence?.kind})`);
          continue;
        }
        const findings = checkFixture(fixture, suiteCase.policies);
        const tag = `${fixture.meta.provenance}, ${suiteCase.policies.length} policies`;
        if (findings.length === 0) {
          lines.push(`ok    ${rel}  (${tag})`);
        } else {
          for (const finding of findings) {
            actual.push({ task: suiteCase.task, code: finding.code });
            lines.push(`VIOLATION [${finding.code}]  ${rel}  (${tag})\n      ${finding.message}`);
          }
        }
      }
    }
  }

  const expected = suite.expectedViolations ?? [];
  const key = (v: { task: string; code: string }) => `${v.task}:${v.code}`;
  const actualSorted = actual.map(key).sort();
  const expectedSorted = expected.map(key).sort();
  const matches = JSON.stringify(actualSorted) === JSON.stringify(expectedSorted);

  if (integrityFailures > 0) {
    lines.push(`suite ${suite.name}: FAIL — ${integrityFailures} fixture(s) failed integrity/replay`);
    return { exitCode: 1, lines };
  }
  if (matches) {
    lines.push(
      expected.length === 0
        ? `suite ${suite.name}: PASS — no violations`
        : `suite ${suite.name}: PASS — all ${expected.length} expected violation(s) found, nothing else`,
    );
    return { exitCode: 0, lines };
  }
  const missing = diffMultiset(expectedSorted, actualSorted);
  const unexpected = diffMultiset(actualSorted, expectedSorted);
  if (missing.length > 0) lines.push(`suite ${suite.name}: expected violations NOT found: ${missing.join(", ")}`);
  if (unexpected.length > 0) lines.push(`suite ${suite.name}: unexpected violations: ${unexpected.join(", ")}`);
  lines.push(`suite ${suite.name}: FAIL`);
  return { exitCode: 1, lines };
}

function diffMultiset(a: string[], b: string[]): string[] {
  const counts = new Map<string, number>();
  for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const n = counts.get(x) ?? 0;
    if (n > 0) counts.set(x, n - 1);
    else out.push(x);
  }
  return out;
}
