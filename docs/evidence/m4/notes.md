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
