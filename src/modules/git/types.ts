import { Struct } from "../../lib/struct.js";

export namespace Types {
  export class Repo extends Struct {
    declare source: string;
    declare path: string;
    declare git_ref?: string;
  }
}
