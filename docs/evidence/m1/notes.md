# M1 evidence — determinism spine

Commands run at the M1 commit (after code-review-subagent fixes), from the repo root:

```
$ npm run typecheck

> agent-evals@0.1.0 typecheck
> tsc --noEmit


$ npm test
> agent-evals@0.1.0 test
> vitest run
 RUN  v4.1.10 /home/user/agent-evals
 Test Files  6 passed (6)
      Tests  42 passed (42)
   Start at  12:38:58
   Duration  576ms (transform 234ms, setup 0ms, import 572ms, tests 119ms, environment 1ms)
```

Golden sha256 values in `src/core/hash.test.ts` were cross-checked against two independent implementations (node:crypto and GNU coreutils sha256sum):

```
$ printf '{"a":1}' | sha256sum
015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862  -
```

Code-review subagent findings on the M1 diff (all fixed in the follow-up commit): path-traversal via unvalidated task.id on the fixture-store write path; list ordering depending on fixture key insertion order for ids outside T-<n>; a vacuous input-mutation test that only exercised validation-error paths; check-then-write occurrence claiming (now atomic via exclusive create); silent clobber on hand-authored nextId collision (now a deterministic ID_EXISTS error); canonicalJson silently serializing non-plain objects as {} (now throws).
