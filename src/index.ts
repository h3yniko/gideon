import { Command } from 'commander';
import { github_actions } from './modules/github-actions';

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
    github_actions.scanAction(name)
  })


program.parse();
