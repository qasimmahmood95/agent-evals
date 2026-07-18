import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FixtureStore } from "../src/core/fixture-store.js";
import { runScript } from "../src/record/script-driver.js";
import { adversarialScripts } from "./adversarial-scripts.js";
import { demoScripts, RECORDED_AT } from "./demo-scripts.js";
import { sampledV1, sampledV2 } from "./sampled-scripts.js";

/**
 * Deterministic authoring of the demo fixtures. The trajectories/ tree is
 * WHOLLY OWNED by this script while every committed fixture is scripted;
 * it wipes and regenerates, and a fixed recordedAt makes regeneration
 * byte-identical. The moment live-record fixtures exist, ownership
 * narrows: this script must stop deleting what it did not author.
 */

const root = fileURLToPath(new URL("../trajectories", import.meta.url));
rmSync(root, { recursive: true, force: true });
const store = new FixtureStore(root);
const adversarialStore = new FixtureStore(join(root, "adversarial"));
for (const { script, note } of demoScripts) {
  const fixture = runScript(script, { recordedAt: RECORDED_AT, note });
  const { path } = store.save(fixture);
  console.log(`authored ${path}`);
}
for (const { script, note } of adversarialScripts) {
  const fixture = runScript(script, { recordedAt: RECORDED_AT, note });
  const { path } = adversarialStore.save(fixture);
  console.log(`authored ${path}`);
}
for (const [version, set] of [
  ["v1", sampledV1],
  ["v2", sampledV2],
] as const) {
  const sampleStore = new FixtureStore(join(root, "samples", version));
  for (const { script, note } of set) {
    const fixture = runScript(script, { recordedAt: RECORDED_AT, note });
    const { path } = sampleStore.save(fixture);
    console.log(`authored ${path}`);
  }
}
