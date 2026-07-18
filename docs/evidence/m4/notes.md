# M4 evidence — statistical layer and gate

Commands run at the M4 commit, from the repo root:

```
$ npm run typecheck

> agent-evals@0.1.0 typecheck
> tsc --noEmit


$ npm test
 RUN  v4.1.10 /home/user/agent-evals
 Test Files  15 passed (15)
      Tests  108 passed (108)
   Start at  13:07:30
   Duration  1.58s (transform 644ms, setup 0ms, import 1.68s, tests 535ms, environment 1ms)

$ npm run replay
replay: 51/51 fixtures reproduce themselves

$ npm run check
suite demo-core: PASS — no violations
suite adversarial: PASS — all 7 expected violation(s) found, nothing else

$ npm run gate ; echo exit=$?
| Suite | Verdict | Pass rate | Δ [95% CI] | n tasks | q (BH) |
|---|---|---|---|---|---|
| sampled-core | PASS | 1.00 → 1.00 | 0.00 [0.00, 0.00] | 4 | 1.0000 |
gate: no regression detected at this n
exit=0

$ npm run demo:gate ; echo exit=$?
| Suite | Verdict | Pass rate | Δ [95% CI] | n tasks | q (BH) |
|---|---|---|---|---|---|
| sampled-core | REGRESSION | 1.00 → 0.65 | -0.35 [-0.60, -0.10] | 4 | 0.0060 |
gate: REGRESSION — gate failed
exit=1
```

Golden values for wilson and benjamini-hochberg were computed with an independent Python implementation before the TypeScript ones were written:

```
wilson(8,10) = (0.49016247153664183, 0.9433178485456247)
bh([0.01,0.04,0.03,0.005,0.2]) = [0.025, 0.05, 0.049999999999999996, 0.025, 0.2]
```

The bootstrap is seeded (mulberry32; B and seed reported in every gate row) — its correctness rests on property tests (degenerate cases exact, CI within data range, narrows with n, reproducible per seed), since PRNG-dependent output has no independent golden source.

## Clean-clone verification (M4 verification subagent)

Run against commit 631b32b from `git clone` into a scratch directory.
`npm ci` was the only networked step; every subsequent command ran with
proxy variables cleared inside `unshare -n` (detached network namespace;
isolation positively proven — an in-namespace fetch to registry.npmjs.org
fails with EAI_AGAIN).

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | clean |
| `npm test` | 0 | 15 files, 108/108 tests |
| `npm run replay` | 0 | 51/51 fixtures reproduce themselves |
| `npm run check` | 0 | demo-core PASS; adversarial: all 7 expected, nothing else |
| `npm run gate` | 0 | PASS, 1.00 → 1.00, 0.00 [0.00, 0.00] |
| `npm run demo:gate` | 1 | REGRESSION, 1.00 → 0.65, -0.35 [-0.60, -0.10], q=0.0060 |

Probes: two demo:gate runs byte-identical; `fixtures:author` +
`baseline:author` leave `git status --porcelain` empty; lowering one
task's baseline passes flips the gate to INCONCLUSIVE 0.20 [0.00, 0.60]
(not a false IMPROVEMENT — the CI touches zero); fixture accounting
matches (4 demo + 7 adversarial + 20 v1 + 20 v2 = 51, occurrence-suffixed
files counted individually); zero vendor/SDK tokens in any fixture;
timestamps only in unhashed meta. Verdict: VERIFIED, no discrepancies.
