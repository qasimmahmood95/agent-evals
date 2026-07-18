# ADR-0002: Replay-first, not live-first

- **Status:** Proposed — awaiting maintainer review (see docs/PLAN.md, M0).
- **Date:** 2026-07-18

## Context

Agent testing frameworks are overwhelmingly live-first: every CI run drives
a real model against real (or realistic) tools, and the trajectory is a
transient by-product inspected once and discarded. That default has three
costs, all familiar from llm-evals-ts:

1. **Money and keys in CI.** A live agent run is strictly more expensive
   than a live completion — one case is many model calls. Keyed, metered CI
   is the first thing a team disables.
2. **Variance.** A live agent can take a different tool path on every run.
   A gate that flakes on model stochasticity trains people to re-run until
   green, which is the opposite of a gate.
3. **Unreviewable evidence.** A transient trajectory can't be diffed,
   bisected, or cited in a PR discussion. When a check fails you have a log
   line, not an artifact.

The alternative risk is real too: replay freezes agent behaviour at
recording time, so replay alone can never detect that the live model has
drifted. Any replay-first design owes an answer to "then what are you
actually testing?"

## Decision

Replay is the primary mode; live execution is a **sampling activity**, not
a gate.

- **CI runs replay only.** The gate consumes committed trajectory fixtures
  (ADR-0001): effect replay proves each fixture internally consistent and
  the tool server deterministic, then policy checks (ordering, allowlists,
  argument schemas, terminal state) assert on the recorded behaviour. Zero
  keys, zero cost, zero variance — a red gate always means something
  changed in the repo, never in the weather.
- **Live runs happen deliberately, off the gate path**, with a key, on a
  cadence or before a release: k sampled runs per task are recorded as k
  distinct committed fixtures. The statistical layer (M4) turns those
  samples into verdicts under llm-evals-ts rules — pass rates with n and
  CI, `REGRESSION` only when the paired-bootstrap interval excludes zero.
  Model stochasticity is confronted where it belongs: at recording time,
  with enough samples to say something defensible, rather than one run at a
  time in CI where it can only flake.

What each layer owns:

| Question | Owner |
|---|---|
| "Does the harness correctly verify trajectories?" | replay gate (every CI run) |
| "Do committed trajectories satisfy policy?" | policy checks (every CI run) |
| "Has the live agent's behaviour regressed?" | sampled recordings + statistical verdict (deliberate, keyed) |
| "Has the live model drifted since recording?" | re-record on a cadence and compare — never claimed by replay |

## Consequences

- **The gate's meaning is narrow and honest.** Green means: committed
  evidence is internally consistent and policy-clean at this n. It never
  means the live agent is currently well-behaved; the README must say so as
  bluntly as llm-evals-ts does.
- **Fixtures are the review surface.** A change in agent behaviour arrives
  in a PR as a diffable trajectory — reviewers see the new tool path, not a
  CI log. This is the property that makes agent changes reviewable at all.
- **Recording discipline is a real cost.** Fixtures go stale; the cadence
  and ownership of re-recording is process, not code, and the repo can only
  document it (and date-stamp `meta.recordedAt`), not enforce it.
- **The demo ships scripted fixtures** (`provenance: "scripted"`) so a
  clean clone works with no key ever. Provenance marking keeps this honest:
  reports disclose that demo trajectories are scripted, and nothing about
  the machinery changes when a real key records `live-record` fixtures.

## Alternatives considered

- **Live-first with retries/caching**: caching a live gate is replay with
  extra steps and worse provenance; retries institutionalize flakiness.
- **Hybrid gate (replay + one live smoke run)**: reintroduces keys, cost,
  and variance into every CI run for one sample of statistical value ~0 —
  a verdict at n=1 is exactly the vibes-based signoff this project exists
  to reject.
- **Simulation-first (mock model, live tools)**: a mocked model exercises
  the harness but generates no evidence about any real agent; it is our
  scripted driver, correctly labelled, and it cannot be the whole story.
