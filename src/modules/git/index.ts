import { $ } from "zx/core";
import { fs } from "zx";
import { join } from "path";
import { Types as _Types } from "./types.js";
import { Struct } from "../../lib/struct.js";

export namespace Git {
  export import Types = _Types;

  class CloneArgs extends Struct {
    declare source: string;
    declare folder: string;
    declare gitRef?: string;
  }

  export async function clone(args: CloneArgs): Promise<Types.Repo> {
    let path = join(process.cwd(), ".cache", args.folder);

    if (await fs.exists(path)) {
      console.debug(`Repository ${path} already exists`);
      return Types.Repo.create({
        source: args.source,
        path,
        git_ref: args.gitRef,
      });
    }

    await fs.mkdirs(path);
    await $`git ${["clone", "--depth=1", args.source, path]}`;

    if (args.gitRef) {
      await $`git -C ${path} fetch --depth=1 origin ${args.gitRef}`;
      await $`git -C ${path} checkout FETCH_HEAD`;
    }

    return Types.Repo.create({
      source: args.source,
      path,
      git_ref: args.gitRef,
    });
  }
}
