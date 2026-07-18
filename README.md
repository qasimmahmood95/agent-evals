# agent-evals

Deterministic, replayable, CI-safe testing for **agent trajectories** — the
sibling of [llm-evals-ts](https://github.com/qasimmahmood95/llm-evals-ts),
one level up the stack. Testing an agent is not testing a completion: the
unit under test is a tool-call trajectory with side effects, and it deserves
the same discipline — committed fixtures, offline replay, zero-key CI, and
statistical verdicts where live runs are sampled.

**Status: M3.** The determinism spine, offline effect replay, and the
policy layer are in. Committed fixtures reproduce themselves in CI from a
clean clone (`npm run replay`); trajectory policies — ordering, side-effect
allowlists (no destruction without a prior granted confirmation), argument
schemas, terminal state — run as suites (`npm run check`), with seven
committed villain trajectories that replay clean and must each be caught by
exactly its expected violation. The statistical gate (M4) is next. Start
here:

- [docs/PLAN.md](docs/PLAN.md) — milestone plan and definitions of done
- [ADR-0001](docs/adr/0001-trajectory-fixture-format.md) — the trajectory
  fixture format (Proposed)
- [ADR-0002](docs/adr/0002-replay-first.md) — replay-first over live-first
  (Proposed)
- [CLAUDE.md](CLAUDE.md) — ground rules and conventions

The full README — quickstart, walkthrough, honest-limitations section — is
written last, at M4, when every claim in it is demonstrable from a clean
clone.

MIT © Qasim Mahmood
