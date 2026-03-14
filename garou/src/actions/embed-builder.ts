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

function encodeState(game: GameState): string {
  const compact = {
    g: game.gameNumber,
    c: game.creatorId,
    n: game.creatorName,
    gi: game.guildId,
    ch: game.gameChannelId,
    m: game.maxPlayers,
    p: game.players,
  };
  return btoa(JSON.stringify(compact));
}

export function buildGameEmbed(game: GameState) {
  const playerCount = game.players.length;
  const isFull = playerCount >= game.maxPlayers;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  const descriptionLines = [
    `Créée par <@${game.creatorId}>`,
    "",
    `**Joueurs:** ${playerCount}/${game.maxPlayers}`,
  ];

  if (playerCount > 0) {
    descriptionLines.push("");
    descriptionLines.push(game.players.map((id) => `> <@${id}>`).join("\n"));
  }

  descriptionLines.push("");
  descriptionLines.push(
    isFull ? "**La partie est pleine!**" : "Cliquez sur le bouton ci-dessous pour rejoindre!"
  );

  return {
    embeds: [
      {
        title: `🐺 Partie de Loup-Garou #${game.gameNumber}`,
        url: stateUrl,
        description: descriptionLines.join("\n"),
        color: EMBED_COLOR,
        image: { url: WEREWOLF_IMAGE },
        footer: {
          text: isFull ? "La partie va commencer!" : `Minimum ${MIN_PLAYERS} joueurs pour lancer`,
        },
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
  if (!embed?.url) return null;
  try {
    const b64 = embed.url.split("/s/")[1];
    if (!b64) return null;
    const compact = JSON.parse(atob(b64));
    return {
      gameNumber: compact.g,
      creatorId: compact.c,
      creatorName: compact.n,
      guildId: compact.gi,
      gameChannelId: compact.ch,
      maxPlayers: compact.m,
      players: compact.p ?? [],
    };
  } catch {
    return null;
  }
}
