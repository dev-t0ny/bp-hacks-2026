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
    console.error(`Discord API ${res.status} ${path}: ${text}`);
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

function createChannel(token: string, guildId: string, body: Record<string, unknown>) {
  return discordFetch(token, `/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function getGuildChannels(token: string, guildId: string) {
  return discordFetch(token, `/guilds/${guildId}/channels`);
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

function getBotUser(token: string) {
  return discordFetch(token, "/users/@me");
}

function editOriginalInteractionResponse(appId: string, interactionToken: string, body: Record<string, unknown>) {
  // This endpoint doesn't use Bot auth — it uses the interaction token
  return fetch(`${DISCORD_API}/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Embed Builder ───────────────────────────────────────────────────

const EMBED_COLOR = 0x8b0000;
const WEREWOLF_IMAGE = "https://i.imgur.com/JfOLPcY.png";
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 20;

interface GameState {
  gameNumber: number;
  creatorId: string;
  creatorName: string;
  guildId: string;
  gameChannelId: string;
  maxPlayers: number;
  players: string[];
}

// Encode game state as base64 in embed URL (invisible to users)
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

function decodeState(url: string): GameState | null {
  try {
    const b64 = url.split("/s/")[1];
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

function buildGameEmbed(game: GameState) {
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

function parseGameFromEmbed(message: any): GameState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url) return null;
  return decodeState(embed.url);
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

// ── Helpers ─────────────────────────────────────────────────────────

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function findOrCreateCategory(token: string, guildId: string): Promise<string> {
  const channels: any[] = await getGuildChannels(token, guildId);
  const existing = channels.find(
    (c: any) => c.type === 4 && c.name.toLowerCase() === "loup-garou"
  );
  if (existing) return existing.id;

  const created: any = await createChannel(token, guildId, {
    name: "Loup-Garou",
    type: 4,
  });
  return created.id;
}

async function getNextGameNumber(token: string, guildId: string, categoryId: string): Promise<number> {
  const channels: any[] = await getGuildChannels(token, guildId);
  const gameChannels = channels.filter(
    (c: any) => c.parent_id === categoryId && c.name.startsWith("partie-")
  );
  return gameChannels.length + 1;
}

// ── Slash Command Handler (/loupgarou) ──────────────────────────────

async function handleSlashCommand(interaction: any, env: Env): Promise<Response> {
  const token = env.DISCORD_BOT_TOKEN;
  const appId = interaction.application_id;
  const interactionToken = interaction.token;
  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  const userId = interaction.member?.user?.id;

  if (!guildId || !channelId || !userId) {
    return json({
      type: 4,
      data: { content: "❌ Cette commande ne fonctionne que dans un serveur Discord.", flags: 64 },
    });
  }

  // Get the joueurs option
  const maxPlayers = interaction.data?.options?.find((o: any) => o.name === "joueurs")?.value;
  if (!maxPlayers || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
    return json({
      type: 4,
      data: { content: `❌ Le nombre de joueurs doit être entre ${MIN_PLAYERS} et ${MAX_PLAYERS}.`, flags: 64 },
    });
  }

  // Respond with DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (type 5) — shows "thinking..."
  // Then do the heavy work in the background
  const deferredResponse = json({ type: 5 });

  // Use waitUntil pattern for background work
  const ctx = { waitUntil: (p: Promise<any>) => p }; // Cloudflare provides this via ExecutionContext

  // Actually, we can't access executionContext in this function signature.
  // Instead, return the deferred response and handle the rest with a fetch to ourselves.
  // OR: we just do everything before responding (Discord gives us 3 seconds).
  // For safety, let's use the deferred approach properly.

  // We'll return the deferred response and schedule background work via a global promise
  const backgroundWork = (async () => {
    try {
      // Get creator info
      const member: any = await getGuildMember(token, guildId, userId);
      const creatorName = member.nick || member.user.global_name || member.user.username;

      // Find or create category
      const categoryId = await findOrCreateCategory(token, guildId);

      // Get game number
      const gameNumber = await getNextGameNumber(token, guildId, categoryId);

      // Get bot user for permissions
      const botUser: any = await getBotUser(token);

      // Create game channel
      const gameChannel: any = await createChannel(token, guildId, {
        name: `partie-${gameNumber}`,
        type: 0,
        parent_id: categoryId,
        permission_overwrites: [
          {
            id: guildId,
            type: 0,
            deny: String(1 << 10), // VIEW_CHANNEL denied for @everyone
          },
          {
            id: botUser.id,
            type: 1,
            allow: String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 15)),
          },
        ],
      });

      // Build game state
      const gameState: GameState = {
        gameNumber,
        creatorId: userId,
        creatorName,
        guildId,
        gameChannelId: gameChannel.id,
        maxPlayers,
        players: [],
      };

      // Edit the deferred response with the game embed
      const embedPayload = buildGameEmbed(gameState);
      await editOriginalInteractionResponse(appId, interactionToken, embedPayload);

      // Send welcome message in game channel
      await sendMessage(token, gameChannel.id, {
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
    } catch (err) {
      console.error("Error in /loupgarou handler:", err);
      // Try to edit the deferred response with an error message
      try {
        await editOriginalInteractionResponse(appId, interactionToken, {
          content: "❌ Une erreur est survenue lors de la création de la partie.",
        });
      } catch {}
    }
  })();

  // Store promise so Cloudflare doesn't kill it (handled via ctx.waitUntil in the main handler)
  (globalThis as any).__backgroundWork = backgroundWork;

  return deferredResponse;
}

// ── Button Handler (join game) ──────────────────────────────────────

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

  const token = env.DISCORD_BOT_TOKEN;
  game.players.push(userId);

  // Channel permission — allow view, deny send
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
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // APPLICATION_COMMAND (slash commands)
    if (interaction.type === 2) {
      const commandName = interaction.data?.name;
      if (commandName === "loupgarou") {
        const response = await handleSlashCommand(interaction, env);
        // Wait for background work to complete
        const bgWork = (globalThis as any).__backgroundWork;
        if (bgWork) {
          ctx.waitUntil(bgWork);
          (globalThis as any).__backgroundWork = null;
        }
        return response;
      }
    }

    // MESSAGE_COMPONENT (button clicks)
    if (interaction.type === 3) {
      const customId: string = interaction.data?.custom_id || "";
      if (customId.startsWith("join_game_")) {
        return await handleJoin(interaction, env);
      }
    }

    return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
  },
};
