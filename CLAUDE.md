# CLAUDE.md — agent-evals

## What this repo is

A TypeScript harness for testing **agents**, built on one thesis: testing an
agent is not testing a completion. The unit under test is a **tool-call
trajectory with side effects** — an ordered sequence of tool invocations,
their arguments, their results, and the state they leave behind — and it
deserves the same deterministic, replayable, CI-safe verification that
[llm-evals-ts](https://github.com/qasimmahmood95/llm-evals-ts) gives single
completions.

The trajectory fixture format is the product. The toy agent is disposable.

What the harness does:

1. **Records** agent trajectories (tool calls, arguments, results, terminal
   state) as committed, content-addressed fixtures.
2. **Replays** them in CI with zero API keys and zero cost — effect-replay
   re-executes every recorded tool call against a fresh in-memory tool server
   and requires results and terminal state equal under canonical JSON, so a
   fixture that cannot reproduce itself is rejected, not trusted.
3. **Asserts** trajectory properties: required tool-call ordering,
   side-effect allowlists (a destructive tool never fires without a prior
   confirmation step), per-tool argument schema validity, and terminal-state
   assertions.
4. **Judges statistically** where live runs are sampled: verdicts follow
   llm-evals-ts rules — `REGRESSION` requires a confidence interval that
   excludes zero *and* survives multiplicity adjustment across the suite
   family. No vibes.

## Hard limits (scope discipline)

- **No real external services.** The only side-effect target is the toy
  in-memory tool server in this repo. Any code path that could touch a
  network service in CI will be rejected.
- **No vendor lock.** The trajectory format is neutral JSON; nothing in a
  fixture names a provider SDK type. Recording adapters are a seam, not a
  dependency.
- **This is not an agent framework.** We build the *testing* of one. The toy
  agent exists to generate trajectories and may be deleted without loss; no
  orchestration features, no planner, no memory, no UI.
- **No keys, no cost, no variance in CI** — the same bar as llm-evals-ts.

## Ground rules (load-bearing, not stylistic)

1. **Evidence and assertion are separate artifacts.** A trajectory fixture
   records what happened; a policy file declares what is allowed. Fixtures
   never embed expected verdicts — a negative fixture is only "negative"
   because a suite says so.
2. **Effect replay is the integrity gate.** Every committed fixture must
   replay from its recorded initial state to its recorded terminal state,
   deterministically, offline. Hand-authored fixtures are permitted but get
   no exemption: if the tool server can't reproduce your recorded results,
   the fixture is invalid.
3. **Determinism is the spine.** The tool server is a pure function of
   (state, call). No wall-clock, no randomness, no ambient I/O inside
   recorded semantics. Timestamps live only in unhashed `meta`.
4. **Provenance is marked and disclosed.** Every fixture says whether it was
   `live-record`, `scripted`, or `hand-authored`; reports repeat it.
5. **Statistics honesty (inherited from llm-evals-ts).** Every aggregate
   carries its n and CI; undefined quantities return `undefined`, never a
   fake zero; new statistical functions need golden values from an
   independent source plus property tests.
6. **Skipped is never a pass.** A check that cannot run says so loudly.

## Conventions

- TypeScript strict, ESM (`"type": "module"`, NodeNext resolution,
  `noUncheckedIndexedAccess`). Node >= 20.
- vitest; tests are offline-safe. `npm test` and `npm run typecheck` must be
  green before any commit.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`,
  `refactor:`).
- **ADRs** in `docs/adr/` for every load-bearing design decision. Required
  at minimum: the trajectory fixture format (ADR-0001) and replay-first over
  live-first (ADR-0002). New ADRs are `Proposed` until the maintainer
  accepts them.
- Evidence discipline: substantial milestones capture the commands run and
  their output under `docs/evidence/`.

## Layout (planned; sections land per docs/PLAN.md)

```
src/core/        canonical JSON · trajectory schema (zod) · fixture store · state hash
src/toolserver/  toy in-memory ticket store: tool definitions + argument schemas
src/replay/      effect replayer + determinism/integrity checks
src/record/      recorder seam + scripted driver (the disposable agent)
src/check/       trajectory policies: ordering · allowlist · arg-schema · terminal-state
src/stats/       wilson · seeded bootstrap · benjamini-hochberg (llm-evals-ts discipline, re-derived)
src/report/      CLI tables · gate summary
trajectories/    committed fixtures, content-addressed per task
policies/        policy files per suite (the assertions)
docs/adr/        architecture decision records
docs/evidence/   per-milestone evidence
```

## Subagent workflow (mandatory gates)

- **Code-review subagent** before each milestone PR: reviews the diff for
  correctness and for violations of the ground rules above.
- **Verification subagent** (every milestone that commits or touches
  fixtures — M2, M3, M4): from a clean clone with no network access, replays
  every committed trajectory fixture and confirms each reproduces itself
  (results and terminal state equal under canonical JSON) — the determinism
  claim is proven, not asserted.
- **Adversarial subagent** (once policies exist): attempts to author a
  trajectory violating each side-effect allowlist and confirms the harness
  rejects every one. Surviving violations are release blockers.

## Commands

None yet — the repo is at M0 (design review; docs only). `npm test` and
`npm run typecheck` land with the M1 scaffolding; `replay`, `check`, and
`gate` land with their milestones. Commands are added here when they exist —
this file never advertises a command that doesn't run.
