import { Struct } from "../../lib/struct";

export namespace Types {
  export class Repo extends Struct {
    declare source: string;
    declare path: string;
    declare git_ref?: string;
  }
}
