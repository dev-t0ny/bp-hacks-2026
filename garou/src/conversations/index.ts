import { Conversation, bot } from "@botpress/runtime";
import * as discord from "../actions/discord-api";
import { buildGameEmbed, type GameState } from "../actions/embed-builder";

const MIN_PLAYERS = 4;
const MAX_PLAYERS_LIMIT = 20;
const EMBED_COLOR = 0x8b0000;

async function findOrCreateCategory(guildId: string): Promise<string> {
  const channels = await discord.getGuildChannels(guildId);
  const existing = channels.find(
    (c: any) => c.type === 4 && c.name.toLowerCase() === "loup-garou"
  );
  if (existing) return existing.id;

  const created = await discord.createChannel(guildId, {
    name: "Loup-Garou",
    type: 4,
  });
  return created.id;
}

async function createGameChannel(
  guildId: string,
  categoryId: string,
  gameNumber: number,
  botUserId: string
): Promise<string> {
  const channel = await discord.createChannel(guildId, {
    name: `partie-${gameNumber}`,
    type: 0,
    parent_id: categoryId,
    permission_overwrites: [
      {
        id: guildId,
        type: 0,
        deny: String(1 << 10),
      },
      {
        id: botUserId,
        type: 1,
        allow: String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 15)),
      },
    ],
  });
  return channel.id;
}

export default new Conversation({
  channel: "*",
  handler: async ({ message, conversation, execute }) => {
    if (!message || message.type !== "text") return;

    // Use message.text (ADK convenience) or fall back to payload.text
    const text = ((message as any).text ?? (message.payload as any)?.text ?? "").trim();

    // Only respond if the bot is mentioned (@Garou)
    const BOT_DISCORD_ID = "1482405258746663084";
    if (!text.includes(`<@${BOT_DISCORD_ID}>`) && !text.includes(`<@!${BOT_DISCORD_ID}>`)) return;

    // Lenient match: look for "loupgarou" followed by a number anywhere in the text
    const match = text.match(/loupgarou\s*(\d+)/i);

    if (!match) {
      await execute({
        instructions:
          "Tu es Garou, un bot de jeu de Loup-Garou sur Discord. Réponds TOUJOURS en français. Dis aux utilisateurs de taper /loupgarou <nombre> pour créer une partie. Sois bref.",
      });
      return;
    }

    const maxPlayers = parseInt(match[1]!, 10);
    if (maxPlayers < MIN_PLAYERS) {
      await conversation.send({
        type: "text",
        payload: { text: `❌ Il faut au minimum ${MIN_PLAYERS} joueurs.` },
      });
      return;
    }
    if (maxPlayers > MAX_PLAYERS_LIMIT) {
      await conversation.send({
        type: "text",
        payload: { text: `❌ Maximum ${MAX_PLAYERS_LIMIT} joueurs.` },
      });
      return;
    }

    const guildId = conversation.tags["discord:guildId"];
    const channelId = conversation.tags["discord:id"];
    const creatorDiscordId = message.tags["discord:userId"];

    if (!guildId || !channelId || !creatorDiscordId) {
      await conversation.send({
        type: "text",
        payload: { text: "❌ Cette commande ne fonctionne que dans un serveur Discord." },
      });
      return;
    }

    // Get creator info
    const member = await discord.getGuildMember(guildId, creatorDiscordId);
    const creatorName = member.nick || member.user.global_name || member.user.username;

    // Increment game counter
    const currentState = await bot.getState();
    const gameNumber = (currentState?.gameCounter ?? 0) + 1;
    await bot.setState({ gameCounter: gameNumber });

    // Get bot user for channel permissions
    const botUser = await discord.getBotUser();

    // Create category + game channel
    const categoryId = await findOrCreateCategory(guildId);
    const gameChannelId = await createGameChannel(guildId, categoryId, gameNumber, botUser.id);

    // Build and send embed with button
    const gameState: GameState = {
      gameNumber,
      creatorId: creatorDiscordId,
      creatorName,
      guildId,
      gameChannelId,
      maxPlayers,
      players: [],
    };
    const embedPayload = buildGameEmbed(gameState);
    await discord.sendMessage(channelId, embedPayload);

    // Send welcome message in game channel
    await discord.sendMessage(gameChannelId, {
      embeds: [
        {
          title: `🐺 Salle d'attente — Partie #${gameNumber}`,
          description: [
            `Créée par **${creatorName}**`,
            `**Joueurs max:** ${maxPlayers}`,
            "",
            "En attente de joueurs...",
          ].join("\n"),
          color: EMBED_COLOR,
        },
      ],
    });
  },
});
