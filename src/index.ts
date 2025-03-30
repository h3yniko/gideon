import { Command } from 'commander';
import { GithubActions } from './modules/github-actions';

let program = new Command();

program
  .name('gideon')

let git = program.command('git')

git.command('scan-action')
  .option('-n, --name <repo>', 'Action name to scan')
  .action(async ({ name }) => {
    if (!name) {
      console.error('Please provide a name for the action.');
      process.exit(1);
    }
    GithubActions.scanAction(name)
  })

git.command('scan-workflow')
  .option('-n, --name <repo>', 'Workflow name to scan')
  .action(async ({ name }) => {
    if (!name) {
      console.error('Please provide a name for the workflow.');
      process.exit(1);
    }
    GithubActions.scanWorkflow(name)
  })

git.command('scan-repo')
  .option('-n, --name <repo>', 'Repository name')
  .action(async ({ name }) => {
    if (!name) {
      console.error('Please provide an owner and a name for the repository.');
      process.exit(1);
    }
    GithubActions.scanRepo(name)
  })

program.parse();
