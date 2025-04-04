import { fs, globby, path, YAML } from "zx";
import { Types } from "./types.js";
import { OpenRouter } from "../openrouter.js";
import { prompt } from "./const.js";
import { Git } from "../git/index.js";

export namespace Actions {
  export async function get(reference: string) {
    console.log("Getting action", reference);
    let match = reference.match(
      /^(?<repoOwner>[^/]+)\/(?<repoName>[^/@]+)(?<actionFolder>\/[^@]+)?(?:@(?<gitRef>.+))?$/,
    );
    if (!match) {
      throw new Error(
        `Action name ${reference} is invalid, please use the format "owner/repo[/action][@ref]"`,
      );
    }

    let repoOwner = match.groups?.repoOwner!;
    let repoName = match.groups?.repoName!;
    let gitRef = match.groups?.gitRef ?? undefined;
    let actionFolder = match.groups?.actionFolder ?? undefined;

    let repo = await Git.clone({
      source: `https://github.com/${repoOwner}/${repoName}.git`,
      folder: gitRef
        ? `${repoOwner}/${repoName}@${gitRef}`
        : `${repoOwner}/${repoName}`,
      gitRef,
    });

    let actionAbsoluteFolder = path.join(repo.path, actionFolder ?? "");

    let [actionAbsolutePath] = await globby(
      `${actionAbsoluteFolder}/{action.yaml,action.yml}`,
    );
    if (!actionAbsolutePath) {
      throw new Error(`Action file at ${actionAbsoluteFolder} not found.`);
    }

    let rawContent = await fs.readFile(actionAbsolutePath, "utf8");
    let content = YAML.parse(rawContent) as Types.GithubAction["content"];

    if (!content || typeof content !== "object") {
      throw new Error(`Action file ${actionAbsolutePath} isn't valid YAML.`);
    }

    let actionDeps: Types.GithubAction[] = [];
    if (content.runs.using === "composite") {
      for (let step of content.runs.steps) {
        if (!step.uses || typeof step.uses !== "string") {
          continue;
        }

        const isLocal = step.uses.startsWith("./");
        if (isLocal) {
          const depActionName = `${repoOwner}/${repoName}/${step.uses.replace(/^\.\//, "")}`;
          const action = await get(depActionName);
          actionDeps.push(action);
        } else {
          const depActionName = step.uses;
          const action = await get(depActionName);
          actionDeps.push(action);
        }
      }
    }

    return Types.GithubAction.create({
      reference: reference,
      rawContent,
      content,
      dependencies: {
        actions: actionDeps,
      },
    });
  }

  export async function scan(
    action: Types.GithubAction,
  ): Promise<Types.ScanResponse> {
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
    buildActionDependenciesMap(action);

    const messages: OpenRouter.Message[] = [
      {
        role: "system",
        content: prompt,
      },
      {
        role: "user",
        content: `action: ${JSON.stringify(action)}`,
      },
      {
        role: "user",
        content: `actionDependencies: ${JSON.stringify(actionDependenciesMap.entries().toArray())}`,
      },
    ];

    // console.log(JSON.stringify(messages, null, 2));
    console.log("Scanning action", action.reference);
    const reponse = await OpenRouter.complete(messages);

    return {
      reference: action.reference,
      vulnerability: reponse.choices[0].message.content,
    };
  }
}
