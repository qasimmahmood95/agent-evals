# Milestone plan — agent-evals

Sibling repo to [llm-evals-ts](https://github.com/qasimmahmood95/llm-evals-ts),
same bar: deterministic, key-free, cost-free CI; statistics honesty; scope
discipline. Each milestone ends in a PR gated by the subagent workflow in
[CLAUDE.md](../CLAUDE.md). Definitions of done are testable, not aspirational.

The one-sentence thesis: **the unit under test is a tool-call trajectory with
side effects**, so the harness records trajectories as committed fixtures,
replays them offline as an integrity gate, and asserts on trajectory
properties — ordering, side-effect allowlists, argument schemas, terminal
state — with a statistical layer for sampled live runs.

## M0 — Charter and design review (this deliverable)

CLAUDE.md, this plan, and two Proposed ADRs:
[ADR-0001 trajectory fixture format](adr/0001-trajectory-fixture-format.md),
[ADR-0002 replay-first over live-first](adr/0002-replay-first.md).

**DoD:** maintainer has reviewed and accepted (or amended) both ADRs.
Implementation does not start until the fixture schema is signed off — the
format is the product; churning it later invalidates committed fixtures.

## M1 — Determinism spine: format, store, toy tool server

- `src/core/`: canonical JSON (sorted keys, stable serialization — the
  llm-evals-ts approach, re-derived with its own tests); zod schema for the
  trajectory fixture format per ADR-0001, so a malformed fixture fails at
  load with a field-level message; content-addressed fixture store with
  occurrence sequencing (`<hash>.json`, `<hash>.1.json`, …) — k sampled runs
  of one task are k genuinely distinct recordings, inspectable on disk;
  state hashing.
- `src/toolserver/`: the toy side-effect target — an in-memory **ticket
  store** (`create_ticket`, `get_ticket`, `list_tickets`, `update_ticket`,
  `close_ticket`, `request_confirmation`, `delete_ticket`,
  `bulk_close`). Every tool owns a zod argument schema. Semantics are a pure
  function of (state, call): no clock, no randomness, deterministic IDs.
  Deliberate design point: the server itself does **not** enforce the
  confirmation protocol — destructive calls succeed unconditionally, so that
  catching them is the harness's job, not the toy's.
- Scaffolding: strict-ESM tsconfig, vitest, CI workflow (typecheck + test,
  no secrets).

**DoD:** `npm test` green offline; property test that any interleaving of
tool calls replayed twice from the same state yields identical states;
fixture schema round-trips the ADR-0001 example verbatim.
**Gate:** code-review subagent on the PR diff.

## M2 — Record and replay

- `src/record/`: a recorder that wraps the tool server and emits ADR-0001
  fixtures; a **scripted driver** (the disposable agent) that executes
  declarative tool-call scripts to author demo fixtures deterministically
  (`provenance: "scripted"`); a live-recording seam behind a
  `ModelAdapter`-style interface for real agents (`provenance:
  "live-record"`), never exercised in CI.
- `src/replay/`: the effect replayer — load fixture, hydrate a fresh server
  from `initialState`, re-execute every step, require bit-identical results
  and terminal `stateHash`. Any divergence is a hard error naming the first
  divergent step. Replay misses are never silent.
- CLI: `agent-evals replay [dir]` replays all committed fixtures; exit 0
  only if every fixture reproduces itself.
- First committed demo trajectories under `trajectories/`.

**DoD:** `agent-evals replay trajectories/` exits 0 from a clean clone,
offline; a deliberately corrupted fixture (edited result, edited terminal
state, reordered steps) fails with the divergent step named — all three
cases are unit-tested.
**Gates:** code-review subagent; **verification subagent** — clean clone, no
network, replay all fixtures, confirm determinism from scratch.

## M3 — Trajectory assertions (the point of the repo)

- `src/check/` policies, each a small pure checker over a fixture:
  - **Ordering** — required precedence relations ("`get_ticket` before
    `update_ticket` on the same id", "confirmation before destruction").
  - **Side-effect allowlist** — destructive tools (`delete_ticket`,
    `bulk_close`) require a prior `request_confirmation` step whose
    arguments cover the destructive call's target and whose result granted;
    everything not allowlisted for the task is a violation.
  - **Argument schema validity** — every recorded call re-validated against
    its tool's zod schema (catches trajectories recorded before a schema
    tightened).
  - **Terminal state** — declarative assertions over the terminal snapshot
    (counts, existence, field values).
- `policies/` file format (zod-validated, like llm-evals-ts suite loading):
  a suite binds task fixtures to policies and — for negative suites — to
  expected violation codes. Expectations live in the suite, never in the
  fixture (ground rule 1).
- CLI: `agent-evals check <suite>`; exit codes as contract: 0 pass,
  1 violations, 2 configuration error.
- Negative fixtures: hand-authored violating trajectories (which must still
  pass effect replay — violations are policy-level, not physics-level)
  under `trajectories/adversarial/`.

**DoD:** every policy type has happy, violation, and config-error tests; the
demo suite passes; the adversarial suite reports exactly its expected
violations.
**Gates:** code-review subagent; **adversarial subagent** — independently
attempts one violating trajectory per allowlist rule and confirms the
harness rejects each; any accepted violation is a release blocker and gets
committed as a regression test once fixed.

## M4 — Statistical layer and CI gate

- Where live runs are sampled (k recordings per task, occurrence-sequenced),
  per-task pass rates over policy checks are compared against a committed
  baseline with the llm-evals-ts verdict rules: paired-per-task seeded
  bootstrap; `REGRESSION` only when the 95% CI on the difference excludes
  zero; `INCONCLUSIVE` when the CI contains zero but is too wide — small
  samples say so out loud. Stats functions re-derived with golden values
  and property tests (`src/stats/`), not copy-pasted.
- `agent-evals gate`: replay-mode gate over committed fixtures + baselines;
  Markdown summary for the CI job; machine-readable result artifact.
- CI workflows finalized: no keys, no cost, no variance.
- README written last, walkthrough style: a good agent passes; a shipped
  "villain" trajectory (destructive call without confirmation) fails the
  gate with the violating step named.

**DoD:** gate exits 0 on the demo suite and 1 on the villain from a clean
clone; every reported number carries its n and CI.
**Gates:** code-review subagent; verification subagent re-run (full clean
clone, offline, all fixtures + gate).

## Non-goals, deliberately

No agent framework or orchestration. No real external services (no live MCP
transport — the tool server is MCP-*shaped*: named tools + JSON-schema
arguments + structured results). No vendor SDK types in the fixture format.
No UI. No metric zoo. npm publishing is a designed-for stretch, not a
commitment.

## Risks

- **Schema churn after fixtures are committed** — mitigated by M0 sign-off
  and `formatVersion` in every fixture; a breaking change requires a
  migration script for committed fixtures in the same PR.
- **Toy-server nondeterminism leaking in** (ID generation, iteration order)
  — mitigated by the M1 property test and the M2 verification subagent.
- **Policy checks drifting into agent-framework territory** — the checkers
  take a fixture and return findings; they never drive an agent. Review
  gate: anything in `src/check/` that imports from `src/record/` is wrong.
