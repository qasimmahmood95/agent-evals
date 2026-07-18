import type { z } from "zod";

/**
 * Deterministic, zod-version-proof issue rendering: paths only, never
 * zod's message text (which may change across upgrades and must never be
 * able to alter recorded results). Unrecognized keys are reported by zod
 * at the object root, so expand them into per-key paths.
 *
 * Residual coupling, accepted: the issue-code string "unrecognized_keys"
 * is zod API. A zod major that renames it would change recorded
 * INVALID_ARGS messages and invalidate affected fixtures — treat a zod
 * major bump as a fixture-impacting change and re-run replay before
 * trusting it.
 */
export function issuePaths(issues: readonly z.core.$ZodIssue[]): string[] {
  return [
    ...new Set(
      issues.flatMap((i) =>
        i.code === "unrecognized_keys"
          ? i.keys.map((k) => [...i.path, k].join("."))
          : [i.path.join(".") || "$"],
      ),
    ),
  ].sort();
}
