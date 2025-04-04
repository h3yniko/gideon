import { fs, path, YAML } from "zx";
import { Git } from "../git/index.js";
import { Types } from "./types.js";
import { Actions } from "./actions.js";
import { OpenRouter } from "../openrouter.js";
import { prompt } from "./const.js";

export namespace Workflows {
  export async function get(reference: string): Promise<Types.GithubWorkflow> {
    console.log("Getting workflow", reference);
    // octo-org/example-repo/.github/workflows/reusable-workflow.yml@main
    let match = reference.match(
      /^(?<repoOwner>[^/]+)\/(?<repoName>[^/@]+)(?<workflowPath>\/[^@]+)(?:@(?<gitRef>.+))?$/,
    );
    if (!match) {
      throw new Error(
        `Workflow name ${reference} is invalid, please use the format "owner/repo[/workflow][@ref]"`,
      );
    }

    let repoOwner = match.groups?.repoOwner!;
    let repoName = match.groups?.repoName!;
    let gitRef = match.groups?.gitRef;
    let workflowPath = match.groups?.workflowPath!;

    let repo = await Git.clone({
      source: `https://github.com/${repoOwner}/${repoName}.git`,
      folder: gitRef
        ? `${repoOwner}/${repoName}@${gitRef}`
        : `${repoOwner}/${repoName}`,
      gitRef,
    });

    let absoluteWorkflowPath = path.join(repo.path, workflowPath);
    let rawContent = await fs.readFile(absoluteWorkflowPath, "utf8");
    let content = YAML.parse(rawContent) as Types.GithubWorkflow["content"];
    if (!content || typeof content !== "object") {
      throw new Error(`Workflow file ${workflowPath} isn't valid YAML.`);
    }

    let actionDeps: Types.GithubAction[] = [];
    let workflowDeps: Types.GithubWorkflow[] = [];

    for (let job of Object.values(content.jobs)) {
      if (job.uses) {
        const isLocal = job.uses.startsWith("./");
        if (isLocal) {
          const depWorkflowName = `${repoOwner}/${repoName}/${job.uses.replace(/^\.\//, "")}`;
          const workflow = await get(depWorkflowName);
          workflowDeps.push(workflow);
        } else {
          const depWorkflowName = job.uses;
          const workflow = await get(depWorkflowName);
          workflowDeps.push(workflow);
        }
      }

      if (job.steps) {
        for (let step of job.steps) {
          if (!step.uses || typeof step.uses !== "string") {
            continue;
          }

          const isLocal = step.uses.startsWith("./");
          if (isLocal) {
            const depActionName = `${repoOwner}/${repoName}/${step.uses.replace(/^\.\//, "")}`;
            const action = await Actions.get(depActionName);
            actionDeps.push(action);
          } else {
            const depActionName = step.uses;
            const action = await Actions.get(depActionName);
            actionDeps.push(action);
          }
        }
      }
    }

    return Types.GithubWorkflow.create({
      reference: reference,

      rawContent,
      content,

      dependencies: {
        actions: actionDeps,
        workflows: workflowDeps,
      },
    });
  }

  export async function scan(
    workflow: Types.GithubWorkflow,
  ): Promise<Types.ScanResponse> {
    const workflowDependenciesMap = new Map<string, string>();
    const actionDependenciesMap = new Map<string, string>();

    function buildActionDependenciesMap(action: Types.GithubAction) {
      if (action.dependencies.actions) {
        for (let dep of action.dependencies.actions) {
          if (!actionDependenciesMap.has(dep.reference)) {
            actionDependenciesMap.set(dep.reference, dep.rawContent);
            buildActionDependenciesMap(dep);
          }
        }
      }
    }

    function buildWorkflowDependenciesMap(workflow: Types.GithubWorkflow) {
      if (workflow.dependencies.workflows) {
        for (let dep of workflow.dependencies.workflows) {
          if (!workflowDependenciesMap.has(dep.reference)) {
            workflowDependenciesMap.set(dep.reference, dep.rawContent);
            buildWorkflowDependenciesMap(dep);
          }
        }
      }

      if (workflow.dependencies.actions) {
        for (let dep of workflow.dependencies.actions) {
          if (!actionDependenciesMap.has(dep.reference)) {
            actionDependenciesMap.set(dep.reference, dep.rawContent);
            buildActionDependenciesMap(dep);
          }
        }
      }
    }
    buildWorkflowDependenciesMap(workflow);

    const messages: OpenRouter.Message[] = [
      {
        role: "system",
        content: prompt,
      },
      {
        role: "user",
        content: `workflow: ${JSON.stringify(workflow)}`,
      },
      {
        role: "user",
        content: `reusableWorkflows: ${JSON.stringify(workflowDependenciesMap.entries().toArray())}`,
      },
      {
        role: "user",
        content: `actionDependencies: ${JSON.stringify(actionDependenciesMap.entries().toArray())}`,
      },
    ];

    // console.log(messages);
    console.log("Scanning workflow", workflow.reference);
    const response = await OpenRouter.complete(messages);
    console.log("Completed scan", workflow.reference);

    return {
      reference: workflow.reference,
      vulnerability: response.choices[0].message.content,
    };
  }
}
