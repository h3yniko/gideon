import { globby, path } from "zx";
import { Workflows } from "./workflows.js";
import { Git } from "../git/index.js";
import { Types } from "./types.js";

export namespace Repos {
  export async function* scan(
    repoPath: string,
  ): AsyncGenerator<Types.ScanResponse> {
    let match = repoPath.match(
      /^(?<repoOwner>[^/]+)\/(?<repoName>[^@]+)(@(?<gitRef>.+))?$/,
    );
    if (!match) {
      throw new Error(
        'Invalid repository name. Please use the format "owner/repo[@ref]"',
      );
    }

    const repoOwner = match.groups?.repoOwner!;
    const repoName = match.groups?.repoName!;
    const gitRef = match.groups?.gitRef;

    let repo = await Git.clone({
      source: `https://github.com/${repoOwner}/${repoName}.git`,
      folder: gitRef
        ? `${repoOwner}/${repoName}@${gitRef}`
        : `${repoOwner}/${repoName}`,
      gitRef,
    });

    const workflowFiles = await globby(
      `${repo.path}/.github/workflows/*.{yml,yaml}`,
    );

    if (workflowFiles.length === 0) {
      console.log(`No workflow files found in ${repoOwner}/${repoName}`);
      return;
    }

    for (let workflowFile of workflowFiles) {
      const relativePath = path.relative(repo.path, workflowFile);
      const workflowReference = `${repoOwner}/${repoName}/${relativePath}`;
      const workflow = await Workflows.get(workflowReference);
      const result = await Workflows.scan(workflow);
      yield result;
    }
  }
}
