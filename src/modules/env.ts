import { z } from 'zod'

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string(),
});

export namespace Env {
  const env = envSchema.parse(process.env);

  export const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
}