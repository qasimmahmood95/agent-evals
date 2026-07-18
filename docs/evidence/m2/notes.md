# M2 evidence — record and replay

Commands run at the M2 commit, from the repo root:

```
$ npm run typecheck

> agent-evals@0.1.0 typecheck
> tsc --noEmit


$ npm test
> vitest run
 RUN  v4.1.10 /home/user/agent-evals
 Test Files  9 passed (9)
      Tests  56 passed (56)
   Start at  12:44:56
   Duration  811ms (transform 299ms, setup 0ms, import 843ms, tests 209ms, environment 1ms)

$ npm run fixtures:author
authored /home/user/agent-evals/trajectories/close-duplicate-tickets/1f58ff465b9bca4e385ae2e1647d45e5931650193859a7c1cea21ddfd524105c.json
authored /home/user/agent-evals/trajectories/purge-spam-ticket/91472fa314662f56be5eaddb96e654384da9fb2864946fe6d3c911b333dd9d2d.json
authored /home/user/agent-evals/trajectories/respect-denied-confirmation/f5969f40692ebfea3038670bef659f8fa4d46efdd53d5410f091dc153844e9b0.json
authored /home/user/agent-evals/trajectories/recover-from-missing-ticket/748f6b129c55ad3bbaf5c166d9e735ad5089b31e11dc1b087f48f672a4b96dfd.json

$ npm run replay
ok    close-duplicate-tickets/1f58ff465b9bca4e385ae2e1647d45e5931650193859a7c1cea21ddfd524105c.json  (scripted, 2 calls)
ok    purge-spam-ticket/91472fa314662f56be5eaddb96e654384da9fb2864946fe6d3c911b333dd9d2d.json  (scripted, 3 calls)
ok    recover-from-missing-ticket/748f6b129c55ad3bbaf5c166d9e735ad5089b31e11dc1b087f48f672a4b96dfd.json  (scripted, 3 calls)
ok    respect-denied-confirmation/f5969f40692ebfea3038670bef659f8fa4d46efdd53d5410f091dc153844e9b0.json  (scripted, 1 calls)
replay: 4/4 fixtures reproduce themselves
```

Regeneration determinism: `npm run fixtures:author` run twice produces byte-identical files (sha256sum over all fixture files compared clean between runs).

The committed `close-duplicate-tickets` fixture is the ADR-0001 example: same id (`1f58ff46…`), content-equal with identical id — enforced by `src/record/script-driver.test.ts` (deep equality; on-disk bytes differ only in JSON line wrapping).
