import { actions } from "@botpress/runtime";

export default async function () {
  console.log("Generating test image...");

  const result = await actions.dalle.generateImage({
    prompt: `Dark pixel art illustration in 32-bit style, wide cinematic banner format. Gothic medieval fantasy atmosphere inspired by Darkest Dungeon and Castlevania. Deep shadows, muted earth tones with blood red and pale moonlight blue accents. Detailed pixel art with visible pixels but rich in atmosphere. No text, no UI elements, no watermarks. A mysterious medieval village at dusk, establishing shot, a full moon rises behind a church steeple.`,
    size: "1792x1024",
    quality: "hd",
    model: "dall-e-3",
  });

  console.log("Image URL:", result.url);
}
