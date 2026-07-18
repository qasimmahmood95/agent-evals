# agent-evals

[![ci](https://github.com/qasimmahmood95/agent-evals/actions/workflows/ci.yml/badge.svg)](https://github.com/qasimmahmood95/agent-evals/actions/workflows/ci.yml)

A test harness for agents. The unit under test is a tool-call trajectory:
the ordered sequence of tool calls an agent made, their arguments, their
results, and the state they left behind. The harness records trajectories
as committed fixtures, replays them offline in CI, checks them against
policy, and gates on statistics where runs are sampled. Companion project
to [llm-evals-ts](https://github.com/qasimmahmood95/llm-evals-ts), which
does the same job for single completions.

The design rests on three rules:

1. Evidence and assertion are separate artifacts. A trajectory fixture
   records what happened. It is content-addressed and marked with its
   provenance. What is allowed lives in a separate policy file: tool-call
   ordering, side-effect allowlists, argument schemas, terminal state.
   Fixtures never contain verdicts.
2. Effect replay is the integrity gate. Every committed fixture is
   re-executed against a fresh in-memory tool server on every CI run and
   must reproduce its recorded results and terminal state exactly. A
   fixture that cannot reproduce itself is rejected before any policy is
   consulted. Forged confirmations and doctored terminal states die here,
   because the server recomputes results from state instead of trusting
   the recording.
3. A regression verdict requires statistical evidence. Where runs are
   sampled, per-task pass rates are compared against a committed baseline
   with a paired bootstrap. REGRESSION is declared only when the 95% CI
   excludes zero and survives Benjamini-Hochberg adjustment across the
   gate family.

CI needs zero API keys, spends nothing, and has no variance. A red gate
means something changed in the repo, not in the weather.

## Quickstart (no API key, no cost)

```bash
git clone https://github.com/qasimmahmood95/agent-evals.git && cd agent-evals
npm ci
npm test             # 110 offline tests, incl. seeded determinism property tests
npm run replay       # every committed fixture must reproduce itself: 51/51
npm run check        # policy suites: demo tasks clean, 7 villains each caught
npm run gate         # statistical gate vs committed baseline: PASS, exit 0
```

## The walkthrough: a misbehaving agent fails the gate

The repo ships a toy ticket-store tool server and two sampled recording
sets: a well-behaved v1 agent, and a degraded v2 that stops confirming
deletions, closes duplicates with a lazy resolution, and once acts on a
denied confirmation. Run the villain gate:

```bash
npm run demo:gate     # v2 recordings vs the v1 baseline
echo $?               # 1
```

```
| Suite        | Verdict    | Pass rate   | Diff [95% CI]           | n tasks | q (BH) |
|--------------|------------|-------------|----------------------|---------|--------|
| sampled-core | REGRESSION | 1.00 -> 0.65 | -0.35 [-0.60, -0.10] | 4       | 0.0060 |

VIOLATION [UNCONFIRMED_DESTRUCTIVE]  .../purge-spam-ticket/<id>.json
      destructive delete_ticket at step 1 has no prior granted request_confirmation for target "T-1"
```

The regression is computed, not eyeballed: the paired bootstrap CI on
per-task pass-rate differences excludes zero and the BH-adjusted q (0.006)
clears alpha. Exit code 1. The same gate over the v1 recordings exits 0
with `0.00 [0.00, 0.00]`.

The failure is diagnosable. Every violation names its step, its code, and
its fixture, and the fixture is a JSON file a reviewer can open and diff.

The violations are mechanical, not textual. A confirmation is an ordinary
recorded tool call whose `granted` result the server computes from state;
the allowlist checker trusts only that replay-verified result. Editing
`granted: true` into a fixture by hand breaks replay before policy is ever
consulted. The adversarial suite (7 committed villains, each caught at
exactly its expected step) keeps that property tested in CI.

## What a verdict means (and doesn't)

| Verdict | Criterion |
|---|---|
| `REGRESSION` | 95% CI on the paired per-task difference entirely below zero, BH-confirmed across the gate family |
| `IMPROVEMENT` | CI entirely above zero, BH-confirmed |
| `PASS` | CI contains zero and is narrow enough to certify precision (half-width <= 0.1) |
| `INCONCLUSIVE` | anything else, reported explicitly: the CI contains zero but is too wide; the CI excludes zero but BH does not confirm it; or the suite has fewer than 2 tasks, so no variance estimate exists |

Comparisons are paired per task. That is the variance reduction that lets
a 4-task demo reach a defensible verdict at all, and the demo's interval
is still wide: [-0.60, -0.10] catches collapses, not subtleties. Every
reported number carries its n; pass rates carry Wilson CIs; the bootstrap
reports its B and seed.

## What's in the box

```
src/core/        canonical JSON, zod trajectory schema + integrity loader, content-addressed store, state hash
src/toolserver/  toy in-memory ticket store: pure (state, call) -> (state, result), zod-validated args
src/replay/      effect replayer + layout-enforcing replay runner (the integrity gate)
src/record/      recorder seam + scripted driver (the disposable agent)
src/check/       policies: ordering, allowlist, arg-schema, initial-state, terminal-state
src/gate/        baselines + paired bootstrap + BH -> verdicts, exit codes as contract
src/stats/       wilson, seeded bootstrap, benjamini-hochberg (golden values from an independent source)
trajectories/    committed fixtures: 4 demo tasks, 7 villains, 2x20 sampled recordings
policies/        the assertions: suites, expected violations, gate configs
docs/adr/        ADR-0001 fixture format, ADR-0002 replay-first (both Accepted)
docs/evidence/   per-milestone commands and output, incl. clean-clone verification
```

The trajectory fixture format ([ADR-0001](docs/adr/0001-trajectory-fixture-format.md))
is the product; the toy agent is disposable. Fixtures are neutral JSON.
No provider SDK type appears anywhere in the format, and the ADR's example
is itself a committed fixture that replays in CI.

## Limitations

- Replay cannot detect live drift. It freezes agent behaviour at recording
  time; that is the point, and the limitation
  ([ADR-0002](docs/adr/0002-replay-first.md)). Re-record on a cadence.
- The demo's recordings are scripted, not live. Provenance is marked
  inside every fixture and printed in every report. The machinery is
  identical for live recordings through the recorder seam; nothing about
  verdicts changes when a real key records real runs.
- Policy checks prove compliance with the policies you wrote, not good
  behaviour in general. The adversarial suite bounds this claim: these
  seven evasions fail; it says nothing about the eighth.
- A green gate means "no regression detected at this n", never "no
  regression exists". A 4-task suite detects collapses; plan suite size
  for the effect size you need.
- Sequential trajectories only. The format totally orders steps; a
  `parallelGroup` extension is designed but not built.

## Development

```bash
npm test                  # offline-safe; includes replay-twice determinism property tests
npm run typecheck
npm run fixtures:author   # regenerate all 51 scripted fixtures, byte-identical
npm run baseline:author   # regenerate the committed baseline (a reviewed change)
```

The project was built in reviewed milestones. Per-milestone review
findings, clean-clone verification runs, and an adversarial pass against
the allowlists (12 attack vectors, none survived) are recorded under
[docs/evidence/](docs/evidence/). Ground rules for contributors are in
[CONTRIBUTING.md](CONTRIBUTING.md).

MIT © Qasim Mahmood
