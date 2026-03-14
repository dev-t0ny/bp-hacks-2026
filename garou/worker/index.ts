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

function deleteMessage(token: string, channelId: string, messageId: string) {
  return discordFetch(token, `/channels/${channelId}/messages/${messageId}`, { method: "DELETE" });
}

function createChannel(token: string, guildId: string, body: Record<string, unknown>) {
  return discordFetch(token, `/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function deleteChannel(token: string, channelId: string) {
  return discordFetch(token, `/channels/${channelId}`, { method: "DELETE" });
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

function deleteChannelPermission(token: string, channelId: string, targetId: string) {
  return discordFetch(token, `/channels/${channelId}/permissions/${targetId}`, { method: "DELETE" });
}

function getGuildMember(token: string, guildId: string, userId: string) {
  return discordFetch(token, `/guilds/${guildId}/members/${userId}`);
}

function getBotUser(token: string) {
  return discordFetch(token, "/users/@me");
}

function createDM(token: string, userId: string) {
  return discordFetch(token, "/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: userId }),
  });
}

function editOriginalInteractionResponse(appId: string, interactionToken: string, body: Record<string, unknown>) {
  return fetch(`${DISCORD_API}/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Game State ──────────────────────────────────────────────────────

const EMBED_COLOR = 0x8b0000;
const EMBED_COLOR_GREEN = 0x2ecc71;
const EMBED_COLOR_ORANGE = 0xe67e22;
const WEREWOLF_IMAGE = "https://i.imgur.com/JfOLPcY.png";
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 20;

// ── Roles ───────────────────────────────────────────────────────────

interface Role {
  name: string;
  emoji: string;
  team: "village" | "loups";
  description: string;
}

const ROLES: Record<string, Role> = {
  loup: {
    name: "Loup-Garou",
    emoji: "🐺",
    team: "loups",
    description: "Chaque nuit, éliminez un villageois avec votre meute. Ne vous faites pas démasquer!",
  },
  sorciere: {
    name: "Sorcière",
    emoji: "🧪",
    team: "village",
    description: "Vous avez une potion de vie et une potion de mort. Utilisez-les avec sagesse.",
  },
  cupidon: {
    name: "Cupidon",
    emoji: "💘",
    team: "village",
    description: "Au début de la partie, liez deux joueurs par l'amour. Si l'un meurt, l'autre aussi.",
  },
  villageois: {
    name: "Villageois",
    emoji: "🧑‍🌾",
    team: "village",
    description: "Trouvez et éliminez les loups-garous lors des votes du village. Votre instinct est votre arme.",
  },
};

function assignRoles(playerCount: number): string[] {
  // Fixed: 2 loups, 1 sorcière, 1 cupidon, reste = villageois
  const roles: string[] = ["loup", "loup", "sorciere", "cupidon"];
  for (let i = roles.length; i < playerCount; i++) {
    roles.push("villageois");
  }
  // Shuffle (Fisher-Yates)
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j]!, roles[i]!];
  }
  return roles;
}

interface GameState {
  gameNumber: number;
  creatorId: string;
  creatorName: string;
  guildId: string;
  gameChannelId: string;
  maxPlayers: number;
  players: string[];
  lobbyMessageId?: string;
  announceChannelId?: string;
  announceMessageId?: string;
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
    lm: game.lobbyMessageId,
    ac: game.announceChannelId,
    am: game.announceMessageId,
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
      lobbyMessageId: compact.lm,
      announceChannelId: compact.ac,
      announceMessageId: compact.am,
    };
  } catch {
    return null;
  }
}

// ── Embed Builders ──────────────────────────────────────────────────

function progressBar(current: number, max: number): string {
  return "🌕".repeat(current) + "🌑".repeat(max - current);
}

function buildAnnounceEmbed(game: GameState) {
  const playerCount = game.players.length;
  const isFull = playerCount >= game.maxPlayers;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  const lines = [
    progressBar(playerCount, game.maxPlayers),
    `**${playerCount}/${game.maxPlayers}** joueurs`,
    "",
  ];

  if (playerCount > 0) {
    lines.push(game.players.map((id) => `> <@${id}>`).join("\n"));
    lines.push("");
  }

  lines.push(
    isFull ? "**La partie est pleine!**" : "Cliquez sur le bouton ci-dessous pour rejoindre!"
  );

  return {
    embeds: [
      {
        title: `🐺 Partie de Loup-Garou #${game.gameNumber}`,
        url: stateUrl,
        description: lines.join("\n"),
        color: isFull ? EMBED_COLOR_GREEN : EMBED_COLOR,
        image: { url: WEREWOLF_IMAGE },
        footer: { text: `Créée par ${game.creatorName}` },
        timestamp: new Date().toISOString(),
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

function buildLobbyEmbed(game: GameState, lastEvent?: string) {
  const playerCount = game.players.length;
  const isFull = playerCount >= game.maxPlayers;
  const canStart = playerCount >= MIN_PLAYERS;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  // Player list with empty slots
  const playerLines = game.players.map((id) => {
    const icon = id === game.creatorId ? "👑" : "🐺";
    return `${icon} <@${id}>`;
  });
  for (let i = playerCount; i < game.maxPlayers; i++) {
    playerLines.push("⬜ *En attente...*");
  }

  const statusEmoji = isFull ? "🟢" : canStart ? "🟡" : "🔴";
  const statusText = isFull
    ? "La partie est pleine! Prêt à lancer."
    : canStart
      ? "Prêt à lancer ou en attente de joueurs..."
      : `En attente de joueurs (min. ${MIN_PLAYERS})`;

  const lines = [
    progressBar(playerCount, game.maxPlayers),
    `${statusEmoji} **${playerCount}/${game.maxPlayers}** — ${statusText}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    ...playerLines,
  ];

  if (lastEvent) {
    lines.push("", "━━━━━━━━━━━━━━━━━━━━", "", `📋 *${lastEvent}*`);
  }

  const buttons: any[] = [];
  if (canStart) {
    buttons.push({
      type: 2,
      style: 3,
      label: "▶️ Lancer la partie",
      custom_id: `start_game_${game.gameNumber}`,
    });
  }
  buttons.push({
    type: 2,
    style: 4,
    label: "🚪 Quitter la partie",
    custom_id: `quit_game_${game.gameNumber}`,
  });

  return {
    embeds: [
      {
        title: `🐺 Salle d'attente — Partie #${game.gameNumber}`,
        url: stateUrl,
        description: lines.join("\n"),
        color: canStart ? (isFull ? EMBED_COLOR_GREEN : EMBED_COLOR_ORANGE) : EMBED_COLOR,
        thumbnail: { url: WEREWOLF_IMAGE },
        footer: { text: `Créée par ${game.creatorName}` },
        timestamp: new Date().toISOString(),
      },
    ],
    components: [{ type: 1, components: buttons }],
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
  const created: any = await createChannel(token, guildId, { name: "Loup-Garou", type: 4 });
  return created.id;
}

async function getNextGameNumber(token: string, guildId: string, categoryId: string): Promise<number> {
  const channels: any[] = await getGuildChannels(token, guildId);
  const gameChannels = channels.filter(
    (c: any) => c.parent_id === categoryId && c.name.startsWith("partie-")
  );
  return gameChannels.length + 1;
}

async function updateAllEmbeds(token: string, game: GameState, lastEvent?: string) {
  const promises: Promise<any>[] = [];
  if (game.lobbyMessageId) {
    promises.push(editMessage(token, game.gameChannelId, game.lobbyMessageId, buildLobbyEmbed(game, lastEvent)));
  }
  if (game.announceChannelId && game.announceMessageId) {
    promises.push(editMessage(token, game.announceChannelId, game.announceMessageId, buildAnnounceEmbed(game)));
  }
  await Promise.all(promises);
}

// ── /loupgarou ──────────────────────────────────────────────────────

async function handleSlashCommand(interaction: any, env: Env): Promise<Response> {
  const token = env.DISCORD_BOT_TOKEN;
  const appId = interaction.application_id;
  const interactionToken = interaction.token;
  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  const userId = interaction.member?.user?.id;

  if (!guildId || !channelId || !userId) {
    return json({ type: 4, data: { content: "❌ Cette commande ne fonctionne que dans un serveur Discord.", flags: 64 } });
  }

  const maxPlayers = interaction.data?.options?.find((o: any) => o.name === "joueurs")?.value;
  if (!maxPlayers || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
    return json({ type: 4, data: { content: `❌ Le nombre de joueurs doit être entre ${MIN_PLAYERS} et ${MAX_PLAYERS}.`, flags: 64 } });
  }

  const deferredResponse = json({ type: 5 });

  const backgroundWork = (async () => {
    try {
      const member: any = await getGuildMember(token, guildId, userId);
      const creatorName = member.nick || member.user.global_name || member.user.username;
      const categoryId = await findOrCreateCategory(token, guildId);
      const gameNumber = await getNextGameNumber(token, guildId, categoryId);
      const botUser: any = await getBotUser(token);

      const gameChannel: any = await createChannel(token, guildId, {
        name: `partie-${gameNumber}`,
        type: 0,
        parent_id: categoryId,
        permission_overwrites: [
          { id: guildId, type: 0, deny: String(1 << 10) },
          { id: botUser.id, type: 1, allow: String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 15)) },
        ],
      });

      const gameState: GameState = {
        gameNumber,
        creatorId: userId,
        creatorName,
        guildId,
        gameChannelId: gameChannel.id,
        maxPlayers,
        players: [],
        announceChannelId: channelId,
      };

      // Send lobby embed in game channel
      const lobbyMsg: any = await sendMessage(token, gameChannel.id, buildLobbyEmbed(gameState));
      gameState.lobbyMessageId = lobbyMsg.id;

      // Edit deferred response with announce embed
      await editOriginalInteractionResponse(appId, interactionToken, buildAnnounceEmbed(gameState));

      // Get announce message ID
      const origRes = await fetch(
        `${DISCORD_API}/webhooks/${appId}/${interactionToken}/messages/@original`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (origRes.ok) {
        const origMsg: any = await origRes.json();
        gameState.announceMessageId = origMsg.id;
      }

      // Re-edit both with complete state (now includes all message IDs)
      await updateAllEmbeds(token, gameState);
    } catch (err) {
      console.error("Error in /loupgarou handler:", err);
      try {
        await editOriginalInteractionResponse(appId, interactionToken, {
          content: "❌ Une erreur est survenue lors de la création de la partie.",
        });
      } catch {}
    }
  })();

  (globalThis as any).__backgroundWork = backgroundWork;
  return deferredResponse;
}

// ── Join ────────────────────────────────────────────────────────────

async function handleJoin(interaction: any, env: Env): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });

  const game = parseGameFromEmbed(interaction.message);
  if (!game) return json({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });
  if (game.players.includes(userId)) return json({ type: 4, data: { content: "❌ Tu es déjà dans cette partie!", flags: 64 } });
  if (game.players.length >= game.maxPlayers) return json({ type: 4, data: { content: "❌ La partie est pleine!", flags: 64 } });

  const token = env.DISCORD_BOT_TOKEN;
  game.players.push(userId);

  await setChannelPermission(token, game.gameChannelId, userId, {
    allow: String(1 << 10),
    deny: String(1 << 11),
    type: 1,
  });

  const member: any = await getGuildMember(token, game.guildId, userId);
  const playerName = member.nick || member.user.global_name || member.user.username;

  await updateAllEmbeds(token, game, `${playerName} a rejoint la partie`);

  return json({
    type: 4,
    data: {
      content: `✅ Tu as rejoint la Partie #${game.gameNumber}!`,
      flags: 64,
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: "🐺 Aller au salon", url: `https://discord.com/channels/${game.guildId}/${game.gameChannelId}` },
          ],
        },
      ],
    },
  });
}

// ── Quit ────────────────────────────────────────────────────────────

async function handleQuit(interaction: any, env: Env): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });

  const game = parseGameFromEmbed(interaction.message);
  if (!game) return json({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });
  if (!game.players.includes(userId)) return json({ type: 4, data: { content: "❌ Tu n'es pas dans cette partie.", flags: 64 } });

  const token = env.DISCORD_BOT_TOKEN;
  game.players = game.players.filter((id) => id !== userId);

  try { await deleteChannelPermission(token, game.gameChannelId, userId); } catch {}

  const member: any = await getGuildMember(token, game.guildId, userId);
  const playerName = member.nick || member.user.global_name || member.user.username;

  // No players left → delete everything
  if (game.players.length === 0) {
    try { await deleteChannel(token, game.gameChannelId); } catch {}
    if (game.announceChannelId && game.announceMessageId) {
      try { await deleteMessage(token, game.announceChannelId, game.announceMessageId); } catch {}
    }
    return json({ type: 4, data: { content: `🗑️ La Partie #${game.gameNumber} a été supprimée (plus aucun joueur).`, flags: 64 } });
  }

  // Creator left → transfer
  let lastEvent: string;
  if (userId === game.creatorId) {
    const newCreatorId = game.players[Math.floor(Math.random() * game.players.length)]!;
    game.creatorId = newCreatorId;
    const newCreatorMember: any = await getGuildMember(token, game.guildId, newCreatorId);
    game.creatorName = newCreatorMember.nick || newCreatorMember.user.global_name || newCreatorMember.user.username;
    lastEvent = `${playerName} a quitté — ${game.creatorName} est le nouveau créateur`;
  } else {
    lastEvent = `${playerName} a quitté la partie`;
  }

  await updateAllEmbeds(token, game, lastEvent);

  return json({ type: 4, data: { content: `🚪 Tu as quitté la Partie #${game.gameNumber}.`, flags: 64 } });
}

// ── Start ───────────────────────────────────────────────────────────

async function handleStart(interaction: any, env: Env): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });

  const game = parseGameFromEmbed(interaction.message);
  if (!game) return json({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });

  if (userId !== game.creatorId) {
    return json({ type: 4, data: { content: `❌ Seul le créateur (<@${game.creatorId}>) peut lancer la partie.`, flags: 64 } });
  }
  if (game.players.length < MIN_PLAYERS) {
    return json({ type: 4, data: { content: `❌ Il faut au minimum ${MIN_PLAYERS} joueurs pour lancer.`, flags: 64 } });
  }

  const token = env.DISCORD_BOT_TOKEN;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  // Assign roles
  const roleKeys = assignRoles(game.players.length);
  const playerRoles = game.players.map((id, i) => ({ id, roleKey: roleKeys[i]!, role: ROLES[roleKeys[i]!]! }));

  // DM each player their role
  const dmPromises = playerRoles.map(async ({ id, role }) => {
    try {
      const dm: any = await createDM(token, id);
      await sendMessage(token, dm.id, {
        embeds: [
          {
            title: `${role.emoji} Tu es **${role.name}**`,
            description: [
              role.description,
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              `🎮 **Partie #${game.gameNumber}**`,
              `👥 **${game.players.length} joueurs**`,
              `⚔️ Équipe: **${role.team === "loups" ? "Loups-Garous" : "Village"}**`,
            ].join("\n"),
            color: role.team === "loups" ? EMBED_COLOR : EMBED_COLOR_GREEN,
            thumbnail: { url: WEREWOLF_IMAGE },
            footer: { text: "Ne révèle ton rôle à personne!" },
          },
        ],
      });
    } catch (err) {
      console.error(`Failed to DM role to ${id}:`, err);
    }
  });
  await Promise.all(dmPromises);

  // Build role summary for game channel (no spoilers — just team counts)
  const loupCount = playerRoles.filter((p) => p.role.team === "loups").length;
  const villageCount = playerRoles.filter((p) => p.role.team === "village").length;

  // Update lobby embed — remove buttons, show "started"
  if (game.lobbyMessageId) {
    await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
      embeds: [
        {
          title: `🎮 Partie #${game.gameNumber} — En cours!`,
          url: stateUrl,
          description: [
            `**${game.players.length} joueurs:**`,
            "",
            ...game.players.map((id) => `🐺 <@${id}>`),
            "",
            "━━━━━━━━━━━━━━━━━━━━",
            "",
            `🐺 **${loupCount}** loup${loupCount > 1 ? "s" : ""} rôdent parmi vous...`,
            `🏘️ **${villageCount}** villageois doivent survivre.`,
          ].join("\n"),
          color: EMBED_COLOR_GREEN,
          thumbnail: { url: WEREWOLF_IMAGE },
          footer: { text: "Les rôles ont été distribués en DM!" },
        },
      ],
      components: [],
    });
  }

  // Update announce embed — remove join button
  if (game.announceChannelId && game.announceMessageId) {
    await editMessage(token, game.announceChannelId, game.announceMessageId, {
      embeds: [
        {
          title: `🎮 Partie #${game.gameNumber} — En cours!`,
          url: stateUrl,
          description: [`Lancée par <@${game.creatorId}>`, "", `**${game.players.length} joueurs**`].join("\n"),
          color: EMBED_COLOR_GREEN,
          image: { url: WEREWOLF_IMAGE },
          footer: { text: "La partie est en cours!" },
        },
      ],
      components: [],
    });
  }

  await sendMessage(token, game.gameChannelId, {
    content: [
      "# 🌕 La nuit tombe sur le village...",
      "",
      `**${game.players.length} joueurs** ont reçu leur rôle en message privé.`,
      "",
      `> 🐺 **${loupCount}** loup${loupCount > 1 ? "s-garous se cachent" : "-garou se cache"} parmi vous`,
      `> 🏘️ **${villageCount}** membres du village doivent les démasquer`,
      "",
      "*Consultez vos DMs pour découvrir votre rôle!*",
    ].join("\n"),
  });

  return json({ type: 4, data: { content: `🎮 La Partie #${game.gameNumber} a été lancée! Vérifie tes DMs pour ton rôle.`, flags: 64 } });
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

    if (interaction.type === 1) return json({ type: 1 });

    if (interaction.type === 2) {
      if (interaction.data?.name === "loupgarou") {
        const response = await handleSlashCommand(interaction, env);
        const bgWork = (globalThis as any).__backgroundWork;
        if (bgWork) {
          ctx.waitUntil(bgWork);
          (globalThis as any).__backgroundWork = null;
        }
        return response;
      }
    }

    if (interaction.type === 3) {
      const customId: string = interaction.data?.custom_id || "";
      if (customId.startsWith("join_game_")) return handleJoin(interaction, env);
      if (customId.startsWith("quit_game_")) return handleQuit(interaction, env);
      if (customId.startsWith("start_game_")) return handleStart(interaction, env);
    }

    return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
  },
};
