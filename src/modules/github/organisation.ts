import { Octokit } from "octokit";
import { Endpoints } from "@octokit/types";
import { Types } from "./types.js";
import { Env } from "../env.js";
import { Repos } from "./repos.js";

export namespace Organisation {
  // TODO: move somewhere else
  const octokit = new Octokit({
    auth: Env.GITHUB_TOKEN,
  });

  async function listRepos(
    organisation: string,
  ): Promise<Endpoints["GET /orgs/{org}/repos"]["response"]["data"]> {
    let page = 1;
    const allRepos: Endpoints["GET /orgs/{org}/repos"]["response"]["data"] = [];
    let response;
    do {
      response = await octokit.rest.repos.listForOrg({
        org: organisation,
        type: "all",
        per_page: 100,
        page,
      });
      allRepos.push(...response.data);
      page++;
    } while (response.data.length === 100);

    return allRepos;
  }

  export async function* scan(
    organisation: string,
  ): AsyncGenerator<Types.ScanResponse> {
    const repos = await listRepos(organisation);
    for (let repo of repos) {
      for await (const scanResponse of Repos.scan(repo.full_name)) {
        yield scanResponse;
      }
    }
  }
}
