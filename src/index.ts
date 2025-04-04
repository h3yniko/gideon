import { Command } from "commander";
import { GitHub } from "./modules/github/index.js";

// Utility function to ensure logs are completed before exit
const ensureLogsComplete = async () => {
  // Adding a small delay allows Node.js to flush stdout
  return new Promise<void>((resolve) => setTimeout(resolve, 100));
};

let program = new Command();

program.name("gideon");

// Set up a hook that runs after any command executes
program.hook("postAction", async () => {
  await ensureLogsComplete();
});

let git = program.command("github");

git
  .command("action")
  .command("scan")
  .option("-n, --name <repo>", "Action name to scan")
  .action(async ({ name }) => {
    if (!name) {
      console.error("Please provide a name for the action.");
      process.exit(1);
    }
    const action = await GitHub.Actions.get(name);
    console.log(JSON.stringify(action, null, 2));
    const report = await GitHub.Actions.scan(action);
    console.log(report.reference);
    console.log(report.vulnerability);
  });

git
  .command("workflow")
  .command("scan")
  .option("-n, --name <repo>", "Workflow name to scan")
  .action(async ({ name }: { name: string }) => {
    if (!name) {
      console.error("Please provide a name for the workflow.");
      process.exit(1);
    }
    const workflow = await GitHub.Workflows.get(name);
    const result = await GitHub.Workflows.scan(workflow);
    console.log(result.reference);
    console.log(result.vulnerability);
  });

git
  .command("repo")
  .command("scan")
  .option("-n, --name <repo>", "Repository name")
  .action(async ({ name }) => {
    if (!name) {
      console.error("Please provide an owner and a name for the repository.");
      process.exit(1);
    }
    const results = GitHub.Repos.scan(name);
    for await (let result of results) {
      console.log(result.reference);
      console.log(result.vulnerability);
    }
  });

program.parse();
