import nacl from "tweetnacl";

interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
}

// ── Discord REST API ────────────────────────────────────────────────

const DISCORD_API = "https://discord.com/api/v10";

async function discordFetch(token: string, path: string, options: RequestInit = {}) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function sendMessage(token: string, channelId: string, body: Record<string, unknown>) {
  return discordFetch(token, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function editMessage(token: string, channelId: string, messageId: string, body: Record<string, unknown>) {
  return discordFetch(token, `/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function setChannelPermission(
  token: string,
  channelId: string,
  targetId: string,
  body: { allow?: string; deny?: string; type: 0 | 1 }
) {
  return discordFetch(token, `/channels/${channelId}/permissions/${targetId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

function getGuildMember(token: string, guildId: string, userId: string) {
  return discordFetch(token, `/guilds/${guildId}/members/${userId}`);
}

// ── Embed Builder ───────────────────────────────────────────────────

const EMBED_COLOR = 0x8b0000;
const WEREWOLF_IMAGE = "https://i.imgur.com/JfOLPcY.png";
const MIN_PLAYERS = 4;

interface GameState {
  gameNumber: number;
  creatorId: string;
  creatorName: string;
  guildId: string;
  gameChannelId: string;
  maxPlayers: number;
  players: string[];
}

function buildGameEmbed(game: GameState) {
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
          isFull ? "**La partie est pleine!**" : "Cliquez sur le bouton pour rejoindre!",
        ].join("\n"),
        color: EMBED_COLOR,
        image: { url: WEREWOLF_IMAGE },
        footer: {
          text: isFull ? "La partie va commencer!" : `Minimum ${MIN_PLAYERS} joueurs pour lancer`,
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

function parseGameFromEmbed(message: any): GameState | null {
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

  const players = playersRaw && playersRaw !== "none" ? playersRaw.split(",") : [];

  return { gameNumber, creatorId, creatorName, guildId, gameChannelId, maxPlayers, players };
}

// ── Signature Verification ──────────────────────────────────────────

function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function verifySignature(body: string, signature: string, timestamp: string, publicKey: string): boolean {
  const msg = new TextEncoder().encode(timestamp + body);
  const sig = hexToUint8(signature);
  const key = hexToUint8(publicKey);
  return nacl.sign.detached.verify(msg, sig, key);
}

// ── Interaction Handler ─────────────────────────────────────────────

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleJoin(interaction: any, env: Env): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) {
    return json({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });
  }

  const game = parseGameFromEmbed(interaction.message);
  if (!game) {
    return json({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });
  }

  if (game.players.includes(userId)) {
    return json({ type: 4, data: { content: "❌ Tu es déjà dans cette partie!", flags: 64 } });
  }
  if (game.players.length >= game.maxPlayers) {
    return json({ type: 4, data: { content: "❌ La partie est pleine!", flags: 64 } });
  }

  // Respond immediately to Discord (must be within 3 seconds)
  // Then do the heavy work in the background
  const token = env.DISCORD_BOT_TOKEN;

  // We need to respond fast, so defer the update and do it after
  // Actually, Discord gives us 3s. Let's try doing it all inline first.

  game.players.push(userId);

  // Channel permission
  await setChannelPermission(token, game.gameChannelId, userId, {
    allow: String(1 << 10),
    deny: String(1 << 11),
    type: 1,
  });

  // Update embed
  const channelId = interaction.channel_id;
  const messageId = interaction.message.id;
  await editMessage(token, channelId, messageId, buildGameEmbed(game));

  // Get player name
  const member: any = await getGuildMember(token, game.guildId, userId);
  const playerName = member.nick || member.user.global_name || member.user.username;

  // Send join message in game channel
  await sendMessage(token, game.gameChannelId, {
    content: `**${playerName}** a rejoint la partie! (${game.players.length}/${game.maxPlayers})`,
  });

  // Full → announce start
  if (game.players.length >= game.maxPlayers) {
    await sendMessage(token, game.gameChannelId, {
      embeds: [
        {
          title: "🎮 La partie est pleine!",
          description: "La partie de Loup-Garou va commencer...",
          color: 0x00ff00,
        },
      ],
    });
  } else if (game.players.length === MIN_PLAYERS) {
    await sendMessage(token, game.gameChannelId, {
      embeds: [
        {
          title: "✅ Minimum de joueurs atteint!",
          description: [
            `**${MIN_PLAYERS}** joueurs sont prêts.`,
            "",
            `<@${game.creatorId}> peut lancer la partie avec \`/start\`.`,
            "",
            "Ou attendez que plus de joueurs rejoignent...",
          ].join("\n"),
          color: 0xffa500,
        },
      ],
    });
  }

  return json({
    type: 4,
    data: {
      content: `✅ Tu as rejoint la Partie #${game.gameNumber}! Regarde le salon <#${game.gameChannelId}>`,
      flags: 64,
    },
  });
}

// ── Worker Entry Point ──────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("🐺 Garou Interaction Server", { status: 200 });
    }

    const signature = req.headers.get("x-signature-ed25519");
    const timestamp = req.headers.get("x-signature-timestamp");
    const body = await req.text();

    if (!signature || !timestamp || !verifySignature(body, signature, timestamp, env.DISCORD_PUBLIC_KEY)) {
      return new Response("Invalid signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    // PING handshake
    if (interaction.type === 1) {
      return json({ type: 1 });
    }

    // BUTTON click
    if (interaction.type === 3) {
      const customId: string = interaction.data?.custom_id || "";
      if (customId.startsWith("join_game_")) {
        return await handleJoin(interaction, env);
      }
    }

    return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
  },
};
