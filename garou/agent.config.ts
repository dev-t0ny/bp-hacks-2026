import { z, defineConfig } from "@botpress/runtime";

export default defineConfig({
  name: "garou",
  description: "An AI agent built with Botpress ADK",

  defaultModels: {
    autonomous: "best",
    zai: "best",
  },

  bot: {
    state: z.object({
      gameCounter: z.number().optional().describe("Auto-incrementing game number counter"),
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
    },
  },
});
