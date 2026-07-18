# M1 evidence — determinism spine

Commands run at the M1 commit, from the repo root:

```
$ npm run typecheck

> agent-evals@0.1.0 typecheck
> tsc --noEmit


$ npm test
> agent-evals@0.1.0 test
> vitest run
 RUN  v4.1.10 /home/user/agent-evals
 Test Files  6 passed (6)
      Tests  35 passed (35)
   Start at  12:29:54
   Duration  629ms (transform 287ms, setup 0ms, import 612ms, tests 130ms, environment 1ms)
```

Golden sha256 values in `src/core/hash.test.ts` were cross-checked against two independent implementations (node:crypto and GNU coreutils sha256sum):

```
$ printf '{"a":1}' | sha256sum
015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862  -
```
