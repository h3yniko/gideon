import { z } from "zod";

let envSchema = z.object({
  OPENROUTER_API_KEY: z.string(),
  GITHUB_TOKEN: z.string(),
});

export namespace Env {
  let env = envSchema.parse(process.env);

  export let OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
  export let GITHUB_TOKEN = env.GITHUB_TOKEN;
}
