import type { z } from "zod";

/**
 * Deterministic, zod-version-proof issue rendering: paths only, never
 * zod's message text (which may change across upgrades and must never be
 * able to alter recorded results). Unrecognized keys are reported by zod
 * at the object root, so expand them into per-key paths.
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
