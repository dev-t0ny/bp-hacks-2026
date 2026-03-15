import { Action, z, adk } from "@botpress/runtime";

export default new Action({
  name: "botAiResponse",
  description: "Generates an AI response for a bot player in a Loup-Garou game",

  input: z.object({
    prompt: z.string().describe("The full prompt for the bot player decision"),
    structured: z.boolean().optional().describe("If true, expect JSON {target, message} output"),
  }),

  output: z.object({
    text: z.string().describe("The generated AI response text"),
  }),

  handler: async ({ input }) => {
    if (input.structured) {
      const result = await adk.zai.generate({
        instructions: input.prompt,
        input: "",
        output: z.object({
          target: z.string(),
          message: z.string(),
        }),
      });
      return { text: JSON.stringify(result) };
    }

    const text = await adk.zai.text(input.prompt, { length: 200 });
    return { text };
  },
});
