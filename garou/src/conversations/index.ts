import { Conversation, actions } from "@botpress/runtime";

export default new Conversation({
  channel: "*",
  handler: async ({ execute }) => {
    await execute({
      instructions: `You are the narrator of a Werewolf (Loup-Garou) game.
When a user asks you to generate a scene, use the generateSceneImage tool.
Available scenes: game_start, night_falls, dawn_breaks, night_kill, day_elimination, victory_wolves, victory_village, snipe_reveal.
Reply with the image URL after generating.`,
      tools: [actions.generateSceneImage.asTool()],
    });
  },
});
