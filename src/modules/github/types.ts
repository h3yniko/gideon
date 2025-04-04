import { Struct } from "../../lib/struct";
import { Git } from "../git";

export namespace Types {
  export class InternalJSDependency extends Struct {
    declare path: string;
    declare content: string;
    declare imports: InternalJSDependency[];
  };

  export class ExternalJSDependency extends Struct {
    declare name: string;
    declare version: string;
  }

  export type JSDependency = InternalJSDependency | ExternalJSDependency;

  export type DockerDependency = {
    baseImage: string;
    content?: string;
  };

  export class GithubAction extends Struct {
    declare reference: string;

    declare rawContent: string;
    declare content: {
      name?: string;
      description?: string;
      inputs?: Record<string, {
        description?: string;
        default?: boolean | string | number | string[];
        required?: boolean;
        options?: string[];
        type?: string;
        deprecationMessage?: string;
      }>;
      outputs?: Record<string, {
        description?: string;
        value?: string;
      }>;
      runs: {
        using: "node12" | "node16" | "node20";
        main: string;
        pre?: string;
        post?: string;
        preIf?: string;
      } | {
        using: "docker";
        image: string;
        entrypoint?: string;
        args?: string[];
        env?: Record<string, string>;
        "pre-entrypoint"?: string;
        "post-entrypoint"?: string;
      } | {
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
      }
    }

    declare dependencies: {
      actions?: GithubAction[];
      js?: JSDependency;
      docker?: DockerDependency;
    }
  }

  export class GithubWorkflow extends Struct {
    declare reference: string;

    declare rawContent: string;
    declare content: {
      name: string;
      on: Record<string, any>;
      jobs: Record<string, {
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
        uses?: string;
        with?: Record<string, any>;
      }>;
    };

    declare dependencies: {
      workflows?: GithubWorkflow[];
      actions?: GithubAction[];
      js?: JSDependency;
      docker?: DockerDependency;
    }
  }

  export class ScanResponse extends Struct {
    declare reference: string;
    declare vulnerability: string;
  }
}