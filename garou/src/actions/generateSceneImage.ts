import { Action, z } from "@botpress/runtime";

const SceneType = z.enum([
  "night_falls",
  "dawn_breaks",
  "night_kill",
  "day_elimination",
  "victory_wolves",
  "victory_village",
  "snipe_reveal",
  "game_start",
]);

const STYLE_PREFIX = `Dark pixel art illustration in 32-bit style, wide cinematic banner format. Gothic medieval fantasy atmosphere inspired by Darkest Dungeon and Castlevania. Deep shadows, muted earth tones with blood red and pale moonlight blue accents. Detailed pixel art with visible pixels but rich in atmosphere. No text, no UI elements, no watermarks.`;

const SCENE_PROMPTS: Record<z.infer<typeof SceneType>, (ctx: string) => string> = {
  game_start: (ctx) =>
    `A mysterious medieval village at dusk, establishing shot. ${ctx}`,
  night_falls: (ctx) =>
    `The village descends into darkness, candles being blown out, shadows creeping in. ${ctx}`,
  dawn_breaks: (ctx) =>
    `First light breaks over the village, an eerie calm, something terrible happened during the night. ${ctx}`,
  night_kill: (ctx) =>
    `A dramatic crime scene in the village at night. ${ctx}`,
  day_elimination: (ctx) =>
    `The village square, angry mob gathered around a suspect. ${ctx}`,
  victory_wolves: (ctx) =>
    `Wolves standing triumphant over a ruined village under a blood moon. ${ctx}`,
  victory_village: (ctx) =>
    `Villagers celebrating at dawn, the last wolf defeated. ${ctx}`,
  snipe_reveal: (ctx) =>
    `A villager's face glitching and dissolving into pixels, revealing they were never real. ${ctx}`,
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

export default new Action({
  name: "generateSceneImage",
  description: "Generates a cinematic banner image for a Werewolf game scene",

  input: z.object({
    scene: SceneType.describe("Type of game scene to illustrate"),
    context: z.string().optional().describe("Extra context: victim name, role, details"),
  }),

  output: z.object({
    imageUrl: z.string().describe("URL of the generated image"),
  }),

  handler: async ({ input }) => {
    const sceneContext = input.context ?? "";
    const scenePrompt = SCENE_PROMPTS[input.scene](sceneContext);
    const fullPrompt = `${STYLE_PREFIX} ${scenePrompt}`;

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt: fullPrompt,
        size: "1792x1024",
        quality: "hd",
        n: 1,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[DALL-E] API error:", response.status, error);
      throw new Error(`DALL-E API error: ${response.status}`);
    }

    const data = (await response.json()) as { data: { url: string }[] };
    return { imageUrl: data.data[0]!.url };
  },
});
