# Contributing

Setup is the quickstart: `npm ci`, then `npm test` and `npm run typecheck`
must both be green before any commit.

## Ground rules

These are enforced in review, not suggestions.

1. **Evidence and assertion are separate artifacts.** A trajectory fixture
   records what happened; a policy file declares what is allowed. Fixtures
   never embed expected verdicts. A negative fixture is only "negative"
   because a suite says so.
2. **Effect replay is the integrity gate.** Every committed fixture must
   replay from its recorded initial state to its recorded terminal state,
   offline. Hand-authored fixtures get no exemption: if the tool server
   can't reproduce your recorded results, the fixture is invalid.
3. **Determinism is the spine.** The tool server is a pure function of
   (state, call). No wall-clock, no randomness, no ambient I/O inside
   recorded semantics. Timestamps live only in unhashed `meta`.
4. **Provenance is marked and disclosed.** Every fixture says whether it
   was `live-record`, `scripted`, or `hand-authored`, and reports repeat
   it.
5. **Statistics honesty (same bar as llm-evals-ts).** Every aggregate
   carries its n and CI. Undefined quantities return `undefined`, never a
   fake zero. New statistical functions need golden values from an
   independent source plus property tests.
6. **Skipped is never a pass.** A check that cannot run says so loudly.

## Scope limits

- No real external services. The only side-effect target is the toy
  in-memory tool server in this repo. Any code path that could touch a
  network service in CI will be rejected.
- No vendor lock. The trajectory format is neutral JSON; nothing in a
  fixture names a provider SDK type. Recording adapters are a seam, not a
  dependency.
- This is not an agent framework. The repo builds the testing of one. The
  toy agent exists to generate trajectories and can be deleted without
  loss.

## Conventions

- TypeScript strict, ESM, NodeNext resolution, `noUncheckedIndexedAccess`.
  Node >= 20. vitest; tests are offline-safe.
- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`,
  `refactor:`).
- ADRs in `docs/adr/` for design decisions that constrain later work. New
  ADRs are `Proposed` until accepted.
- Evidence: substantial milestones capture the commands run and their
  output under `docs/evidence/`.

## Review gates

Each milestone goes through three passes before it lands, with results
recorded under `docs/evidence/`:

- an independent code review of the diff, checked against the ground
  rules above;
- a clean-clone verification: fresh clone, dependencies installed, then
  typecheck, tests, replay, and the suites run with networking disabled,
  proving the determinism claim from scratch;
- an adversarial pass (once policies exist) that tries to author
  trajectories violating each side-effect rule and confirms the harness
  rejects every one. A surviving violation blocks release.

## Commands

```bash
npm test              # offline-safe unit + property tests
npm run typecheck     # tsc --noEmit
npm run replay        # effect-replay every committed fixture (exit 0/1/2)
npm run check         # policy suites: demo-core clean + adversarial catches all villains
npm run gate          # statistical gate vs committed baseline (exit 0)
npm run demo:gate     # the villain gate. REGRESSION, exit 1, on purpose
npm run fixtures:author  # regenerate all scripted fixtures (byte-identical)
npm run baseline:author  # regenerate the committed baseline (a reviewed change)
```
