import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { issuePaths } from "../core/zod-issues.js";
import { evaluateSuite } from "../check/suite.js";
import { benjaminiHochberg } from "../stats/benjamini-hochberg.js";
import { pairedMeanDiffCI } from "../stats/bootstrap.js";
import { wilson } from "../stats/wilson.js";

/**
 * The gate: current policy pass rates per task, compared against a
 * committed baseline, judged under llm-evals-ts verdict rules —
 * `REGRESSION` only when the paired-bootstrap 95% CI on the mean per-task
 * difference excludes zero AND the Benjamini–Hochberg-adjusted q across
 * the gate family clears α; `PASS` additionally requires the CI narrow
 * enough to certify precision (half-width ≤ 0.1). `INCONCLUSIVE` covers
 * every remaining case, said out loud: a CI containing zero but too wide,
 * a CI excluding zero that BH does not confirm across the family, and a
 * suite with fewer than two tasks (a variance estimate from n=1 is
 * undefined — the gate refuses a confident verdict rather than certify
 * one observation).
 *
 * Only suites whose statistics exist enter the BH family — an
 * integrity-failed suite is not a hypothesis.
 *
 * Exit codes: 0 no regression (INCONCLUSIVE reported loudly but passes),
 * 1 any REGRESSION or any integrity failure, 2 configuration error.
 */

export const baselineSchema = z.strictObject({
  suite: z.string().min(1),
  tasks: z.record(
    z.string().min(1),
    z.strictObject({ n: z.number().int().positive(), passes: z.number().int().nonnegative() }),
  ),
  meta: z.strictObject({ createdAt: z.string(), note: z.string().optional() }),
});
export type Baseline = z.infer<typeof baselineSchema>;

export const gateConfigSchema = z.strictObject({
  description: z.string().optional(),
  alpha: z.number().gt(0).lt(1).default(0.05),
  passHalfWidth: z.number().gt(0).default(0.1),
  bootstrapB: z.number().int().positive().default(10_000),
  seed: z.number().int().default(42),
  entries: z
    .array(z.strictObject({ suite: z.string().min(1), baseline: z.string().min(1) }))
    .min(1),
});
export type GateConfig = z.infer<typeof gateConfigSchema>;

export type Verdict = "PASS" | "REGRESSION" | "IMPROVEMENT" | "INCONCLUSIVE";

export interface GateRunResult {
  exitCode: 0 | 1 | 2;
  lines: string[];
}

function fmt(x: number): string {
  return x.toFixed(2);
}

export function runGate(configPath: string): GateRunResult {
  if (!existsSync(configPath)) return { exitCode: 2, lines: [`gate: config not found: ${configPath}`] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    return { exitCode: 2, lines: [`gate: unreadable config: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const parsedConfig = gateConfigSchema.safeParse(raw);
  if (!parsedConfig.success) {
    return { exitCode: 2, lines: [`gate: invalid config at: ${issuePaths(parsedConfig.error.issues).join(", ")}`] };
  }
  const config = parsedConfig.data;
  const configDir = dirname(resolve(configPath));

  const lines: string[] = [];
  let integrityFailed = false;

  interface EntryResult {
    suiteName: string;
    verdictInput?: {
      diffs: number[];
      rateNow: number;
      rateBaseline: number;
      passesNow: number;
      filesNow: number;
    };
    detailLines: string[];
  }

  const entries: EntryResult[] = [];
  for (const entry of config.entries) {
    const suitePath = resolve(configDir, entry.suite);
    const baselinePath = resolve(configDir, entry.baseline);
    const evaluation = evaluateSuite(suitePath);
    if (evaluation.kind === "config-error") return { exitCode: 2, lines: evaluation.lines };
    if (!existsSync(baselinePath)) return { exitCode: 2, lines: [`gate: baseline not found: ${baselinePath}`] };
    let baselineRaw: unknown;
    try {
      baselineRaw = JSON.parse(readFileSync(baselinePath, "utf8"));
    } catch (e) {
      return { exitCode: 2, lines: [`gate: unreadable baseline: ${e instanceof Error ? e.message : String(e)}`] };
    }
    const parsedBaseline = baselineSchema.safeParse(baselineRaw);
    if (!parsedBaseline.success) {
      return { exitCode: 2, lines: [`gate: invalid baseline at: ${issuePaths(parsedBaseline.error.issues).join(", ")}`] };
    }
    const baseline = parsedBaseline.data;
    if (baseline.suite !== evaluation.suite.name) {
      return {
        exitCode: 2,
        lines: [`gate: baseline is for suite "${baseline.suite}", entry evaluates "${evaluation.suite.name}"`],
      };
    }

    if (evaluation.integrityFailures > 0) {
      integrityFailed = true;
      entries.push({
        suiteName: evaluation.suite.name,
        detailLines: evaluation.lines.filter((l) => l.startsWith("FAIL")),
      });
      continue;
    }

    const nowTasks = [...evaluation.perTask.keys()].sort();
    const baselineTasks = Object.keys(baseline.tasks).sort();
    if (JSON.stringify(nowTasks) !== JSON.stringify(baselineTasks)) {
      return {
        exitCode: 2,
        lines: [
          `gate: task sets differ — paired comparison undefined`,
          `      now:      ${nowTasks.join(", ")}`,
          `      baseline: ${baselineTasks.join(", ")}`,
        ],
      };
    }

    const diffs: number[] = [];
    let passesNow = 0;
    let filesNow = 0;
    let passesBase = 0;
    let filesBase = 0;
    for (const task of nowTasks) {
      const now = evaluation.perTask.get(task) as { files: number; passes: number };
      const base = baseline.tasks[task] as { n: number; passes: number };
      diffs.push(now.passes / now.files - base.passes / base.n);
      passesNow += now.passes;
      filesNow += now.files;
      passesBase += base.passes;
      filesBase += base.n;
    }
    entries.push({
      suiteName: evaluation.suite.name,
      verdictInput: {
        diffs,
        rateNow: passesNow / filesNow,
        rateBaseline: passesBase / filesBase,
        passesNow,
        filesNow,
      },
      detailLines: evaluation.lines.filter((l) => l.startsWith("VIOLATION")),
    });
  }

  // family-wide multiplicity adjustment — only over suites whose
  // statistics exist; an integrity-failed suite is not a hypothesis
  const stats = entries.map((e) =>
    e.verdictInput
      ? pairedMeanDiffCI(e.verdictInput.diffs, { B: config.bootstrapB, seed: config.seed })
      : undefined,
  );
  const definedIndices = stats.flatMap((s, i) => (s ? [i] : []));
  const qs = benjaminiHochberg(definedIndices.map((i) => (stats[i] as { pValue: number }).pValue));
  const qByIndex = new Map<number, number>(definedIndices.map((idx, j) => [idx, qs[j] as number]));

  lines.push(`# gate (α=${config.alpha}, B=${config.bootstrapB}, seed=${config.seed})`);
  lines.push("");
  lines.push("| Suite | Verdict | Pass rate | Δ [95% CI] | n tasks | q (BH) |");
  lines.push("|---|---|---|---|---|---|");

  let anyRegression = false;
  const smallN: string[] = [];
  for (const [i, entry] of entries.entries()) {
    const s = stats[i];
    if (!entry.verdictInput || !s) {
      lines.push(`| ${entry.suiteName} | INTEGRITY FAIL | — | — | — | — |`);
      continue;
    }
    const q = qByIndex.get(i) as number;
    let verdict: Verdict;
    if (s.n < 2) {
      verdict = "INCONCLUSIVE";
      smallN.push(entry.suiteName);
    } else if (s.upper < 0 && q <= config.alpha) verdict = "REGRESSION";
    else if (s.lower > 0 && q <= config.alpha) verdict = "IMPROVEMENT";
    else if (s.lower <= 0 && s.upper >= 0 && (s.upper - s.lower) / 2 <= config.passHalfWidth) verdict = "PASS";
    else verdict = "INCONCLUSIVE";
    if (verdict === "REGRESSION") anyRegression = true;
    const v = entry.verdictInput;
    lines.push(
      `| ${entry.suiteName} | ${verdict} | ${fmt(v.rateBaseline)} → ${fmt(v.rateNow)} | ${fmt(s.mean)} [${fmt(s.lower)}, ${fmt(s.upper)}] | ${s.n} | ${q.toFixed(4)} |`,
    );
  }
  lines.push("");

  for (const entry of entries) {
    if (entry.detailLines.length > 0) {
      lines.push(`## ${entry.suiteName} details`);
      lines.push(...entry.detailLines);
      lines.push("");
    }
    if (entry.verdictInput) {
      const ci = wilson(entry.verdictInput.passesNow, entry.verdictInput.filesNow);
      if (ci) {
        lines.push(
          `${entry.suiteName}: current pass rate ${fmt(entry.verdictInput.rateNow)} (${entry.verdictInput.passesNow}/${entry.verdictInput.filesNow}, 95% Wilson CI [${fmt(ci.lower)}, ${fmt(ci.upper)}])`,
        );
      }
    }
  }
  for (const name of smallN) {
    lines.push(`note: ${name}: fewer than 2 tasks — no variance estimate; verdict forced INCONCLUSIVE`);
  }
  lines.push("");
  lines.push(
    "note: replay mode — uncertainty reflects task sampling only; agent stochasticity is frozen at recording time",
  );

  if (integrityFailed) {
    lines.push("gate: FAIL — fixtures failed integrity/replay");
    return { exitCode: 1, lines };
  }
  if (anyRegression) {
    lines.push("gate: REGRESSION — gate failed");
    return { exitCode: 1, lines };
  }
  lines.push("gate: no regression detected at this n");
  return { exitCode: 0, lines };
}
