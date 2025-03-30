import { fs, globby, YAML } from "zx";
import { Git } from "./git";
import { Struct } from "../lib/struct";
import path from "path";
import { OpenRouter } from "./openrouter";

// if injection happens in dependency, inlcude dependency name in the output
// should ONLY review exploitable vulnerabilities in main action
const prompt = `
You are an expert security analyst specializing in GitHub Actions workflows. Your task is to meticulously analyze the provided workflow code and identify any direct and exploitable vulnerabilities. Focus exclusively on scenarios where an attacker can exploit the workflow to achieve unauthorized actions, such as:

1. **Arbitrary Code Execution:**
   - Identify cases where untrusted user inputs are executed as code (e.g., shell injection, command injection).
   - Provide detailed reproduction steps, including:
     - Specific GitHub event or payload required.
     - How the malicious input is processed in the workflow.
     - The expected outcome of the attack.

2. **Secret Exfiltration:**
   - Pinpoint vulnerabilities that allow attackers to access sensitive secrets (e.g., \`GITHUB_TOKEN\`, API keys).
   - Include clear steps demonstrating how secrets can be exfiltrated (e.g., via network requests or logs).

3. **Data Manipulation:**
   - Highlight scenarios where attackers can modify repository data or workflow configurations.
   - Provide concrete examples of how this manipulation could compromise repository integrity or security.

---

### Constraints:
- Focus only on **directly exploitable vulnerabilities** triggered by untrusted inputs (e.g., issue titles, pull request content).
- Exclude attacks requiring write access to the repository or manual maintainer errors.
- Avoid theoretical attacks that are not easily reproducible.

---

### Output Requirements:
- Provide a concise list of confirmed vulnerabilities with detailed reproduction steps for each.
- If no vulnerabilities are found, explicitly state: **"No exploitable vulnerabilities found."**
`;

export namespace GithubActions {
  export interface GithubActionInput {
    description?: string;
    default?: boolean | string | number | string[];
    required?: boolean;
    options?: string[];
    type?: string;
    deprecationMessage?: string;
  }

  export interface GithubActionOutput {
    description?: string;
    value?: string;
  }

  export type GithubAction = GithubJSAction | GithubDockerAction | GithubCompositeAction;

  class ActionBase<T extends string> extends Struct {
    declare name?: string;
    declare description?: string;
    declare inputs?: Record<string, GithubActionInput>;
    declare outputs?: Record<string, GithubActionOutput>;
    declare runs: { using: T };
  }

  export class GithubJSAction extends ActionBase<"node12" | "node16" | "node20"> {
    declare runs: {
      using: "node12" | "node16" | "node20";
      main: string;
      pre?: string;
      post?: string;
      /**
       * @deprecated Use pre/post instead
       */
      preIf?: string;
    };
  }

  export class GithubDockerAction extends ActionBase<"docker"> {
    declare runs: {
      using: "docker";
      image: string;
      entrypoint?: string;
      args?: string[];
      env?: Record<string, string>;
      /**
       * Pre-entrypoint script (runs before Docker container starts)
       */
      "pre-entrypoint"?: string;
      /**
       * Post-entrypoint script (runs after main container process)
       */
      "post-entrypoint"?: string;
    };
  }

  export class GithubCompositeAction extends ActionBase<"composite"> {
    declare runs: {
      using: "composite";
      steps: Array<{
        name?: string;
        id?: string;
        uses?: string;
        run?: string;
        shell?: string;
        env?: Record<string, string>;
        "working-directory"?: string;
      }>;
    };
  }

  class GithubWorkflow extends Struct {
    declare name: string;
    declare on: Record<string, any>; // Triggers (e.g., push, pull_request)
    declare jobs: Record<string, {
      name?: string;
      runsOn?: string | string[];
      steps?: Array<{
        name?: string;
        id?: string;
        uses?: string;
        run?: string;
        shell?: string;
        env?: Record<string, string>;
        "working-directory"?: string;
      }>;
      uses?: string;  // For reusable workflows
      with?: Record<string, any>;  // Inputs for reusable workflows
    }>;
  }

  async function parseActionFile(
    filePath: string
  ): Promise<GithubAction> {
    let content = await fs.readFile(filePath, 'utf8');
    let rawData = YAML.parse(content);

    if (!rawData || typeof rawData !== 'object') {
      throw new Error('Invalid YAML structure');
    }

    let baseAction = ActionBase.create(rawData);

    switch (baseAction.runs.using) {
      case 'node12':
      case 'node16':
      case 'node20':
        return GithubJSAction.create(rawData);
      case 'docker':
        return GithubDockerAction.create(rawData);
      case 'composite':
        return GithubCompositeAction.create(rawData);
      default:
        throw new Error(`Unknown action type: ${baseAction.runs.using}`);
    }
  }

  async function getWorkflow(workflowPath: string): Promise<GithubWorkflow> {
    let match = workflowPath.match(/^(?<owner>[^/]+)\/(?<repoName>[^/]+)(?<workflowPath>\/.+)$/);
    if (!match) {
      throw new Error('Invalid repository name. Please use the format "owner/repo[/workflow_path]"');
    }

    const owner = match.groups?.owner!;
    const repoName = match.groups?.repoName!;

    let repo = await Git.clone({
      owner: owner,
      name: repoName
    });

    let workflowAbsolutePath = path.join(repo.path, match.groups?.workflowPath.replace(/^\//, "")!)

    let content = await fs.readFile(workflowAbsolutePath, 'utf8');
    let rawData = YAML.parse(content);

    if (!rawData || typeof rawData !== 'object') {
      throw new Error('Invalid YAML structure');
    }

    return GithubWorkflow.create(rawData);
  }

  async function getReusableWorkflow(workflowRef: string): Promise<GithubWorkflow> {
    // Parse the workflow reference which should be in format "owner/repo/.github/workflows/file.yml@ref"
    const match = workflowRef.match(/^(?<owner>[^/]+)\/(?<repoName>[^/]+)\/(?<workflowPath>.+?)(?:@(?<gitRef>.+))?$/);
    if (!match) {
      throw new Error('Invalid reusable workflow reference. Expected format: "owner/repo/path/to/workflow.yml[@ref]"');
    }

    const owner = match.groups?.owner!;
    const repoName = match.groups?.repoName!;
    const workflowPath = match.groups?.workflowPath!;
    const gitRef = match.groups?.gitRef;

    let repo = await Git.clone({
      owner: owner,
      name: repoName,
      git_ref: gitRef
    });

    const fullWorkflowPath = path.join(repo.path, workflowPath);
    
    let content = await fs.readFile(fullWorkflowPath, 'utf8');
    let rawData = YAML.parse(content);

    if (!rawData || typeof rawData !== 'object') {
      throw new Error('Invalid YAML structure in reusable workflow');
    }

    return GithubWorkflow.create(rawData);
  }

  export async function scanAction(actionName: string) {
    let actions = new Map<string, GithubAction>();
    let queue = [actionName];
    while (queue.length > 0) {
      let currentActionName = queue.pop()!;
      let action = await getAction(currentActionName);
      actions.set(currentActionName, action);
      let dependencies = await listDependencies(action);
      for (let dep of dependencies) {
        if (!actions.has(dep)) {
          queue.push(dep);
        }
      }
    }

    const messages: OpenRouter.Message[] = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: `mainAction: ${JSON.stringify(actions.get(actionName))}`,
      },
      {
        role: 'user',
        content: `dependencies: ${JSON.stringify(actions.values().toArray())}`,
      },
    ];
    console.log(messages)
    const reponse = await OpenRouter.complete(messages);

    console.log(`Response: ${JSON.stringify(reponse.choices[0].message.content)}`);
  }

  export async function scanWorkflow(workflowPath: string) {
    const workflow = await getWorkflow(workflowPath);
    const dependencies = new Map<string, GithubAction>();
    const reusableWorkflows = new Map<string, GithubWorkflow>();
    
    // Process all jobs in the workflow
    for (const jobKey of Object.keys(workflow.jobs)) {
      const job = workflow.jobs[jobKey];
      
      // Handle jobs that use reusable workflows
      if (job.uses) {
        try {
          console.log(`Job '${jobKey}' uses reusable workflow: ${job.uses}`);
          
          // Fetch and analyze the reusable workflow
          const reusableWorkflow = await getReusableWorkflow(job.uses);
          reusableWorkflows.set(job.uses, reusableWorkflow);
          
          // Recursively process actions used in the reusable workflow
          for (const reusableJobKey of Object.keys(reusableWorkflow.jobs)) {
            const reusableJob = reusableWorkflow.jobs[reusableJobKey];
            
            // Handle nested reusable workflows (if any)
            if (reusableJob.uses) {
              console.log(`Reusable workflow contains another reusable workflow: ${reusableJob.uses}`);
              // Could further extend this to handle deeply nested reusable workflows if needed
            }
            
            // Process steps in the reusable workflow job
            if (reusableJob.steps) {
              for (const step of reusableJob.steps) {
                if (step.uses) {
                  const actionName = step.uses;
                  if (!dependencies.has(actionName)) {
                    try {
                      const action = await getAction(actionName);
                      dependencies.set(actionName, action);
                    } catch (error) {
                      console.error(`Error fetching action ${actionName} from reusable workflow:`, error);
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error processing reusable workflow ${job.uses}:`, error);
        }
      }
      
      // Handle regular jobs with steps
      if (job.steps) {
        for (const step of job.steps) {
          if (step.uses) {
            const actionName = step.uses;
            if (!dependencies.has(actionName)) {
              try {
                const action = await getAction(actionName);
                dependencies.set(actionName, action);
              } catch (error) {
                console.error(`Error fetching action ${actionName}:`, error);
              }
            }
          }
        }
      }
    }

    const messages: OpenRouter.Message[] = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: `workflow: ${JSON.stringify(workflow)}`,
      },
      {
        role: 'user',
        content: `reusableWorkflows: ${JSON.stringify(Array.from(reusableWorkflows.values()))}`,
      },
      {
        role: 'user',
        content: `dependencies: ${JSON.stringify(Array.from(dependencies.values()))}`,
      },
    ];

    console.log(messages);
    const response = await OpenRouter.complete(messages);

    console.log(`Response: ${JSON.stringify(response.choices[0].message.content)}`);
  }

  export async function scanRepo(repoPath: string) {
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

    const workflowFiles = await globby(`${repo.path}/.github/workflows/**/*.{yml,yaml}`);
    
    if (workflowFiles.length === 0) {
      console.log(`No workflow files found in ${owner}/${repoName}`);
      return;
    }
    
    console.log(`Found ${workflowFiles.length} workflow files in ${owner}/${repoName}`);
    
    // Scan each workflow file
    for (const workflowFile of workflowFiles) {
      const relativePath = path.relative(repo.path, workflowFile);
      const workflowPath = `${owner}/${repoName}/${relativePath}`;
      
      console.log(`Scanning workflow: ${workflowPath}`);
      try {
        await scanWorkflow(workflowPath);
      } catch (error) {
        console.error(`Error scanning workflow ${workflowPath}:`, error);
      }
    }
  }

  async function getAction(actionName: string) {
    let match = actionName.match(/^(?<owner>[^/]+)\/(?<repoName>[^@]+)(?<actionPath>\/.+)?(?:@(?<gitRef>.+))?$/);
    if (!match) {
      throw new Error('Invalid repository name. Please use the format "owner/repo[/action_path][@ref]"');
    }

    const owner = match.groups?.owner!;
    const repoName = match.groups?.repoName!;
    const gitRef = match.groups?.gitRef;

    let repo = await Git.clone({
      owner: owner,
      name: repoName,
      git_ref: gitRef
    });

    let actionFolder = match.groups?.actionPath
      ? path.join(repo.path, match.groups.actionPath.replace(/^\//, ""))
      : repo.path;

    let matches = await globby(`${actionFolder}/**/{action.yaml,action.yml}`);
    let actionPath = matches[0];

    if (!actionPath) {
      console.error(`Action file not found at ${actionPath}`);
      process.exit(1);
    }

    return parseActionFile(actionPath);
  }

  async function listDependencies(action: GithubAction): Promise<string[]> {
    const dependencies: string[] = [];

    // Only composite actions can have dependencies on other actions
    if (action instanceof GithubCompositeAction) {
      for (const step of action.runs.steps) {
        // In composite actions, dependencies are specified with the "uses" field
        if (step.uses && typeof step.uses === 'string') {
          dependencies.push(step.uses);
        }
      }
    }

    return dependencies;
  }
}