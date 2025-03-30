import { $ } from "zx/core";
import { Struct } from "../lib/struct";
import { fs } from "zx";
import { join } from "path";

export namespace Git {
  export class RepoToClone extends Struct {
    declare owner: string;
    declare name: string;
    declare git_ref?: string;
  }

  export class ClonedRepo extends Struct {
    declare owner: string;
    declare name: string;
    declare git_ref?: string;
    declare path: string;
  }

  export async function clone(repo: RepoToClone): Promise<ClonedRepo> {
    let folder_name = repo.git_ref ? `${repo.name}@${repo.git_ref}` : repo.name;
    let path = join(
      process.cwd(),
      '.cache',
      repo.owner,
      folder_name
    );
    if (await fs.exists(path)) {
      console.debug(`Repository ${path} already exists`);
      return {
        ...repo,
        path,
      };
    }

    await fs.mkdirs(path);
    await $`git ${[
      'clone',
      '--depth=1',
      `https://github.com/${repo.owner}/${repo.name}.git`,
      path,
    ]}`;

    if (repo.git_ref) {
      await $`git -C ${path} fetch --depth=1 origin ${repo.git_ref}`;
      await $`git -C ${path} checkout FETCH_HEAD`;
    }

    return {
      ...repo,
      path,
    };
  };
}