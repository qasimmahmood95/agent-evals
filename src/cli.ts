import { Command } from "commander";
import { runCheck } from "./check/suite.js";
import { runReplay } from "./replay/run.js";

const program = new Command();

program.name("agent-evals").description("deterministic, replayable testing for agent tool-call trajectories");

program
  .command("replay [dir]")
  .description("effect-replay every committed trajectory fixture; exit 0 only if all reproduce themselves")
  .action((dir?: string) => {
    const { exitCode, lines } = runReplay(dir ?? "trajectories");
    for (const line of lines) console.log(line);
    process.exitCode = exitCode;
  });

program
  .command("check <suites...>")
  .description("run policy suites over committed fixtures; exit 0 only if findings match expectations exactly")
  .action((suites: string[]) => {
    let worst = 0;
    for (const suitePath of suites) {
      const { exitCode, lines } = runCheck(suitePath);
      for (const line of lines) console.log(line);
      worst = Math.max(worst, exitCode);
    }
    process.exitCode = worst;
  });

program.parse();
