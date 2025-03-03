import { OpenRouter } from "./modules/openrouter"

const completion = await OpenRouter.complete([
  { role: 'user', content: 'What is the meaning of life?' },
]);

console.log(completion.choices[0].message);