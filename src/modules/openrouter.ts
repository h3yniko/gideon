import axios from "axios";
import { Env } from './env'
import { z } from "zod";

let responseSchema = z.object({
  model: z.string(),
  provider: z.string(),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
  choices: z.array(z.object({
    message: z.object({
      role: z.string(),
      content: z.string(),
    }),
  })),
});

export namespace OpenRouter {
  export type Message = {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }

  export async function complete(messages: Message[], options?: { model?: string }) {
    let response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: options?.model ?? 'deepseek/deepseek-chat-v3-0324:free',
      messages,
    }, {
      headers: {
        Authorization: `Bearer ${Env.OPENROUTER_API_KEY}`,
      },
    });

    return responseSchema.parse(response.data);
  }
}
