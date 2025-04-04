import { globby, path } from "zx";
import { Workflows } from "./workflows";
import { Git } from "../git";
import { Types } from "./types";

export namespace Repos {
  export async function scan(repoPath: string): Promise<Types.ScanResponse[]> {
    let match = repoPath.match(/^(?<owner>[^/]+)\/(?<repoName>[^@]+)$/);
    if (!match) {
      throw new Error('Invalid repository name. Please use the format "owner/repo[@ref]"');
    }

    const owner = match.groups?.owner!;
    const repoName = match.groups?.repoName!;

    let repo = await Git.clone({
      owner: owner,
      name: repoName,
    });

    const workflowFiles = await globby(`${repo.path}/.github/workflows/*.{yml,yaml}`);

    if (workflowFiles.length === 0) {
      console.log(`No workflow files found in ${owner}/${repoName}`);
      return [];
    }

    let results: Types.ScanResponse[] = [];
    for (let workflowFile of workflowFiles) {
      const relativePath = path.relative(repo.path, workflowFile);
      const workflowPath = `${owner}/${repoName}/${relativePath}`;
      console.log(`Scanning workflow: ${workflowPath}`);
      results.push(await Workflows.scan(workflowPath));
    }

    return results;
  }
}