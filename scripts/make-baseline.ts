import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSuite } from "../src/check/suite.js";
import type { Baseline } from "../src/gate/gate.js";

/**
 * (Re)generate the committed baseline from the v1 sampled suite. A
 * baseline is an ACCEPTED state of the world: regenerating it is a
 * deliberate act reviewed in a diff, never something CI does. Fixed
 * createdAt so regeneration is byte-identical.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const suitePath = resolve(repoRoot, "policies/sampled-core.suite.json");
const outPath = resolve(repoRoot, "baselines/sampled-core.baseline.json");

const evaluation = evaluateSuite(suitePath);
if (evaluation.kind === "config-error") {
  console.error(evaluation.lines.join("\n"));
  process.exit(2);
}
if (evaluation.integrityFailures > 0) {
  console.error("baseline: refusing - fixtures failed integrity/replay");
  process.exit(1);
}
const tasks: Baseline["tasks"] = {};
for (const [task, tally] of [...evaluation.perTask.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
  tasks[task] = { n: tally.files, passes: tally.passes };
}
const baseline: Baseline = {
  suite: evaluation.suite.name,
  tasks,
  meta: {
    createdAt: "2026-07-18T00:00:00.000Z",
    note: "v1 agent sampled recordings, accepted as the reference state",
  },
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
console.log(`baseline written: ${outPath}`);
