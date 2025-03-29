import { fs, globby, YAML } from "zx";
import { git } from "./git";
import { Struct } from "../lib/struct";
import path from "path";
import { open_router } from "./openrouter";

const prompt = `You are an expert security analyst specializing in GitHub Actions. Your task is to meticulously examine provided GitHub Action workflow code and identify **only direct and exploitable vulnerabilities** that could lead to unauthorized code execution, secret exfiltration, or data manipulation by an external, untrusted user (e.g., via issue creation, pull requests, or other event triggers).

**Focus exclusively on scenarios where an attacker can directly control inputs that result in:**

1.  **Arbitrary Code Execution:**
    * Identify instances where user-supplied input is directly or indirectly executed as code (e.g., shell injection, command injection, script execution).
    * Provide precise steps to reproduce the attack, including the specific GitHub event, payload, and expected outcome.
    * Example: "Shell injection via \`echo "Title: \${{ github.event.issue.title }}" >> prompt.txt; bash prompt.txt\`. Attack steps: 1. Create a new issue. 2. Set the issue title to \`test"; malicious_command; #\`. 3. The action executes \`malicious_command\`."

2.  **Secret Exfiltration:**
    * Pinpoint vulnerabilities that allow an attacker to retrieve sensitive information (e.g., GitHub secrets, environment variables).
    * Provide detailed reproduction steps, including payload and expected exfiltration method (e.g., network request, logging).
    * Example: "Secret exfiltration via malicious git clone and run. Attack steps: 1. create a pull request with changed code that will clone a repository with malicious code, and run that code. 2. The malicious code will read the GITHUB_TOKEN and send it to an external server. 3. The token is exfiltrated."

3.  **Data Manipulation:**
    * Identify cases where an attacker can modify data or configurations in a way that compromises the integrity or security of the workflow or repository.
    * Provide concrete steps to reproduce the attack, including payload and expected outcome.

**Exclude the following from your analysis:**

* Denial-of-service or resource exhaustion attacks that do not involve direct code execution or secret exfiltration.
* "Griefing" attacks that primarily pollute output or trigger false positives (e.g., injecting data into TruffleHog scans).
* Any theoretical attacks that are not easily reproducible.
* Any attacks that require maintainer error, such as a maintainer manually running malicious code.
* Any attacks that are not directly triggered by the github actions.
* Any attacks that require a malicious actor to have write access to the repository.

**Your output should be a concise list of confirmed, reproducible vulnerabilities with detailed reproduction steps for each.** If no such vulnerabilities are found, state "No exploitable vulnerabilities found."`;

export namespace github_actions {
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

    const messages: open_router.Message[] = [
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
    const reponse = await open_router.complete(messages);

    console.log(`Response: ${JSON.stringify(reponse.choices[0].message.content)}`);
  }

  async function getAction(actionName: string) {
    let match = actionName.match(/^(?<owner>[^/]+)\/(?<repoName>[^/@]+)(?<actionPath>\/[^@]+)?(?:@(?<gitRef>.+))?$/);
    if (!match) {
      throw new Error('Invalid repository name. Please use the format "owner/repo[/action_path][@ref]"');
    }

    const owner = match.groups?.owner!;
    const repoName = match.groups?.repoName!;
    const gitRef = match.groups?.gitRef;

    let repo = await git.clone({
      owner: owner,
      name: repoName,
      git_ref: gitRef
    });

    let actionFolder = match.groups?.actionPath ?
      path.join(repo.path, match.groups.actionPath.replace(/^\//, ""))
      : repo.path;

    let matches = await globby(`${actionFolder}/**/{action.yaml,action.yml}`);
    let actionPath = matches[0];

    if (!actionPath) {
      console.error(`Action file not found at ${actionPath}`);
      process.exit(1);
    }

    return parseActionFile(actionPath);
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