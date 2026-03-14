import { z, defineConfig } from "@botpress/runtime";

export default defineConfig({
  name: "Adam-Bot",
  description: "An AI agent built with Botpress ADK",

  defaultModels: {
    autonomous: "best",
    zai: "best",
  },

  bot: {
    state: z.object({
      gameCounter: z
        .number()
        .optional()
        .describe("Auto-incrementing game number counter"),
    }),
  },

  user: {
    state: z.object({}),
  },

  dependencies: {
    integrations: {
      chat: { version: "chat@0.7.6", enabled: true },
      webchat: { version: "webchat@0.3.0", enabled: true },
      discord: {
        version: "shell/discord@0.1.0",
        enabled: true,
        config: { botToken: process.env.DISCORD_BOT_TOKEN! },
      },
      dalle: {
        version: "simplygreatbots/dalle@0.3.1",
        enabled: true,
        config: { apiKey: process.env.OPENAI_API_KEY! },
      },
    },
  },
});
