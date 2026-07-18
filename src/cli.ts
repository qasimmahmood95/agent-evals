import { Command } from "commander";
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

program.parse();
