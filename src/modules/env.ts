import { z } from 'zod'

let envSchema = z.object({
  OPENROUTER_API_KEY: z.string(),
});

export namespace Env {
  let env = envSchema.parse(process.env);

  export let OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
}