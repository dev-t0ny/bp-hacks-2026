import nacl from "tweetnacl";

interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  ACTIVE_PLAYERS: KVNamespace;
}

const PLAYER_TTL = 86400;

async function markPlayerActive(kv: KVNamespace, userId: string, gameNumber: number) {
  await kv.put(`player:${userId}`, String(gameNumber), { expirationTtl: PLAYER_TTL });
}
async function clearPlayerActive(kv: KVNamespace, userId: string) {
  await kv.delete(`player:${userId}`);
}
async function getActiveGame(kv: KVNamespace, userId: string): Promise<number | null> {
  const val = await kv.get(`player:${userId}`);
  return val ? parseInt(val, 10) : null;
}
async function clearAllPlayersForGame(kv: KVNamespace, playerIds: string[]) {
  await Promise.all(playerIds.map((id) => clearPlayerActive(kv, id)));
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
  wolfChannelId?: string;
  roles?: Record<string, string>; // playerId → roleKey (set after game starts)
  seen?: string[]; // player IDs who have viewed their role
}

function encodeState(game: GameState): string {
  const compact: Record<string, unknown> = {
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
    wc: game.wolfChannelId,
  };
  if (game.roles) compact.r = game.roles;
  if (game.seen?.length) compact.s = game.seen;
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
      wolfChannelId: compact.wc,
      roles: compact.r,
      seen: compact.s ?? [],
    };
  } catch {
    return null;
  }
}

function buildRoleCheckEmbed(game: GameState) {
  const seen = game.seen ?? [];
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  const playerLines = game.players.map((id) => {
    const checked = seen.includes(id);
    return `${checked ? "✅" : "⬜"} <@${id}>`;
  });

  return {
    embeds: [{
      title: `🔮 Découvrez vos rôles — Partie #${game.gameNumber}`,
      url: stateUrl,
      description: [
        "Cliquez sur le bouton pour découvrir votre rôle en **secret**.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...playerLines,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `✅ **${seen.length}/${game.players.length}** ont vu leur rôle`,
      ].join("\n"),
      color: EMBED_COLOR_PURPLE,
      thumbnail: { url: WEREWOLF_IMAGE },
      footer: { text: "🤫 Ne révèle ton rôle à personne!" },
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 1,
        label: "🔮 Voir mon rôle",
        custom_id: `reveal_role_${game.gameNumber}`,
      }],
    }],
  };
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getMessage(token: string, channelId: string, messageId: string) {
  return discordFetch(token, `/channels/${channelId}/messages/${messageId}`);
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

async function handleSlashCommand(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
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

  // Check if creator is already in a game
  const activeGame = await getActiveGame(env.ACTIVE_PLAYERS, userId);
  if (activeGame !== null) {
    return json({ type: 4, data: { content: `❌ Tu es déjà dans la Partie #${activeGame}. Quitte-la avant d'en créer une nouvelle.`, flags: 64 } });
  }

  const deferredResponse = json({ type: 5 });

  const backgroundWork = (async () => {
    try {
      // Mark creator as active
      await markPlayerActive(env.ACTIVE_PLAYERS, userId, 0); // will update with real game number below

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
          { id: userId, type: 1, allow: String(1 << 10) },
        ],
      });

      // Update KV with real game number
      await markPlayerActive(env.ACTIVE_PLAYERS, userId, gameNumber);

      const gameState: GameState = {
        gameNumber,
        creatorId: userId,
        creatorName,
        guildId,
        gameChannelId: gameChannel.id,
        maxPlayers,
        players: [userId],
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

  ctx.waitUntil(backgroundWork);
  return deferredResponse;
}

// ── Join ────────────────────────────────────────────────────────────

async function handleJoin(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });

  const game = parseGameFromEmbed(interaction.message);
  if (!game) return json({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });
  if (game.players.includes(userId)) return json({ type: 4, data: { content: "❌ Tu es déjà dans cette partie!", flags: 64 } });
  if (game.players.length >= game.maxPlayers) return json({ type: 4, data: { content: "❌ La partie est pleine!", flags: 64 } });

  // Check if player is already in another game
  const activeGame = await getActiveGame(env.ACTIVE_PLAYERS, userId);
  if (activeGame !== null) {
    return json({ type: 4, data: { content: `❌ Tu es déjà dans la Partie #${activeGame}. Quitte-la avant d'en rejoindre une autre.`, flags: 64 } });
  }

  const token = env.DISCORD_BOT_TOKEN;
  game.players.push(userId);

  await markPlayerActive(env.ACTIVE_PLAYERS, userId, game.gameNumber);

  await setChannelPermission(token, game.gameChannelId, userId, {
    allow: String(1 << 10),
    deny: String(1 << 11),
    type: 1,
  });

  const member: any = await getGuildMember(token, game.guildId, userId);
  const playerName = member.nick || member.user.global_name || member.user.username;

  await updateAllEmbeds(token, game, `${playerName} a rejoint la partie`);

  // Game is full → start countdown
  if (game.players.length >= game.maxPlayers) {
    ctx.waitUntil(runCountdown(token, game, ctx, env));
  }

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

  // Clear player from active games
  await clearPlayerActive(env.ACTIVE_PLAYERS, userId);

  try { await deleteChannelPermission(token, game.gameChannelId, userId); } catch {}

  const member: any = await getGuildMember(token, game.guildId, userId);
  const playerName = member.nick || member.user.global_name || member.user.username;

  // No players left → delete everything
  if (game.players.length === 0) {
    // Clear all remaining players (safety)
    await clearAllPlayersForGame(env.ACTIVE_PLAYERS, [userId]);
    try { await deleteChannel(token, game.gameChannelId); } catch {}
    if (game.wolfChannelId) {
      try { await deleteChannel(token, game.wolfChannelId); } catch {}
    }
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

// ── Game Start (animated role reveal) ────────────────────────────────

const COUNTDOWN_SECONDS = 30;
const EMBED_COLOR_NIGHT = 0x0d1b2a;
const EMBED_COLOR_PURPLE = 0x6c3483;

// ── Self-invoke: call the worker itself to run the next phase ──
// Each phase stays under 30s to respect Cloudflare free plan waitUntil limits.
const WORKER_URL = "https://garou-interactions.gabgingras.workers.dev";

function triggerPhase(ctx: ExecutionContext, env: Env, phase: string, game: GameState) {
  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal": env.DISCORD_BOT_TOKEN,
      },
      body: JSON.stringify({ phase, game }),
    }).catch((err) => console.error(`Phase ${phase} trigger failed:`, err))
  );
}

async function startGame(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  if (!game.lobbyMessageId) return;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  // ── Phase 1: Night falls ──
  await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
    embeds: [
      {
        title: "🌑 La nuit tombe sur le village...",
        url: stateUrl,
        description: [
          "",
          "```",
          "     🌕",
          "   ·  ✦  ·  ✧  ·",
          " ✧    ·    ✦    ·",
          "   ·  ✦  ·  ✧  ·",
          "  🌲🌲🌲🌲🌲🌲🌲🌲",
          "```",
          "",
          "*Les villageois s'endorment...*",
          "*Quelque chose rôde dans l'ombre...*",
        ].join("\n"),
        color: EMBED_COLOR_NIGHT,
        image: { url: WEREWOLF_IMAGE },
      },
    ],
    components: [],
  });

  await sleep(3000);

  // ── Phase 2: Distributing roles ──
  await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
    embeds: [
      {
        title: "🃏 Le destin se révèle...",
        url: stateUrl,
        description: [
          "",
          "```",
          " ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐",
          " │ 🐺  │ │ 🧪  │ │ 💘  │ │  ?  │",
          " │     │ │     │ │     │ │     │",
          " │ ??? │ │ ??? │ │ ??? │ │ ??? │",
          " └─────┘ └─────┘ └─────┘ └─────┘",
          "```",
          "",
          `**${game.players.length} cartes** sont distribuées face cachée...`,
          "",
          "*Chaque joueur reçoit son destin en message privé.*",
        ].join("\n"),
        color: EMBED_COLOR_PURPLE,
      },
    ],
    components: [],
  });

  // ── Assign roles ──
  const roleKeys = assignRoles(game.players.length);
  const rolesMap: Record<string, string> = {};
  game.players.forEach((id, i) => { rolesMap[id] = roleKeys[i]!; });
  game.roles = rolesMap;

  const playerRoles = game.players.map((id) => ({ id, roleKey: rolesMap[id]!, role: ROLES[rolesMap[id]!]! }));

  // ── Create hidden wolf channel ──
  const wolfPlayerIds = playerRoles.filter((p) => p.role.team === "loups").map((p) => p.id);
  const botUser: any = await getBotUser(token);
  const categoryId = await findOrCreateCategory(token, game.guildId);

  const wolfChannel: any = await createChannel(token, game.guildId, {
    name: `taniere-partie-${game.gameNumber}`,
    type: 0,
    parent_id: categoryId,
    topic: `🐺 Canal secret des Loups-Garous — Partie #${game.gameNumber}`,
    permission_overwrites: [
      { id: game.guildId, type: 0, deny: String(1 << 10) },
      { id: botUser.id, type: 1, allow: String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 15)) },
      ...wolfPlayerIds.map((id) => ({
        id,
        type: 1 as const,
        allow: String(1 << 10),
        deny: String(1 << 11),
      })),
    ],
  });
  game.wolfChannelId = wolfChannel.id;

  await sendMessage(token, wolfChannel.id, {
    embeds: [{
      title: "🐺 Bienvenue dans la Tanière",
      description: [
        "```",
        "  🌑  Canal secret des Loups-Garous",
        "  👁️  Invisible aux villageois",
        "```",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...wolfPlayerIds.map((id) => `🐺 <@${id}>`),
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "Complotez ici en toute discrétion.",
        "Personne d'autre ne peut voir ce canal.",
      ].join("\n"),
      color: EMBED_COLOR_NIGHT,
      image: { url: WEREWOLF_IMAGE },
      footer: { text: `Partie #${game.gameNumber} — Les villageois dorment` },
      timestamp: new Date().toISOString(),
    }],
  });

  await sleep(3000);

  // ── Phase 3: Role check ──
  game.seen = [];
  await editMessage(token, game.gameChannelId, game.lobbyMessageId, buildRoleCheckEmbed(game));

  if (game.announceChannelId && game.announceMessageId) {
    await editMessage(token, game.announceChannelId, game.announceMessageId, {
      embeds: [{
        title: `🎮 Partie #${game.gameNumber} — En cours!`,
        url: `https://garou.bot/s/${encodeState(game)}`,
        description: [`Lancée par <@${game.creatorId}>`, "", `**${game.players.length} joueurs** — Les rôles sont distribués!`].join("\n"),
        color: EMBED_COLOR_GREEN,
        image: { url: WEREWOLF_IMAGE },
        footer: { text: "La partie est en cours!" },
      }],
      components: [],
    });
  }

  // Hand off to role_check phase (polls every 5s, stays under 30s per invocation)
  triggerPhase(ctx, env, "role_check", game);
}

// ── Phase: role_check — poll until all players seen, then trigger countdown ──
async function phaseRoleCheck(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  const start = Date.now();
  const maxDuration = 25000; // stay under 30s
  while (Date.now() - start < maxDuration) {
    await sleep(5000);
    try {
      const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId!);
      const current = parseGameFromEmbed(msg);
      if (current?.seen?.length === game.players.length) {
        triggerPhase(ctx, env, "countdown", game);
        return;
      }
    } catch { break; }
  }
  // Not all seen yet and still under ROLE_CHECK_TIMEOUT? Re-invoke self.
  // Check elapsed time from game state (use embed title to detect if still in role check phase)
  try {
    const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId!);
    const title: string = msg.embeds?.[0]?.title ?? "";
    if (title.includes("Découvrez vos rôles")) {
      // Still in role check — re-invoke
      triggerPhase(ctx, env, "role_check", game);
    }
  } catch {
    // Timeout or error — just start the countdown anyway
    triggerPhase(ctx, env, "countdown", game);
  }
}

// ── Phase: countdown — 10s visible countdown then trigger night ──
async function phaseCountdown(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  // Re-read latest game state from embed (seen might have updated)
  try {
    const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId!);
    const latest = parseGameFromEmbed(msg);
    if (latest) game = latest;
  } catch {}

  const nightStateUrl = `https://garou.bot/s/${encodeState(game)}`;
  for (let remaining = GAME_START_DELAY; remaining > 0; remaining--) {
    try {
      const bar = "█".repeat(remaining) + "░".repeat(GAME_START_DELAY - remaining);
      await editMessage(token, game.gameChannelId, game.lobbyMessageId!, {
        embeds: [{
          title: `⏳ La partie débute dans ${remaining}s — Partie #${game.gameNumber}`,
          url: nightStateUrl,
          description: [
            "✅ Les rôles ont été distribués!",
            "",
            `\`${bar}\` **${remaining}s**`,
            "",
            "*Préparez-vous...*",
          ].join("\n"),
          color: EMBED_COLOR_ORANGE,
          thumbnail: { url: WEREWOLF_IMAGE },
          footer: { text: "🤫 Ne révèle ton rôle à personne!" },
        }],
        components: [],
      });
    } catch (err) {
      console.error("Countdown edit failed:", err);
    }
    await sleep(1000);
  }

  // Trigger the night phase
  triggerPhase(ctx, env, "night_village_sleeps", game);
}

// ── Phase: night_village_sleeps — "Le village s'endort" then trigger wolves wake ──
async function phaseVillageSleeps(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  const nightStateUrl = `https://garou.bot/s/${encodeState(game)}`;
  await editMessage(token, game.gameChannelId, game.lobbyMessageId!, {
    embeds: [{
      title: `🌙 Le village s'endort... — Partie #${game.gameNumber}`,
      url: nightStateUrl,
      description: [
        "*Chaque villageois ferme les yeux...*",
        "*Le silence envahit le village...*",
      ].join("\n"),
      color: EMBED_COLOR_NIGHT,
      thumbnail: { url: WEREWOLF_IMAGE },
    }],
    components: [],
  });

  await sleep(3000);

  // "Les loups-garous se réveillent"
  await editMessage(token, game.gameChannelId, game.lobbyMessageId!, {
    embeds: [{
      title: `🐺 Les loups-garous se réveillent... — Partie #${game.gameNumber}`,
      url: nightStateUrl,
      description: [
        "*Des ombres se faufilent dans la nuit...*",
        "*Les loups-garous ouvrent les yeux et choisissent leur victime.*",
        "",
        `⏰ Les loups ont **${NIGHT_VOTE_SECONDS} secondes** pour décider.`,
      ].join("\n"),
      color: EMBED_COLOR_NIGHT,
      thumbnail: { url: WEREWOLF_IMAGE },
    }],
    components: [],
  });

  // Trigger the wolf vote phase
  triggerPhase(ctx, env, "night_wolf_vote", game);
}

// ── Phase: night_wolf_vote — unlock tanière, ping wolves, wait for votes ──
async function phaseWolfVote(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  await startNightPhase(token, game);
}

// ── Countdown when game is full ──────────────────────────────────────

function isGameStarted(title: string): boolean {
  return title.includes("La nuit tombe") || title.includes("La chasse commence") || title.includes("Le destin")
    || title.includes("Le village s'endort") || title.includes("Les loups-garous se réveillent")
    || title.includes("Découvrez vos rôles") || title.includes("La partie débute");
}

async function runCountdown(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  if (!game.lobbyMessageId) return;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  for (let remaining = COUNTDOWN_SECONDS; remaining >= 0; remaining--) {
    // Check current state every tick
    try {
      const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
      const title: string = msg.embeds?.[0]?.title ?? "";
      if (isGameStarted(title)) return;
      const currentGame = parseGameFromEmbed(msg);
      if (!currentGame || currentGame.players.length < currentGame.maxPlayers) return;
    } catch {
      return;
    }

    if (remaining === 0) break; // Don't edit at 0, go straight to startGame

    // Edit embed every 5 seconds OR on the last 5 seconds (every second)
    if (remaining <= 5 || remaining % 5 === 0) {
      const filled = Math.round((remaining / COUNTDOWN_SECONDS) * 20);
      const bar = "▓".repeat(filled) + "░".repeat(20 - filled);

      try {
        await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
          embeds: [
            {
              title: `⏳ La partie commence dans ${remaining}s...`,
              url: stateUrl,
              description: [
                "",
                `\`${bar}\` **${remaining}s**`,
                "",
                "━━━━━━━━━━━━━━━━━━━━",
                "",
                ...game.players.map((id) => {
                  const icon = id === game.creatorId ? "👑" : "🐺";
                  return `${icon} <@${id}>`;
                }),
                "",
                "━━━━━━━━━━━━━━━━━━━━",
                "",
                `🟢 **${game.players.length}/${game.maxPlayers}** — Tous les joueurs sont prêts!`,
              ].join("\n"),
              color: EMBED_COLOR_ORANGE,
              thumbnail: { url: WEREWOLF_IMAGE },
              footer: { text: `👑 Le créateur peut lancer immédiatement` },
            },
          ],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 3,
                  label: `⏩ Commencer maintenant`,
                  custom_id: `skip_countdown_${game.gameNumber}`,
                },
                {
                  type: 2,
                  style: 4,
                  label: "🚪 Quitter la partie",
                  custom_id: `quit_game_${game.gameNumber}`,
                },
              ],
            },
          ],
        });
      } catch (err) {
        console.error("Countdown edit failed:", err);
      }
    }

    await sleep(1000);
  }

  // Auto-start: final safety check
  try {
    const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
    const title: string = msg.embeds?.[0]?.title ?? "";
    if (isGameStarted(title)) return;
    const currentGame = parseGameFromEmbed(msg);
    if (!currentGame || currentGame.players.length < MIN_PLAYERS) return;
    await startGame(token, currentGame, ctx, env);
  } catch (err) {
    console.error("Countdown auto-start failed:", err);
  }
}

// ── Night Phase (Wolf Vote) ──────────────────────────────────────────

const NIGHT_VOTE_SECONDS = 90;
const ROLE_CHECK_TIMEOUT = 120; // 2 minutes to check roles
const GAME_START_DELAY = 10; // 10s countdown before night

interface VoteState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  wolfChannelId: string;
  lobbyMessageId: string;
  wolves: string[];
  targets: { id: string; name: string }[];
  votes: Record<string, string>; // wolfId → targetId
  deadline: number; // Unix timestamp in seconds
}

function encodeVoteState(vote: VoteState): string {
  return btoa(JSON.stringify({
    g: vote.gameNumber, gi: vote.guildId, gc: vote.gameChannelId,
    wc: vote.wolfChannelId, lm: vote.lobbyMessageId,
    w: vote.wolves,
    t: vote.targets.map((t) => [t.id, t.name]),
    v: vote.votes, dl: vote.deadline,
  }));
}

function decodeVoteState(url: string): VoteState | null {
  try {
    const b64 = url.split("/v/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc,
      wolfChannelId: c.wc, lobbyMessageId: c.lm,
      wolves: c.w,
      targets: (c.t as [string, string][]).map(([id, name]) => ({ id, name })),
      votes: c.v ?? {}, deadline: c.dl,
    };
  } catch { return null; }
}

function parseVoteFromEmbed(message: any): VoteState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/v/")) return null;
  return decodeVoteState(embed.url);
}

function buildVoteEmbed(vote: VoteState) {
  const stateUrl = `https://garou.bot/v/${encodeVoteState(vote)}`;

  const voteLines = vote.wolves.map((wId) => {
    const targetId = vote.votes[wId];
    const target = targetId ? vote.targets.find((t) => t.id === targetId) : null;
    return `🐺 <@${wId}> → ${target ? `**${target.name}**` : "*(en attente...)*"}`;
  });

  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const target of vote.targets) {
    const voteCount = Object.values(vote.votes).filter((v) => v === target.id).length;
    currentRow.push({
      type: 2,
      style: voteCount > 0 ? 4 : 2,
      label: `${voteCount > 0 ? "🎯 " : ""}${target.name}`,
      custom_id: `vote_kill_${vote.gameNumber}_${target.id}`,
    });
    if (currentRow.length === 5) {
      buttonRows.push({ type: 1, components: currentRow });
      currentRow = [];
    }
  }
  if (currentRow.length > 0) {
    buttonRows.push({ type: 1, components: currentRow });
  }

  return {
    embeds: [{
      title: `🐺 Vote de la Nuit — Partie #${vote.gameNumber}`,
      url: stateUrl,
      description: [
        "**Qui les loups veulent-ils dévorer cette nuit?**",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...voteLines,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `⏰ Fin du vote <t:${vote.deadline}:R>`,
        "",
        "*Vote unanime = résolution immédiate*",
      ].join("\n"),
      color: EMBED_COLOR_NIGHT,
      thumbnail: { url: WEREWOLF_IMAGE },
    }],
    components: buttonRows,
  };
}

async function startNightPhase(token: string, game: GameState) {
  if (!game.wolfChannelId || !game.roles) return;

  const wolfIds = Object.entries(game.roles).filter(([_, r]) => r === "loup").map(([id]) => id);
  const targetIds = game.players.filter((id) => !wolfIds.includes(id));

  // Fetch target display names
  const targets = await Promise.all(
    targetIds.map(async (id) => {
      const member: any = await getGuildMember(token, game.guildId, id);
      return { id, name: member.nick || member.user.global_name || member.user.username };
    })
  );

  const deadline = Math.floor(Date.now() / 1000) + NIGHT_VOTE_SECONDS;

  const voteState: VoteState = {
    gameNumber: game.gameNumber,
    guildId: game.guildId,
    gameChannelId: game.gameChannelId,
    wolfChannelId: game.wolfChannelId,
    lobbyMessageId: game.lobbyMessageId!,
    wolves: wolfIds,
    targets,
    votes: {},
    deadline,
  };

  // Unlock wolf channel for writing
  for (const wolfId of wolfIds) {
    try {
      await setChannelPermission(token, game.wolfChannelId, wolfId, {
        allow: String((1 << 10) | (1 << 11)),  // VIEW + SEND
        deny: String(0),                         // clear deny
        type: 1,
      });
    } catch {}
  }

  // Tag wolves and send vote embed in wolf channel
  const wolfMentions = wolfIds.map((id) => `<@${id}>`).join(" ");
  await sendMessage(token, game.wolfChannelId, {
    content: `${wolfMentions}\n\n🌙 **La nuit est tombée!** Choisissez votre victime ci-dessous.`,
  });
  const voteMsg: any = await sendMessage(token, game.wolfChannelId, buildVoteEmbed(voteState));

  // Wait for timer to expire
  await sleep(NIGHT_VOTE_SECONDS * 1000);

  // Auto-resolve if not already resolved by unanimous vote
  try {
    const currentMsg: any = await getMessage(token, game.wolfChannelId, voteMsg.id);
    if (!currentMsg.components?.length) return; // Already resolved
    const currentVote = parseVoteFromEmbed(currentMsg);
    if (!currentVote) return;
    await resolveNightVote(token, currentVote, voteMsg.id);
  } catch (err) {
    console.error("Night auto-resolve failed:", err);
  }
}

async function resolveNightVote(token: string, vote: VoteState, voteMessageId: string) {
  // Safety: check if already resolved
  try {
    const check: any = await getMessage(token, vote.wolfChannelId, voteMessageId);
    if (!check.components?.length) return;
  } catch { return; }

  // Determine victim
  const voteCounts: Record<string, number> = {};
  for (const targetId of Object.values(vote.votes)) {
    voteCounts[targetId] = (voteCounts[targetId] ?? 0) + 1;
  }

  let victimId: string;
  const entries = Object.entries(voteCounts);

  if (entries.length === 0) {
    victimId = vote.targets[Math.floor(Math.random() * vote.targets.length)]!.id;
  } else {
    const maxVotes = Math.max(...entries.map(([_, c]) => c));
    const topTargets = entries.filter(([_, c]) => c === maxVotes).map(([id]) => id);
    victimId = topTargets.length === 1
      ? topTargets[0]!
      : topTargets[Math.floor(Math.random() * topTargets.length)]!;
  }

  const victim = vote.targets.find((t) => t.id === victimId)!;
  const stateUrl = `https://garou.bot/v/${encodeVoteState(vote)}`;

  // Edit vote embed — show result, remove buttons
  await editMessage(token, vote.wolfChannelId, voteMessageId, {
    embeds: [{
      title: `☠️ La meute a choisi — Partie #${vote.gameNumber}`,
      url: stateUrl,
      description: [
        `**${victim.name}** (<@${victim.id}>) sera dévoré(e) cette nuit.`,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...vote.wolves.map((wId) => {
          const targetId = vote.votes[wId];
          const target = targetId ? vote.targets.find((t) => t.id === targetId) : null;
          return `🐺 <@${wId}> → ${target ? target.name : "*(pas voté)*"}`;
        }),
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "*🔒 Canal en lecture seule jusqu'à la prochaine nuit.*",
      ].join("\n"),
      color: EMBED_COLOR,
      thumbnail: { url: WEREWOLF_IMAGE },
    }],
    components: [],
  });

  // Lock wolf channel
  for (const wolfId of vote.wolves) {
    try {
      await setChannelPermission(token, vote.wolfChannelId, wolfId, {
        allow: String(1 << 10),
        deny: String(1 << 11),
        type: 1,
      });
    } catch {}
  }

  // Announce in game channel
  await sendMessage(token, vote.gameChannelId, {
    embeds: [{
      title: "☀️ Le jour se lève...",
      description: [
        `Les villageois découvrent avec horreur que **${victim.name}** (<@${victim.id}>) a été dévoré(e) par les loups-garous cette nuit.`,
        "",
        "*Un moment de silence pour la victime...*",
      ].join("\n"),
      color: EMBED_COLOR,
      image: { url: WEREWOLF_IMAGE },
    }],
  });
}

async function handleVoteKill(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });

  const vote = parseVoteFromEmbed(interaction.message);
  if (!vote) return json({ type: 4, data: { content: "❌ Erreur: vote introuvable.", flags: 64 } });

  if (!vote.wolves.includes(userId)) {
    return json({ type: 4, data: { content: "❌ Seuls les loups-garous peuvent voter.", flags: 64 } });
  }

  // Check if time expired
  if (Math.floor(Date.now() / 1000) > vote.deadline) {
    return json({ type: 4, data: { content: "⏰ Le temps de vote est écoulé!", flags: 64 } });
  }

  // Extract target ID from custom_id: vote_kill_{gameNumber}_{targetId}
  const customId: string = interaction.data?.custom_id || "";
  const targetId = customId.replace(`vote_kill_${vote.gameNumber}_`, "");

  const target = vote.targets.find((t) => t.id === targetId);
  if (!target) return json({ type: 4, data: { content: "❌ Cible invalide.", flags: 64 } });

  // Record vote
  vote.votes[userId] = targetId;

  // Check if unanimous
  const allVoted = vote.wolves.every((wId) => vote.votes[wId]);
  const allSameTarget = allVoted && new Set(Object.values(vote.votes)).size === 1;

  if (allSameTarget) {
    // Unanimous! Resolve in background
    const token = env.DISCORD_BOT_TOKEN;
    ctx.waitUntil(resolveNightVote(token, vote, interaction.message.id));
    return json({ type: 7, data: buildVoteEmbed(vote) });
  }

  // Update embed with new vote
  return json({ type: 7, data: buildVoteEmbed(vote) });
}

// ── Reveal Role (ephemeral) ──────────────────────────────────────────

async function handleRevealRole(interaction: any, env: Env): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });

  const game = parseGameFromEmbed(interaction.message);
  if (!game) return json({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });
  if (!game.roles) return json({ type: 4, data: { content: "❌ Les rôles n'ont pas encore été distribués.", flags: 64 } });

  if (!game.players.includes(userId)) {
    return json({ type: 4, data: { content: "❌ Tu ne fais pas partie de cette partie.", flags: 64 } });
  }

  const roleKey = game.roles[userId];
  if (!roleKey) return json({ type: 4, data: { content: "❌ Aucun rôle trouvé pour toi.", flags: 64 } });

  const role = ROLES[roleKey]!;

  // Track that this player has seen their role
  // Fetch latest message to avoid race condition (multiple players clicking at once)
  const token = env.DISCORD_BOT_TOKEN;
  if (game.lobbyMessageId) {
    try {
      const latestMsg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
      const latest = parseGameFromEmbed(latestMsg);
      if (latest) game.seen = latest.seen ?? [];
    } catch {}
  }
  if (!game.seen) game.seen = [];
  if (!game.seen.includes(userId)) {
    game.seen.push(userId);
    if (game.lobbyMessageId) {
      try {
        await editMessage(token, game.gameChannelId, game.lobbyMessageId, buildRoleCheckEmbed(game));
      } catch {}
    }
  }

  // Build description lines
  const descLines = [
    "",
    `> ${role.description}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
  ];

  // Show wolf teammates if this player is a wolf
  if (roleKey === "loup") {
    const teammates = Object.entries(game.roles)
      .filter(([id, r]) => r === "loup" && id !== userId)
      .map(([id]) => `🐺 <@${id}>`);
    if (teammates.length > 0) {
      descLines.push(`**Tes coéquipiers:**`, ...teammates, "", "━━━━━━━━━━━━━━━━━━━━", "");
    }
  }

  descLines.push(
    `🎮 **Partie #${game.gameNumber}**`,
    `👥 **${game.players.length} joueurs**`,
    `⚔️ Équipe: **${role.team === "loups" ? "Loups-Garous 🐺" : "Village 🏘️"}**`,
  );

  return json({
    type: 4,
    data: {
      embeds: [
        {
          title: `${role.emoji} Tu es ${role.name}`,
          description: descLines.join("\n"),
          color: role.team === "loups" ? EMBED_COLOR : EMBED_COLOR_GREEN,
          thumbnail: { url: WEREWOLF_IMAGE },
          footer: { text: "🤫 Ne révèle ton rôle à personne!" },
        },
      ],
      flags: 64,
    },
  });
}

// ── Start (manual or skip countdown) ─────────────────────────────────

async function handleStart(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
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

  // Use deferred response + background for the animation
  ctx.waitUntil(startGame(token, game, ctx, env));
  return json({ type: 6 }); // ACK
}

async function handleSkipCountdown(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });

  const game = parseGameFromEmbed(interaction.message);
  if (!game) return json({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });

  if (userId !== game.creatorId) {
    return json({ type: 4, data: { content: `❌ Seul le créateur (<@${game.creatorId}>) peut sauter le compte à rebours.`, flags: 64 } });
  }

  const token = env.DISCORD_BOT_TOKEN;
  ctx.waitUntil(startGame(token, game, ctx, env));
  return json({ type: 6 }); // ACK
}

// ── Worker Entry Point ──────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("🐺 Garou Interaction Server", { status: 200 });
    }

    // ── Internal phase calls (self-invocation for long-running flows) ──
    const internalToken = req.headers.get("X-Internal");
    if (internalToken === env.DISCORD_BOT_TOKEN) {
      const { phase, game } = await req.json() as { phase: string; game: GameState };
      const token = env.DISCORD_BOT_TOKEN;
      try {
        if (phase === "role_check") await phaseRoleCheck(token, game, ctx, env);
        else if (phase === "countdown") await phaseCountdown(token, game, ctx, env);
        else if (phase === "night_village_sleeps") await phaseVillageSleeps(token, game, ctx, env);
        else if (phase === "night_wolf_vote") await phaseWolfVote(token, game, ctx, env);
        else console.error("Unknown phase:", phase);
      } catch (err) {
        console.error(`Phase ${phase} failed:`, err);
      }
      return new Response("OK", { status: 200 });
    }

    // ── Discord interaction handling ──
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
        return handleSlashCommand(interaction, env, ctx);
      }
    }

    if (interaction.type === 3) {
      const customId: string = interaction.data?.custom_id || "";

      if (customId.startsWith("join_game_")) return handleJoin(interaction, env, ctx);

      if (customId.startsWith("quit_game_")) return handleQuit(interaction, env);

      if (customId.startsWith("reveal_role_")) return handleRevealRole(interaction, env);

      if (customId.startsWith("vote_kill_")) return handleVoteKill(interaction, env, ctx);

      if (customId.startsWith("start_game_") || customId.startsWith("skip_countdown_")) {
        const handler = customId.startsWith("skip_countdown_") ? handleSkipCountdown : handleStart;
        return handler(interaction, env, ctx);
      }
    }

    return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
  },
};
