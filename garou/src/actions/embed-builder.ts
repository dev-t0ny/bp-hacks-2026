const EMBED_COLOR = 0x8b0000;
const WEREWOLF_IMAGE = "https://i.imgur.com/JfOLPcY.png";
const MIN_PLAYERS = 4;

export interface GameState {
  gameNumber: number;
  creatorId: string;
  creatorName: string;
  guildId: string;
  gameChannelId: string;
  maxPlayers: number;
  players: string[];
}

export function buildGameEmbed(game: GameState) {
  const playerCount = game.players.length;
  const isFull = playerCount >= game.maxPlayers;

  return {
    embeds: [
      {
        title: `🐺 Partie de Loup-Garou #${game.gameNumber}`,
        description: [
          `Créée par **${game.creatorName}**`,
          "",
          `**Joueurs:** ${playerCount}/${game.maxPlayers}`,
          "",
          isFull
            ? "**La partie est pleine!**"
            : "Cliquez sur le bouton pour rejoindre!",
        ].join("\n"),
        color: EMBED_COLOR,
        image: { url: WEREWOLF_IMAGE },
        footer: {
          text: isFull
            ? "La partie va commencer!"
            : `Minimum ${MIN_PLAYERS} joueurs pour lancer`,
        },
        fields: [
          { name: "__gameNumber", value: String(game.gameNumber), inline: true },
          { name: "__creatorId", value: game.creatorId, inline: true },
          { name: "__creatorName", value: game.creatorName, inline: true },
          { name: "__guildId", value: game.guildId, inline: true },
          { name: "__gameChannelId", value: game.gameChannelId, inline: true },
          { name: "__maxPlayers", value: String(game.maxPlayers), inline: true },
          { name: "__players", value: game.players.join(",") || "none", inline: false },
        ],
      },
    ],
    components: isFull
      ? []
      : [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 3,
                label: "🐺 Rejoindre la partie",
                custom_id: `join_game_${game.gameNumber}`,
              },
            ],
          },
        ],
  };
}

export function parseGameFromEmbed(message: any): GameState | null {
  const embed = message.embeds?.[0];
  if (!embed?.fields) return null;

  const field = (name: string): string | undefined =>
    embed.fields.find((f: any) => f.name === name)?.value;

  const gameNumber = Number(field("__gameNumber"));
  const creatorId = field("__creatorId");
  const creatorName = field("__creatorName");
  const guildId = field("__guildId");
  const gameChannelId = field("__gameChannelId");
  const maxPlayers = Number(field("__maxPlayers"));
  const playersRaw = field("__players");

  if (!creatorId || !guildId || !gameChannelId || !creatorName) return null;

  const players =
    playersRaw && playersRaw !== "none" ? playersRaw.split(",") : [];

  return {
    gameNumber,
    creatorId,
    creatorName,
    guildId,
    gameChannelId,
    maxPlayers,
    players,
  };
}
