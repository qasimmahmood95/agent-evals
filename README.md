# agent-evals

Deterministic, replayable, CI-safe testing for **agent trajectories** — the
sibling of [llm-evals-ts](https://github.com/qasimmahmood95/llm-evals-ts),
one level up the stack. Testing an agent is not testing a completion: the
unit under test is a tool-call trajectory with side effects, and it deserves
the same discipline — committed fixtures, offline replay, zero-key CI, and
statistical verdicts where live runs are sampled.

**Status: M2.** The determinism spine, recorder, and offline effect replay
are in: committed trajectory fixtures under `trajectories/` reproduce
themselves in CI from a clean clone (`npm run replay`), with the ADR-0001
example itself committed as a replaying fixture. Policy checks (M3) and the
statistical gate (M4) are next. Start here:

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
