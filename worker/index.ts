import nacl from "tweetnacl";
import {
  ALL_ROLES,
  VILLAGEOIS_GROUP_1,
  VILLAGEOIS_GROUP_2,
  LOUPS_ROLES,
  SOLITAIRE_ROLES,
  DEFAULT_PRESETS,
  rolesToBitmask,
  bitmaskToRoles,
  type PresetConfig,
} from "./roles";
import {
  type ConfigState,
  encodeConfigState,
  decodeConfigState,
  buildStep1Embed,
  buildStep2Embed,
  findPreset,
  updateRolesForGroup,
} from "./config-embed";

interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  ACTIVE_PLAYERS: KVNamespace;
  PRESETS_KV?: KVNamespace;
  VOICE_SERVICE_URL?: string;
  VOICE_SERVICE_TOKEN?: string;
}

const PLAYER_TTL = 86400;

async function markPlayerActive(kv: KVNamespace, userId: string, gameNumber: number, channelId: string) {
  await kv.put(`player:${userId}`, JSON.stringify({ g: gameNumber, ch: channelId }), { expirationTtl: PLAYER_TTL });
}
async function clearPlayerActive(kv: KVNamespace, userId: string) {
  await kv.delete(`player:${userId}`);
}
async function getActiveGame(kv: KVNamespace, token: string, userId: string): Promise<number | null> {
  const val = await kv.get(`player:${userId}`);
  if (!val) return null;

  let gameNumber: number;
  let channelId: string | undefined;
  try {
    const parsed = JSON.parse(val);
    if (typeof parsed === "number") {
      // Legacy format: plain number — clear it (no channel to verify)
      await kv.delete(`player:${userId}`);
      return null;
    }
    gameNumber = parsed.g;
    channelId = parsed.ch;
  } catch {
    // Unparseable — clear stale entry
    await kv.delete(`player:${userId}`);
    return null;
  }

  if (!channelId) {
    await kv.delete(`player:${userId}`);
    return null;
  }

  // Verify the game channel still exists
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.status === 404 || res.status === 403) {
      await kv.delete(`player:${userId}`);
      return null;
    }
  } catch {}

  return gameNumber;
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

function createThread(token: string, channelId: string, body: Record<string, unknown>) {
  return discordFetch(token, `/channels/${channelId}/threads`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function addThreadMember(token: string, threadId: string, userId: string) {
  return discordFetch(token, `/channels/${threadId}/thread-members/${userId}`, {
    method: "PUT",
  });
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
const ASSET_BASE = "https://raw.githubusercontent.com/dev-t0ny/bp-hacks-2026/main/garou/assets";
const WEREWOLF_IMAGE = `${ASSET_BASE}/scenes/game_start.png`;

// Scene images
const SCENE_IMAGES = {
  game_start: `${ASSET_BASE}/scenes/game_start.png`,
  night_falls: `${ASSET_BASE}/scenes/night_falls.png`,
  dawn_breaks: `${ASSET_BASE}/scenes/dawn_breaks.png`,
  night_kill: `${ASSET_BASE}/scenes/night_kill.png`,
  day_elimination: `${ASSET_BASE}/scenes/day_elimination.png`,
  victory_wolves: `${ASSET_BASE}/scenes/victory_wolves.png`,
  victory_village: `${ASSET_BASE}/scenes/victory_village.png`,
  snipe_reveal: `${ASSET_BASE}/scenes/snipe_reveal.png`,
} as const;

// Role images — key must match ROLES keys
function getRoleImage(roleKey: string): string {
  const roleImageMap: Record<string, string> = {
    loup: "loup_garou",
    sorciere: "sorciere",
    cupidon: "cupidon",
    villageois: "villageois",
    chasseur: "chasseur",
    voyante: "voyante",
    petite_fille: "petite_fille",
    salvateur: "salvateur",
    ancien: "ancien",
    idiot_du_village: "idiot_du_village",
    corbeau: "corbeau",
    renard: "renard",
    loup_blanc: "loup_garou_blanc",
  };
  const file = roleImageMap[roleKey] ?? "villageois";
  return `${ASSET_BASE}/roles/${file}.png`;
}
const MIN_PLAYERS = 2;
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
  voyante: {
    name: "Voyante",
    emoji: "🔮",
    team: "village",
    description: "Chaque nuit, vous pouvez espionner un joueur et découvrir son véritable rôle.",
  },
  cupidon: {
    name: "Cupidon",
    emoji: "💘",
    team: "village",
    description: "Au début de la partie, liez deux joueurs par l'amour. Si l'un meurt, l'autre aussi.",
  },
  petite_fille: {
    name: "Petite Fille",
    emoji: "👧",
    team: "village",
    description: "Vous espionnez les loups-garous chaque nuit. Vous voyez leurs messages, mais ils ne savent pas que vous êtes là.",
  },
  chasseur: {
    name: "Chasseur",
    emoji: "🏹",
    team: "village",
    description: "Quand vous mourez, vous emportez quelqu'un avec vous. Choisissez bien votre dernière cible.",
  },
  villageois: {
    name: "Villageois",
    emoji: "🧑‍🌾",
    team: "village",
    description: "Trouvez et éliminez les loups-garous lors des votes du village. Votre instinct est votre arme.",
  },
  loup_blanc: {
    name: "Loup-Garou Blanc",
    emoji: "🐺",
    team: "loups",
    description: "Vous êtes un loup-garou, mais vous jouez aussi en solo. Une nuit sur deux, vous pouvez éliminer un autre loup-garou en secret.",
  },
};

function assignRoles(playerCount: number): string[] {
  // Base: 2 loups, 1 voyante, 1 sorcière, 1 cupidon
  // >= 6: +chasseur, >= 7: +petite_fille, >= 8: +loup_blanc
  const roles: string[] = ["loup", "loup", "voyante", "sorciere", "cupidon"];
  if (playerCount >= 6) roles.push("chasseur");
  if (playerCount >= 7) roles.push("petite_fille");
  if (playerCount >= 8) roles.push("loup_blanc");
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
  couple?: [string, string]; // cupidon's coupled player IDs
  petiteFilleThreadId?: string; // permanent spy thread for petite fille
  nightCount?: number; // how many nights have passed (cupidon acts night 1 only)
  dead?: string[]; // dead player IDs
  voiceChannelId?: string; // voice channel for sound effects
  witchPotions?: { life: boolean; death: boolean }; // true = available
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
  if (game.couple) compact.cp = game.couple;
  if (game.petiteFilleThreadId) compact.pf = game.petiteFilleThreadId;
  if (game.nightCount) compact.nc = game.nightCount;
  if (game.dead?.length) compact.d = game.dead;
  if (game.voiceChannelId) compact.vc = game.voiceChannelId;
  if (game.witchPotions) compact.wp = game.witchPotions;
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
      couple: compact.cp,
      petiteFilleThreadId: compact.pf,
      nightCount: compact.nc ?? 0,
      dead: compact.d ?? [],
      voiceChannelId: compact.vc,
      witchPotions: compact.wp,
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

// ── Custom Presets (KV) ──────────────────────────────────────────────

async function loadCustomPresets(env: Env, guildId: string): Promise<PresetConfig[]> {
  if (!env.PRESETS_KV) return [];
  try {
    const val = await env.PRESETS_KV.get(`presets:${guildId}`);
    if (!val) return [];
    return JSON.parse(val) as PresetConfig[];
  } catch {
    return [];
  }
}

async function saveCustomPreset(env: Env, guildId: string, preset: PresetConfig): Promise<void> {
  if (!env.PRESETS_KV) return;
  const existing = await loadCustomPresets(env, guildId);
  const idx = existing.findIndex((p) => p.name === preset.name);
  if (idx >= 0) existing[idx] = preset;
  else existing.push(preset);
  await env.PRESETS_KV.put(`presets:${guildId}`, JSON.stringify(existing.slice(0, 20)));
}

// ── Config Helpers ───────────────────────────────────────────────────

function getConfigFromInteraction(interaction: any): ConfigState | null {
  const embed = interaction.message?.embeds?.[0];
  if (!embed?.url) return null;
  return decodeConfigState(embed.url);
}

// ── Config Select Menu Handler ───────────────────────────────────────

async function handleConfigSelect(interaction: any, env: Env): Promise<Response> {
  const config = getConfigFromInteraction(interaction);
  if (!config) return json({ type: 4, data: { content: "❌ Erreur: configuration introuvable.", flags: 64 } });

  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (userId !== config.creatorId) {
    return json({ type: 4, data: { content: "❌ Seul le créateur peut modifier la configuration.", flags: 64 } });
  }

  const customId: string = interaction.data?.custom_id || "";
  const values: string[] = interaction.data?.values || [];

  if (customId === "cfg_preset") {
    const presetName = values[0] || "none";
    if (presetName === "none") {
      config.presetName = "";
    } else {
      const customPresets = await loadCustomPresets(env, config.guildId);
      const preset = findPreset(presetName, customPresets);
      if (preset) {
        config.presetName = preset.name;
        config.selectedRoles = [...preset.roles];
        config.anonymousVotes = preset.anonymousVotes;
        config.discussionTime = preset.discussionTime;
        config.voteTime = preset.voteTime;
      }
    }
    const customPresets = await loadCustomPresets(env, config.guildId);
    return json({ type: 7, data: buildStep1Embed(config, customPresets) });
  }

  if (customId === "cfg_votes") {
    config.anonymousVotes = values[0] === "anonyme";
    const customPresets = await loadCustomPresets(env, config.guildId);
    return json({ type: 7, data: buildStep1Embed(config, customPresets) });
  }

  if (customId === "cfg_disc_time") {
    config.discussionTime = parseInt(values[0] || "120", 10);
    const customPresets = await loadCustomPresets(env, config.guildId);
    return json({ type: 7, data: buildStep1Embed(config, customPresets) });
  }

  if (customId === "cfg_vote_time") {
    config.voteTime = parseInt(values[0] || "60", 10);
    const customPresets = await loadCustomPresets(env, config.guildId);
    return json({ type: 7, data: buildStep1Embed(config, customPresets) });
  }

  // Role selection menus (step 2)
  const selectedIds = values.map((v) => parseInt(v, 10));

  if (customId === "cfg_roles_v1") {
    const groupIds = VILLAGEOIS_GROUP_1.map((r) => r.id);
    config.selectedRoles = updateRolesForGroup(config.selectedRoles, groupIds, selectedIds);
    return json({ type: 7, data: buildStep2Embed(config) });
  }
  if (customId === "cfg_roles_v2") {
    const groupIds = VILLAGEOIS_GROUP_2.map((r) => r.id);
    config.selectedRoles = updateRolesForGroup(config.selectedRoles, groupIds, selectedIds);
    return json({ type: 7, data: buildStep2Embed(config) });
  }
  if (customId === "cfg_roles_loups") {
    const groupIds = LOUPS_ROLES.map((r) => r.id);
    config.selectedRoles = updateRolesForGroup(config.selectedRoles, groupIds, selectedIds);
    return json({ type: 7, data: buildStep2Embed(config) });
  }
  if (customId === "cfg_roles_solo") {
    const groupIds = SOLITAIRE_ROLES.map((r) => r.id);
    config.selectedRoles = updateRolesForGroup(config.selectedRoles, groupIds, selectedIds);
    return json({ type: 7, data: buildStep2Embed(config) });
  }

  return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
}

// ── Config Button Handler ────────────────────────────────────────────

async function handleConfigButton(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const config = getConfigFromInteraction(interaction);
  if (!config) return json({ type: 4, data: { content: "❌ Erreur: configuration introuvable.", flags: 64 } });

  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (userId !== config.creatorId) {
    return json({ type: 4, data: { content: "❌ Seul le créateur peut modifier la configuration.", flags: 64 } });
  }

  const customId: string = interaction.data?.custom_id || "";

  if (customId === "cfg_next") {
    return json({ type: 7, data: buildStep2Embed(config) });
  }

  if (customId === "cfg_back") {
    const customPresets = await loadCustomPresets(env, config.guildId);
    return json({ type: 7, data: buildStep1Embed(config, customPresets) });
  }

  if (customId === "cfg_create") {
    if (config.selectedRoles.length === 0) {
      return json({ type: 4, data: { content: "❌ Sélectionne au moins un rôle avant de créer la partie.", flags: 64 } });
    }
    return handleCreateGame(interaction, config, env, ctx);
  }

  if (customId === "cfg_save") {
    // Show modal for preset name
    return json({
      type: 9,
      data: {
        custom_id: "cfg_save_modal",
        title: "Sauvegarder le preset",
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: "preset_name",
                label: "Nom du preset",
                style: 1,
                min_length: 1,
                max_length: 50,
                placeholder: "Mon preset personnalisé",
                required: true,
              },
            ],
          },
        ],
      },
    });
  }

  return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
}

// ── Modal Submit Handler ─────────────────────────────────────────────

async function handleModalSubmit(interaction: any, env: Env): Promise<Response> {
  const customId: string = interaction.data?.custom_id || "";

  if (customId === "cfg_save_modal") {
    // Extract preset name from modal
    const presetName = interaction.data?.components?.[0]?.components?.[0]?.value?.trim();
    if (!presetName) {
      return json({ type: 4, data: { content: "❌ Nom de preset invalide.", flags: 64 } });
    }

    // Get config from the message the modal was triggered from
    const config = getConfigFromInteraction(interaction);
    if (!config) {
      return json({ type: 4, data: { content: "❌ Erreur: configuration introuvable.", flags: 64 } });
    }

    if (!env.PRESETS_KV) {
      return json({ type: 4, data: { content: "⚠️ Les presets personnalisés ne sont pas activés sur ce serveur.", flags: 64 } });
    }

    const preset: PresetConfig = {
      name: presetName,
      roles: config.selectedRoles,
      anonymousVotes: config.anonymousVotes,
      discussionTime: config.discussionTime,
      voteTime: config.voteTime,
    };

    await saveCustomPreset(env, config.guildId, preset);

    config.presetName = presetName;
    const customPresets = await loadCustomPresets(env, config.guildId);

    // Return updated step 2 embed
    return json({ type: 7, data: buildStep2Embed(config) });
  }

  return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
}

// ── Create Game from Config ──────────────────────────────────────────

async function handleCreateGame(interaction: any, config: ConfigState, env: Env, ctx: ExecutionContext): Promise<Response> {
  const token = env.DISCORD_BOT_TOKEN;
  const appId = interaction.application_id;
  const interactionToken = interaction.token;
  const userId = config.creatorId;
  const guildId = config.guildId;
  const channelId = config.channelId;
  const maxPlayers = config.selectedRoles.length;

  // ACK with deferred update (remove the config embed)
  const deferredResponse = json({ type: 5, data: { flags: 64 } });

  const backgroundWork = (async () => {
    try {
      // Check if creator is already in a game
      const activeGame = await getActiveGame(env.ACTIVE_PLAYERS, token, userId);
      if (activeGame !== null) {
        await editOriginalInteractionResponse(appId, interactionToken, {
          content: `❌ Tu es déjà dans la Partie #${activeGame}. Quitte-la avant d'en créer une nouvelle.`,
        });
        return;
      }

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
          { id: botUser.id, type: 1, allow: ((1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 15n) | (1n << 34n) | (1n << 38n)).toString() },
          { id: userId, type: 1, allow: String(1 << 10) },
        ],
      });

      // Create a voice channel for sound effects (type 2 = GUILD_VOICE)
      // Bot needs CONNECT (1<<20) and SPEAK (1<<21)
      let voiceChannelId: string | undefined;
      try {
        const voiceChannel: any = await createChannel(token, guildId, {
          name: `vocal-partie-${gameNumber}`,
          type: 2,
          parent_id: categoryId,
          permission_overwrites: [
            { id: guildId, type: 0, deny: String(1 << 10) },
            { id: botUser.id, type: 1, allow: ((1n << 10n) | (1n << 20n) | (1n << 21n)).toString() },
            { id: userId, type: 1, allow: ((1n << 10n) | (1n << 20n)).toString() },
          ],
        });
        voiceChannelId = voiceChannel.id;
      } catch (err) {
        console.error("Failed to create voice channel:", err);
      }

      await markPlayerActive(env.ACTIVE_PLAYERS, userId, gameNumber, gameChannel.id);

      const gameState: GameState = {
        gameNumber,
        creatorId: userId,
        creatorName,
        guildId,
        gameChannelId: gameChannel.id,
        maxPlayers,
        players: [userId],
        announceChannelId: channelId,
        voiceChannelId,
      };

      // Send lobby embed in game channel
      const lobbyMsg: any = await sendMessage(token, gameChannel.id, buildLobbyEmbed(gameState));
      gameState.lobbyMessageId = lobbyMsg.id;

      // Send announce embed in the original channel (public)
      const announceMsg: any = await sendMessage(token, channelId, buildAnnounceEmbed(gameState));
      gameState.announceMessageId = announceMsg.id;

      // Update ephemeral message to confirm
      await editOriginalInteractionResponse(appId, interactionToken, {
        content: `✅ Partie #${gameNumber} créée! (${maxPlayers} joueurs)`,
        embeds: [],
        components: [
          {
            type: 1,
            components: [
              { type: 2, style: 5, label: "🐺 Aller au salon", url: `https://discord.com/channels/${guildId}/${gameChannel.id}` },
            ],
          },
        ],
      });

      // Re-edit both with complete state (now includes all message IDs)
      await updateAllEmbeds(token, gameState);
    } catch (err) {
      console.error("Error in handleCreateGame:", err);
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

// ── /loupgarou ──────────────────────────────────────────────────────

async function handleSlashCommand(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  const userId = interaction.member?.user?.id;

  if (!guildId || !channelId || !userId) {
    return json({ type: 4, data: { content: "❌ Cette commande ne fonctionne que dans un serveur Discord.", flags: 64 } });
  }

  // Check if creator is already in a game
  const token = env.DISCORD_BOT_TOKEN;
  const activeGame = await getActiveGame(env.ACTIVE_PLAYERS, token, userId);
  if (activeGame !== null) {
    return json({ type: 4, data: { content: `❌ Tu es déjà dans la Partie #${activeGame}. Quitte-la avant d'en créer une nouvelle.`, flags: 64 } });
  }

  // Build initial config state with default preset
  const defaultPreset = DEFAULT_PRESETS[0]!;
  const config: ConfigState = {
    step: 1,
    creatorId: userId,
    guildId,
    channelId,
    presetName: defaultPreset.name,
    anonymousVotes: defaultPreset.anonymousVotes,
    discussionTime: defaultPreset.discussionTime,
    voteTime: defaultPreset.voteTime,
    selectedRoles: [...defaultPreset.roles],
  };

  const customPresets = await loadCustomPresets(env, guildId);

  // Return ephemeral config embed
  return json({ type: 4, data: { ...buildStep1Embed(config, customPresets), flags: 64 } });
}

// ── Join ────────────────────────────────────────────────────────────

async function handleJoin(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });

  const token = env.DISCORD_BOT_TOKEN;

  // Parse initial state from the interaction message (may be stale if another join is in-flight)
  const initialGame = parseGameFromEmbed(interaction.message);
  if (!initialGame) return json({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });

  // Re-read the latest state from the LOBBY embed to avoid race conditions.
  // Without this, two players clicking "Rejoindre" at the same time both read
  // the old state from interaction.message and the second join overwrites the first.
  let game = initialGame;
  if (initialGame.lobbyMessageId) {
    try {
      const latestMsg: any = await getMessage(token, initialGame.gameChannelId, initialGame.lobbyMessageId);
      const latestGame = parseGameFromEmbed(latestMsg);
      if (latestGame) game = latestGame;
    } catch {}
  }

  if (game.players.includes(userId)) return json({ type: 4, data: { content: "❌ Tu es déjà dans cette partie!", flags: 64 } });
  if (game.players.length >= game.maxPlayers) return json({ type: 4, data: { content: "❌ La partie est pleine!", flags: 64 } });

  // Check if player is already in another game
  const activeGame = await getActiveGame(env.ACTIVE_PLAYERS, token, userId);
  if (activeGame !== null) {
    return json({ type: 4, data: { content: `❌ Tu es déjà dans la Partie #${activeGame}. Quitte-la avant d'en rejoindre une autre.`, flags: 64 } });
  }

  game.players.push(userId);

  await markPlayerActive(env.ACTIVE_PLAYERS, userId, game.gameNumber, game.gameChannelId);

  await setChannelPermission(token, game.gameChannelId, userId, {
    allow: String(1 << 10),
    deny: String(1 << 11),
    type: 1,
  });

  // Grant access to voice channel (VIEW_CHANNEL + CONNECT)
  if (game.voiceChannelId) {
    try {
      await setChannelPermission(token, game.voiceChannelId, userId, {
        allow: ((1n << 10n) | (1n << 20n)).toString(),
        type: 1,
      });
    } catch {}
  }

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

  const token = env.DISCORD_BOT_TOKEN;

  // Re-read the latest state from the lobby embed (same race condition fix as handleJoin)
  const initialGame = parseGameFromEmbed(interaction.message);
  if (!initialGame) return json({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });

  let game = initialGame;
  if (initialGame.lobbyMessageId) {
    try {
      const latestMsg: any = await getMessage(token, initialGame.gameChannelId, initialGame.lobbyMessageId);
      const latestGame = parseGameFromEmbed(latestMsg);
      if (latestGame) game = latestGame;
    } catch {}
  }

  if (!game.players.includes(userId)) return json({ type: 4, data: { content: "❌ Tu n'es pas dans cette partie.", flags: 64 } });
  game.players = game.players.filter((id) => id !== userId);

  // Clear player from active games
  await clearPlayerActive(env.ACTIVE_PLAYERS, userId);

  try { await deleteChannelPermission(token, game.gameChannelId, userId); } catch {}
  if (game.voiceChannelId) {
    try { await deleteChannelPermission(token, game.voiceChannelId, userId); } catch {}
  }

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
    if (game.voiceChannelId) {
      try { await deleteChannel(token, game.voiceChannelId); } catch {}
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

function triggerPhase(ctx: ExecutionContext, env: Env, phase: string, data: Record<string, unknown>) {
  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal": env.DISCORD_BOT_TOKEN,
      },
      body: JSON.stringify({ phase, ...data }),
    }).then(async (res) => {
      if (!res.ok) console.error(`Phase ${phase} HTTP ${res.status}: ${await res.text()}`);
      else console.log(`Phase ${phase} triggered OK`);
    }).catch((err) => console.error(`Phase ${phase} fetch error:`, err))
  );
}

// ── Voice Service ────────────────────────────────────────────────────

const VOICE_SERVICE_TIMEOUT_MS = 10_000;

async function triggerStartSound(env: Env, game: GameState): Promise<void> {
  if (!env.VOICE_SERVICE_URL || !game.voiceChannelId) {
    if (!env.VOICE_SERVICE_URL) console.log("[garou] Voice service skipped: VOICE_SERVICE_URL not set");
    else console.log("[garou] Voice service skipped: no voiceChannelId");
    return;
  }
  const endpoint = `${env.VOICE_SERVICE_URL.replace(/\/+$/, "")}/play-start-sfx`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.VOICE_SERVICE_TOKEN) headers.Authorization = `Bearer ${env.VOICE_SERVICE_TOKEN}`;
  console.log(`[garou] Triggering start sound: guildId=${game.guildId} voiceChannelId=${game.voiceChannelId}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VOICE_SERVICE_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ guildId: game.guildId, voiceChannelId: game.voiceChannelId }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const body = await res.text();
      console.error(`[garou] Voice service error ${res.status}: ${body}`);
    } else {
      const data: any = await res.json();
      if (data.skipped) console.log("[garou] Voice service skipped playback (e.g. no one in voice channel)");
      else console.log("[garou] Start sound played successfully");
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      console.error("[garou] Voice service timeout");
    } else {
      console.error("[garou] Voice service fetch error:", err);
    }
  }
}

async function startGame(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  if (!game.lobbyMessageId) return;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  // Play sound effect in voice channel (non-blocking)
  triggerStartSound(env, game).catch(() => {});

  // ── Phase 1: Night falls ──
  await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
    embeds: [
      {
        title: "🌑 La nuit tombe sur le village...",
        url: stateUrl,
        description: [
          "*Les villageois s'endorment...*",
          "*Quelque chose rôde dans l'ombre...*",
        ].join("\n"),
        color: EMBED_COLOR_NIGHT,
        image: { url: SCENE_IMAGES.night_falls },
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
          `**${game.players.length} cartes** sont distribuées face cachée...`,
          "",
          "*Chaque joueur reçoit son destin en secret.*",
        ].join("\n"),
        color: EMBED_COLOR_PURPLE,
        image: { url: SCENE_IMAGES.game_start },
      },
    ],
    components: [],
  });

  // ── Assign roles ──
  const roleKeys = assignRoles(game.players.length);
  const rolesMap: Record<string, string> = {};
  game.players.forEach((id, i) => { rolesMap[id] = roleKeys[i]!; });
  game.roles = rolesMap;
  game.witchPotions = { life: true, death: true };

  await sleep(3000);

  // ── Phase 3: Role check (channels are created lazily when players reveal) ──
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

  // Countdown is triggered directly by handleRevealRole when all players click "Voir mon rôle".
}


// ── Countdown + Night — runs in ctx.waitUntil from handleRevealRole (~25s) ──
async function runCountdownAndNight(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  try {
    const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId!);
    const latest = parseGameFromEmbed(msg);
    if (latest) game = latest;
  } catch {}

  const nightStateUrl = `https://garou.bot/s/${encodeState(game)}`;

  // 10s countdown with progress bar
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

  // "Le village s'endort..."
  await editMessage(token, game.gameChannelId, game.lobbyMessageId!, {
    embeds: [{
      title: `🌙 Le village s'endort... — Partie #${game.gameNumber}`,
      url: nightStateUrl,
      description: [
        "*Chaque villageois ferme les yeux...*",
        "*Le silence envahit le village...*",
      ].join("\n"),
      color: EMBED_COLOR_NIGHT,
      image: { url: SCENE_IMAGES.night_falls },
    }],
    components: [],
  });

  await sleep(3000);

  // Trigger night orchestrator (cupidon night 1 → voyante → wolves → sorciere → dawn)
  triggerPhase(ctx, env, "night_start", { game });
}

// ── Countdown when game is full ──────────────────────────────────────

function isGameStarted(title: string): boolean {
  return title.includes("La nuit tombe") || title.includes("La chasse commence") || title.includes("Le destin")
    || title.includes("Le village s'endort") || title.includes("Les loups-garous se réveillent")
    || title.includes("Découvrez vos rôles") || title.includes("La partie débute")
    || title.includes("Vision de la Voyante") || title.includes("Sorcière");
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
    triggerPhase(ctx, env, "start_game", { game: currentGame });
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
  petiteFilleThreadId?: string;
  couple?: [string, string];
  allRoles?: Record<string, string>; // all player roles (for chasseur check)
  allPlayers?: string[]; // all living players
}

function encodeVoteState(vote: VoteState): string {
  const o: Record<string, unknown> = {
    g: vote.gameNumber, gi: vote.guildId, gc: vote.gameChannelId,
    wc: vote.wolfChannelId, lm: vote.lobbyMessageId,
    w: vote.wolves,
    t: vote.targets.map((t) => [t.id, t.name]),
    v: vote.votes, dl: vote.deadline,
  };
  if (vote.petiteFilleThreadId) o.pf = vote.petiteFilleThreadId;
  if (vote.couple) o.cp = vote.couple;
  if (vote.allRoles) o.ar = vote.allRoles;
  if (vote.allPlayers) o.ap = vote.allPlayers;
  return btoa(JSON.stringify(o));
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
      petiteFilleThreadId: c.pf,
      couple: c.cp,
      allRoles: c.ar,
      allPlayers: c.ap,
    };
  } catch { return null; }
}

function parseVoteFromEmbed(message: any): VoteState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/v/")) return null;
  return decodeVoteState(embed.url);
}

// ── Voyante State ────────────────────────────────────────────────────

const VOYANTE_TIMEOUT_SECONDS = 60;

interface VoyanteState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  voyanteThreadId: string;
  lobbyMessageId: string;
  voyanteId: string;
  targets: { id: string; name: string }[];
  deadline: number;
  allRoles: Record<string, string>;
  resolved?: boolean;
}

function encodeVoyanteState(vy: VoyanteState): string {
  return btoa(JSON.stringify({
    g: vy.gameNumber, gi: vy.guildId, gc: vy.gameChannelId,
    vt: vy.voyanteThreadId, lm: vy.lobbyMessageId, vi: vy.voyanteId,
    t: vy.targets.map((t) => [t.id, t.name]),
    dl: vy.deadline, ar: vy.allRoles, rs: vy.resolved,
  }));
}

function decodeVoyanteState(url: string): VoyanteState | null {
  try {
    const b64 = url.split("/vy/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc,
      voyanteThreadId: c.vt, lobbyMessageId: c.lm, voyanteId: c.vi,
      targets: (c.t as [string, string][]).map(([id, name]) => ({ id, name })),
      deadline: c.dl, allRoles: c.ar, resolved: c.rs,
    };
  } catch { return null; }
}

function parseVoyanteFromEmbed(message: any): VoyanteState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/vy/")) return null;
  return decodeVoyanteState(embed.url);
}

function buildVoyanteEmbed(vy: VoyanteState) {
  const stateUrl = `https://garou.bot/vy/${encodeVoyanteState(vy)}`;

  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const target of vy.targets) {
    currentRow.push({
      type: 2,
      style: 1,
      label: `🔍 ${target.name}`,
      custom_id: `voyante_see_${vy.gameNumber}_${target.id}`,
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
      title: `🔮 Vision de la Voyante — Partie #${vy.gameNumber}`,
      url: stateUrl,
      description: [
        "**Qui veux-tu espionner cette nuit?**",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "Choisis un joueur pour découvrir son rôle.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `⏰ Fin <t:${vy.deadline}:R>`,
      ].join("\n"),
      color: EMBED_COLOR_PURPLE,
      thumbnail: { url: getRoleImage("voyante") },
    }],
    components: buttonRows,
  };
}

// ── Sorciere State ───────────────────────────────────────────────────

const SORCIERE_TIMEOUT_SECONDS = 60;

interface SorciereState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  sorciereThreadId: string;
  lobbyMessageId: string;
  sorciereId: string;
  wolfVictimId: string;
  wolfVictimName: string;
  potions: { life: boolean; death: boolean };
  targets: { id: string; name: string }[];
  deadline: number;
  resolved?: boolean;
  witchSaved?: boolean;
  witchKillTargetId?: string;
}

function encodeSorciereState(so: SorciereState): string {
  return btoa(JSON.stringify({
    g: so.gameNumber, gi: so.guildId, gc: so.gameChannelId,
    st: so.sorciereThreadId, lm: so.lobbyMessageId, si: so.sorciereId,
    wv: so.wolfVictimId, wn: so.wolfVictimName,
    po: so.potions,
    t: so.targets.map((t) => [t.id, t.name]),
    dl: so.deadline, rs: so.resolved,
    ws: so.witchSaved, wk: so.witchKillTargetId,
  }));
}

function decodeSorciereState(url: string): SorciereState | null {
  try {
    const b64 = url.split("/so/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc,
      sorciereThreadId: c.st, lobbyMessageId: c.lm, sorciereId: c.si,
      wolfVictimId: c.wv, wolfVictimName: c.wn,
      potions: c.po,
      targets: (c.t as [string, string][]).map(([id, name]) => ({ id, name })),
      deadline: c.dl, resolved: c.rs,
      witchSaved: c.ws, witchKillTargetId: c.wk,
    };
  } catch { return null; }
}

function parseSorciereFromEmbed(message: any): SorciereState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/so/")) return null;
  return decodeSorciereState(embed.url);
}

function buildSorciereEmbed(so: SorciereState) {
  const stateUrl = `https://garou.bot/so/${encodeSorciereState(so)}`;

  const buttons: any[] = [];
  if (so.potions.life) {
    buttons.push({
      type: 2, style: 3,
      label: "💚 Potion de Vie",
      custom_id: `sorciere_life_${so.gameNumber}`,
    });
  }
  if (so.potions.death) {
    buttons.push({
      type: 2, style: 4,
      label: "💀 Potion de Mort",
      custom_id: `sorciere_death_${so.gameNumber}`,
    });
  }
  buttons.push({
    type: 2, style: 2,
    label: "⏭️ Passer",
    custom_id: `sorciere_skip_${so.gameNumber}`,
  });

  return {
    embeds: [{
      title: `🧪 Sorcière — Partie #${so.gameNumber}`,
      url: stateUrl,
      description: [
        `Les loups-garous ont choisi de dévorer **${so.wolfVictimName}** cette nuit.`,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        so.potions.life ? "💚 **Potion de Vie** — Sauvez la victime" : "~~💚 Potion de Vie~~ *(utilisée)*",
        so.potions.death ? "💀 **Potion de Mort** — Éliminez quelqu'un" : "~~💀 Potion de Mort~~ *(utilisée)*",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `⏰ Fin <t:${so.deadline}:R>`,
      ].join("\n"),
      color: EMBED_COLOR_PURPLE,
      thumbnail: { url: getRoleImage("sorciere") },
    }],
    components: [{ type: 1, components: buttons }],
  };
}

function buildSorciereTargetEmbed(so: SorciereState) {
  const stateUrl = `https://garou.bot/so/${encodeSorciereState(so)}`;

  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const target of so.targets) {
    if (target.id === so.sorciereId) continue; // can't poison yourself
    currentRow.push({
      type: 2, style: 4,
      label: `☠️ ${target.name}`,
      custom_id: `sorciere_target_${so.gameNumber}_${target.id}`,
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
      title: `🧪 Potion de Mort — Partie #${so.gameNumber}`,
      url: stateUrl,
      description: [
        "**Qui veux-tu empoisonner cette nuit?**",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `⏰ Fin <t:${so.deadline}:R>`,
      ].join("\n"),
      color: EMBED_COLOR,
      thumbnail: { url: getRoleImage("sorciere") },
    }],
    components: buttonRows,
  };
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
      thumbnail: { url: getRoleImage("loup") },
    }],
    components: buttonRows,
  };
}

// ── Cupidon State ────────────────────────────────────────────────────

interface CupidonState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  lobbyMessageId: string;
  cupidonId: string;
  players: { id: string; name: string }[];
  picks: string[];
  deadline: number;
  roles: Record<string, string>;
  allPlayers: string[];
}

function encodeCupidonState(s: CupidonState): string {
  return btoa(JSON.stringify({
    g: s.gameNumber, gi: s.guildId, gc: s.gameChannelId, lm: s.lobbyMessageId,
    cu: s.cupidonId, pl: s.players.map(p => [p.id, p.name]),
    pk: s.picks, dl: s.deadline, r: s.roles, ap: s.allPlayers,
  }));
}

function decodeCupidonState(url: string): CupidonState | null {
  try {
    const b64 = url.split("/cu/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc, lobbyMessageId: c.lm,
      cupidonId: c.cu,
      players: (c.pl as [string, string][]).map(([id, name]) => ({ id, name })),
      picks: c.pk ?? [], deadline: c.dl, roles: c.r, allPlayers: c.ap,
    };
  } catch { return null; }
}

function parseCupidonFromEmbed(message: any): CupidonState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/cu/")) return null;
  return decodeCupidonState(embed.url);
}

function buildCupidonEmbed(s: CupidonState) {
  const stateUrl = `https://garou.bot/cu/${encodeCupidonState(s)}`;
  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const p of s.players) {
    const selected = s.picks.includes(p.id);
    currentRow.push({
      type: 2, style: selected ? 3 : 2,
      label: `${selected ? "💘 " : ""}${p.name}`,
      custom_id: `cupidon_pick_${s.gameNumber}_${p.id}`,
    });
    if (currentRow.length === 5) {
      buttonRows.push({ type: 1, components: currentRow });
      currentRow = [];
    }
  }
  if (currentRow.length > 0) buttonRows.push({ type: 1, components: currentRow });

  if (s.picks.length === 2) {
    const names = s.picks.map(id => s.players.find(p => p.id === id)?.name ?? "?");
    buttonRows.push({ type: 1, components: [{
      type: 2, style: 1,
      label: `✅ Confirmer: ${names[0]} & ${names[1]}`,
      custom_id: `cupidon_confirm_${s.gameNumber}`,
    }] });
  }

  return {
    embeds: [{
      title: `💘 Cupidon — Choisis le couple — Partie #${s.gameNumber}`,
      url: stateUrl,
      description: [
        "**Lie deux joueurs par l'amour.**",
        "Si l'un meurt, l'autre meurt aussi.",
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        s.picks.length === 0 ? "*Choisis 2 joueurs...*"
          : s.picks.length === 1 ? `💘 <@${s.picks[0]}> + *...?*`
          : `💘 <@${s.picks[0]}> & <@${s.picks[1]}>`,
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        `⏰ Temps restant <t:${s.deadline}:R>`,
      ].join("\n"),
      color: 0xe91e63,
      thumbnail: { url: getRoleImage("cupidon") },
    }],
    components: buttonRows,
  };
}

async function handleCupidonPick(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const s = parseCupidonFromEmbed(interaction.message);
  if (!s) return json({ type: 4, data: { content: "❌ Erreur: état introuvable.", flags: 64 } });
  if (userId !== s.cupidonId) return json({ type: 4, data: { content: "❌ Seul Cupidon peut choisir.", flags: 64 } });
  if (Math.floor(Date.now() / 1000) > s.deadline) return json({ type: 4, data: { content: "⏰ Le temps est écoulé!", flags: 64 } });

  const customId: string = interaction.data?.custom_id || "";
  const targetId = customId.replace(`cupidon_pick_${s.gameNumber}_`, "");

  if (s.picks.includes(targetId)) {
    s.picks = s.picks.filter(id => id !== targetId);
  } else {
    if (s.picks.length >= 2) s.picks.shift();
    s.picks.push(targetId);
  }

  return json({ type: 7, data: buildCupidonEmbed(s) });
}

async function finalizeCupidonAndStartWolves(token: string, s: CupidonState, couple: [string, string], cupidonThreadId: string, ctx: ExecutionContext, env: Env) {
  const names = couple.map(id => s.players.find(p => p.id === id)?.name ?? "?");

  for (const playerId of couple) {
    const otherName = playerId === couple[0] ? names[1] : names[0];
    const otherId = playerId === couple[0] ? couple[1] : couple[0];
    try {
      const dm: any = await createDM(token, playerId);
      await sendMessage(token, dm.id, {
        embeds: [{
          title: "💘 Tu as été touché(e) par la flèche de Cupidon!",
          description: [
            `Tu es lié(e) à **${otherName}** (<@${otherId}>).`,
            "", "Si l'un de vous meurt, l'autre mourra aussi de chagrin.",
            "", "*Protégez-vous mutuellement...*",
          ].join("\n"),
          color: 0xe91e63, thumbnail: { url: getRoleImage("cupidon") },
        }],
      });
    } catch (err) { console.error(`Failed to DM couple member ${playerId}:`, err); }
  }

  try { await deleteChannel(token, cupidonThreadId); } catch {}

  let game: GameState | null = null;
  try {
    const lobbyMsg: any = await getMessage(token, s.gameChannelId, s.lobbyMessageId);
    game = parseGameFromEmbed(lobbyMsg);
  } catch {}
  if (!game) {
    game = {
      gameNumber: s.gameNumber, guildId: s.guildId, gameChannelId: s.gameChannelId,
      lobbyMessageId: s.lobbyMessageId, maxPlayers: s.allPlayers.length,
      players: s.allPlayers, roles: s.roles, couple, nightCount: 1, dead: [],
      creatorId: s.allPlayers[0]!, creatorName: "",
    };
  } else {
    game.couple = couple;
  }

  if (game.lobbyMessageId) {
    const stateUrl = `https://garou.bot/s/${encodeState(game)}`;
    try {
      const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
      const embed = msg.embeds?.[0];
      if (embed) {
        embed.url = stateUrl;
        await editMessage(token, game.gameChannelId, game.lobbyMessageId, { embeds: [embed], components: msg.components ?? [] });
      }
    } catch {}
  }

  // Chain to voyante phase (which chains to wolf_phase)
  triggerPhase(ctx, env, "voyante_phase", { game });
}

async function handleCupidonConfirm(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const s = parseCupidonFromEmbed(interaction.message);
  if (!s) return json({ type: 4, data: { content: "❌ Erreur: état introuvable.", flags: 64 } });
  if (userId !== s.cupidonId) return json({ type: 4, data: { content: "❌ Seul Cupidon peut confirmer.", flags: 64 } });
  if (s.picks.length !== 2) return json({ type: 4, data: { content: "❌ Choisis exactement 2 joueurs.", flags: 64 } });

  const token = env.DISCORD_BOT_TOKEN;
  const couple = s.picks as [string, string];
  const names = couple.map(id => s.players.find(p => p.id === id)?.name ?? "?");

  const ackResponse = json({ type: 7, data: {
    embeds: [{
      title: `💘 Le couple est formé! — Partie #${s.gameNumber}`,
      url: `https://garou.bot/cu/${encodeCupidonState(s)}`,
      description: `**${names[0]}** & **${names[1]}** sont liés par l'amour.\n\n*Si l'un meurt, l'autre mourra de chagrin.*`,
      color: 0xe91e63, thumbnail: { url: getRoleImage("cupidon") },
    }],
    components: [],
  } });

  const cupidonThreadId = interaction.channel_id;
  ctx.waitUntil(finalizeCupidonAndStartWolves(token, s, couple, cupidonThreadId, ctx, env));

  return ackResponse;
}

const CUPIDON_TIMEOUT_SECONDS = 60;

async function phaseCupidonTimer(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { cupidonMessageId, cupidonThreadId } = data;
  if (!cupidonMessageId || !cupidonThreadId) return;

  const start = Date.now();
  while (Date.now() - start < 25000) {
    await sleep(5000);
    try {
      const msg: any = await getMessage(token, cupidonThreadId, cupidonMessageId);
      if (!msg.components?.length) return;
      const s = parseCupidonFromEmbed(msg);
      if (!s) return;
      if (Date.now() / 1000 >= s.deadline) {
        const available = s.players.filter(p => p.id !== s.cupidonId);
        const shuffled = [...available].sort(() => Math.random() - 0.5);
        const couple: [string, string] = [shuffled[0]!.id, shuffled[1]!.id];
        const names = couple.map(id => s.players.find(p => p.id === id)?.name ?? "?");

        await editMessage(token, cupidonThreadId, cupidonMessageId, {
          embeds: [{
            title: `💘 Temps écoulé! Couple aléatoire — Partie #${s.gameNumber}`,
            url: `https://garou.bot/cu/${encodeCupidonState(s)}`,
            description: `**${names[0]}** & **${names[1]}** sont liés par l'amour.\n\n*Cupidon n'a pas choisi à temps...*`,
            color: 0xe91e63,
          }],
          components: [],
        });

        await finalizeCupidonAndStartWolves(token, s, couple, cupidonThreadId, ctx, env);
        return;
      }
    } catch { return; }
  }
  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
      body: JSON.stringify({ phase: "cupidon_timer", cupidonMessageId, cupidonThreadId }),
    }).catch(err => console.error("Cupidon timer re-trigger failed:", err))
  );
}

// ── Chasseur State ──────────────────────────────────────────────────

interface ChasseurState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  lobbyMessageId: string;
  chasseurId: string;
  targets: { id: string; name: string }[];
  deadline: number;
  roles: Record<string, string>;
  allPlayers: string[];
  couple?: [string, string];
  dead: string[];
}

function encodeChasseurState(s: ChasseurState): string {
  return btoa(JSON.stringify({
    g: s.gameNumber, gi: s.guildId, gc: s.gameChannelId, lm: s.lobbyMessageId,
    ch: s.chasseurId, t: s.targets.map(t => [t.id, t.name]),
    dl: s.deadline, r: s.roles, ap: s.allPlayers, cp: s.couple, d: s.dead,
  }));
}

function decodeChasseurState(url: string): ChasseurState | null {
  try {
    const b64 = url.split("/hs/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc, lobbyMessageId: c.lm,
      chasseurId: c.ch,
      targets: (c.t as [string, string][]).map(([id, name]) => ({ id, name })),
      deadline: c.dl, roles: c.r, allPlayers: c.ap, couple: c.cp, dead: c.d ?? [],
    };
  } catch { return null; }
}

function parseChasseurFromEmbed(message: any): ChasseurState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/hs/")) return null;
  return decodeChasseurState(embed.url);
}

function buildChasseurEmbed(s: ChasseurState) {
  const stateUrl = `https://garou.bot/hs/${encodeChasseurState(s)}`;
  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const t of s.targets) {
    currentRow.push({
      type: 2, style: 4,
      label: `🎯 ${t.name}`,
      custom_id: `chasseur_shoot_${s.gameNumber}_${t.id}`,
    });
    if (currentRow.length === 5) {
      buttonRows.push({ type: 1, components: currentRow });
      currentRow = [];
    }
  }
  if (currentRow.length > 0) buttonRows.push({ type: 1, components: currentRow });

  return {
    embeds: [{
      title: `🏹 Chasseur — Dernier tir! — Partie #${s.gameNumber}`,
      url: stateUrl,
      description: [
        "**Tu meurs... mais tu emportes quelqu'un avec toi!**",
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        "Choisis ta dernière cible.",
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        `⏰ Temps restant <t:${s.deadline}:R>`,
      ].join("\n"),
      color: 0xe67e22, thumbnail: { url: getRoleImage("chasseur") },
    }],
    components: buttonRows,
  };
}

const CHASSEUR_TIMEOUT_SECONDS = 30;

async function triggerChasseurShoot(token: string, game: GameState, chasseurId: string, ctx: ExecutionContext, env: Env) {
  const dead = game.dead ?? [];
  const livingTargets = game.players.filter(id => !dead.includes(id) && id !== chasseurId);
  const targets = await Promise.all(
    livingTargets.map(async (id) => {
      const member: any = await getGuildMember(token, game.guildId, id);
      return { id, name: member.nick || member.user.global_name || member.user.username };
    })
  );
  if (targets.length === 0) return;

  const deadline = Math.floor(Date.now() / 1000) + CHASSEUR_TIMEOUT_SECONDS;
  const chasseurState: ChasseurState = {
    gameNumber: game.gameNumber, guildId: game.guildId,
    gameChannelId: game.gameChannelId, lobbyMessageId: game.lobbyMessageId!,
    chasseurId, targets, deadline, roles: game.roles ?? {},
    allPlayers: game.players, couple: game.couple, dead: [...dead],
  };

  const chasseurMsg: any = await sendMessage(token, game.gameChannelId, buildChasseurEmbed(chasseurState));

  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
      body: JSON.stringify({ phase: "chasseur_timer", chasseurMessageId: chasseurMsg.id, gameChannelId: game.gameChannelId }),
    }).catch(err => console.error("Chasseur timer trigger failed:", err))
  );
}

async function handleChasseurShoot(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const s = parseChasseurFromEmbed(interaction.message);
  if (!s) return json({ type: 4, data: { content: "❌ Erreur: état introuvable.", flags: 64 } });
  if (userId !== s.chasseurId) return json({ type: 4, data: { content: "❌ Seul le chasseur peut tirer.", flags: 64 } });

  const customId: string = interaction.data?.custom_id || "";
  const targetId = customId.replace(`chasseur_shoot_${s.gameNumber}_`, "");
  const target = s.targets.find(t => t.id === targetId);
  if (!target) return json({ type: 4, data: { content: "❌ Cible invalide.", flags: 64 } });

  const token = env.DISCORD_BOT_TOKEN;

  const ackResponse = json({ type: 7, data: {
    embeds: [{
      title: `🏹 Le chasseur tire! — Partie #${s.gameNumber}`,
      url: `https://garou.bot/hs/${encodeChasseurState(s)}`,
      description: `**${target.name}** (<@${target.id}>) est abattu(e) par le chasseur!`,
      color: 0xe67e22, thumbnail: { url: getRoleImage("chasseur") },
    }],
    components: [],
  } });

  ctx.waitUntil((async () => {
    await sendMessage(token, s.gameChannelId, {
      embeds: [{
        title: "🏹 Le chasseur tire une dernière flèche!",
        description: `Dans un dernier souffle, le chasseur abat **${target.name}** (<@${target.id}>)!`,
        color: 0xe67e22, image: { url: SCENE_IMAGES.snipe_reveal },
      }],
    });

    let game: GameState | null = null;
    try {
      const lobbyMsg: any = await getMessage(token, s.gameChannelId, s.lobbyMessageId);
      game = parseGameFromEmbed(lobbyMsg);
    } catch {}
    if (!game) return;
    if (!game.dead) game.dead = [];
    game.dead.push(target.id);

    try {
      await setChannelPermission(token, s.gameChannelId, target.id, {
        allow: String(1 << 10), deny: String(1 << 11), type: 1,
      });
    } catch {}

    if (game.couple && game.couple.includes(target.id)) {
      const partnerId = target.id === game.couple[0] ? game.couple[1] : game.couple[0];
      if (!game.dead.includes(partnerId)) {
        game.dead.push(partnerId);
        try { await setChannelPermission(token, s.gameChannelId, partnerId, { allow: String(1 << 10), deny: String(1 << 11), type: 1 }); } catch {}
        const pm: any = await getGuildMember(token, game.guildId, partnerId).catch(() => null);
        const pName = pm?.nick || pm?.user?.global_name || pm?.user?.username || "?";
        await sendMessage(token, s.gameChannelId, {
          embeds: [{ title: "💔 Le couple est brisé...", description: `**${pName}** (<@${partnerId}>) meurt de chagrin.`, color: 0xe91e63 }],
        });
      }
    }

    if (game.lobbyMessageId) {
      const su = `https://garou.bot/s/${encodeState(game)}`;
      try {
        const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
        const emb = msg.embeds?.[0];
        if (emb) { emb.url = su; await editMessage(token, game.gameChannelId, game.lobbyMessageId, { embeds: [emb], components: msg.components ?? [] }); }
      } catch {}
    }

    const wr = checkWinCondition(game);
    if (wr) { await sleep(2000); await announceVictory(token, game, wr, env); }
  })());

  return ackResponse;
}

async function phaseChasseurTimer(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { chasseurMessageId, gameChannelId } = data;
  if (!chasseurMessageId || !gameChannelId) return;

  const start = Date.now();
  while (Date.now() - start < 25000) {
    await sleep(5000);
    try {
      const msg: any = await getMessage(token, gameChannelId, chasseurMessageId);
      if (!msg.components?.length) return;
      const s = parseChasseurFromEmbed(msg);
      if (!s) return;
      if (Date.now() / 1000 >= s.deadline) {
        const target = s.targets[Math.floor(Math.random() * s.targets.length)]!;
        await editMessage(token, gameChannelId, chasseurMessageId, {
          embeds: [{
            title: `🏹 Le chasseur tire! — Partie #${s.gameNumber}`,
            url: `https://garou.bot/hs/${encodeChasseurState(s)}`,
            description: `Temps écoulé... **${target.name}** est abattu(e) au hasard!`,
            color: 0xe67e22,
          }],
          components: [],
        });
        await sendMessage(token, s.gameChannelId, {
          embeds: [{
            title: "🏹 Le chasseur tire une dernière flèche!",
            description: `Dans un dernier souffle, le chasseur abat **${target.name}** (<@${target.id}>)!`,
            color: 0xe67e22, image: { url: SCENE_IMAGES.snipe_reveal },
          }],
        });

        let game: GameState | null = null;
        try { const lm: any = await getMessage(token, s.gameChannelId, s.lobbyMessageId); game = parseGameFromEmbed(lm); } catch {}
        if (!game) return;
        if (!game.dead) game.dead = [];
        game.dead.push(target.id);
        try { await setChannelPermission(token, s.gameChannelId, target.id, { allow: String(1 << 10), deny: String(1 << 11), type: 1 }); } catch {}

        if (game.couple && game.couple.includes(target.id)) {
          const pid = target.id === game.couple[0] ? game.couple[1] : game.couple[0];
          if (!game.dead.includes(pid)) {
            game.dead.push(pid);
            try { await setChannelPermission(token, s.gameChannelId, pid, { allow: String(1 << 10), deny: String(1 << 11), type: 1 }); } catch {}
            const pm: any = await getGuildMember(token, game.guildId, pid).catch(() => null);
            const pn = pm?.nick || pm?.user?.global_name || pm?.user?.username || "?";
            await sendMessage(token, s.gameChannelId, { embeds: [{ title: "💔 Le couple est brisé...", description: `**${pn}** (<@${pid}>) meurt de chagrin.`, color: 0xe91e63 }] });
          }
        }

        if (game.lobbyMessageId) {
          const su = `https://garou.bot/s/${encodeState(game)}`;
          try { const m: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId); const e = m.embeds?.[0]; if (e) { e.url = su; await editMessage(token, game.gameChannelId, game.lobbyMessageId, { embeds: [e], components: m.components ?? [] }); } } catch {}
        }
        const wr = checkWinCondition(game);
        if (wr) { await sleep(2000); await announceVictory(token, game, wr, env); }
        return;
      }
    } catch { return; }
  }
  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
      body: JSON.stringify({ phase: "chasseur_timer", chasseurMessageId, gameChannelId }),
    }).catch(err => console.error("Chasseur timer re-trigger failed:", err))
  );
}

// ── Wolf Phase (extracted for reuse by cupidon flow) ────────────────

async function startWolfPhase(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  if (!game.roles) return;

  // Show wolf wake-up animation in game channel
  if (game.lobbyMessageId) {
    const nightStateUrl = `https://garou.bot/s/${encodeState(game)}`;
    await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
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
        image: { url: getRoleImage("loup") },
      }],
      components: [],
    });
  }

  const dead = game.dead ?? [];
  const livingPlayers = game.players.filter(id => !dead.includes(id));
  const wolfIds = livingPlayers.filter(id => {
    const r = game.roles![id];
    return r === "loup" || r === "loup_blanc";
  });
  const targetIds = livingPlayers.filter(id => !wolfIds.includes(id));

  const targets = await Promise.all(
    targetIds.map(async (id) => {
      const member: any = await getGuildMember(token, game.guildId, id);
      return { id, name: member.nick || member.user.global_name || member.user.username };
    })
  );

  const deadline = Math.floor(Date.now() / 1000) + NIGHT_VOTE_SECONDS;

  const voteState: VoteState = {
    gameNumber: game.gameNumber, guildId: game.guildId,
    gameChannelId: game.gameChannelId, wolfChannelId: "",
    lobbyMessageId: game.lobbyMessageId!, wolves: wolfIds,
    targets, votes: {}, deadline,
    petiteFilleThreadId: game.petiteFilleThreadId,
    couple: game.couple, allRoles: game.roles, allPlayers: livingPlayers,
  };

  const wolfThread: any = await createThread(token, game.gameChannelId, {
    name: "🐺 Tanière", type: 12, auto_archive_duration: 1440,
  });
  game.wolfChannelId = wolfThread.id;
  voteState.wolfChannelId = wolfThread.id;

  for (const wolfId of wolfIds) {
    await addThreadMember(token, wolfThread.id, wolfId);
  }

  // If petite fille is alive, create spy thread
  const petiteFilleId = livingPlayers.find(id => game.roles![id] === "petite_fille");
  if (petiteFilleId) {
    const spyThread: any = await createThread(token, game.gameChannelId, {
      name: "👧 Espionnage", type: 12, auto_archive_duration: 1440,
    });
    game.petiteFilleThreadId = spyThread.id;
    voteState.petiteFilleThreadId = spyThread.id;

    await addThreadMember(token, spyThread.id, petiteFilleId);
    await sendMessage(token, spyThread.id, {
      embeds: [{
        title: "👧 Petite Fille — Espionnage nocturne",
        description: "Tu espionnes les loups-garous cette nuit...\n\nTu verras leurs votes apparaître ici en temps réel.\nIls ne savent pas que tu les observes.\n\n*Fais attention à ne pas te faire repérer...*",
        color: 0x9b59b6, thumbnail: { url: getRoleImage("petite_fille") },
      }],
    });
  }

  const wolfMentions = wolfIds.map(id => `<@${id}>`).join(" ");
  await sendMessage(token, wolfThread.id, {
    content: `${wolfMentions}\n\n🌙 **La nuit est tombée!** Choisissez votre victime ci-dessous.`,
  });
  const voteMsg: any = await sendMessage(token, wolfThread.id, buildVoteEmbed(voteState));

  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
      body: JSON.stringify({ phase: "night_vote_timer", voteMessageId: voteMsg.id, wolfChannelId: wolfThread.id }),
    }).catch(err => console.error("Vote timer trigger failed:", err))
  );
}

// ── Night Phase Orchestrator ────────────────────────────────────────
// Turn order: Night 1 → Cupidon picks couple → Voyante → Wolves
//             Night 2+ → Voyante → Wolves directly

async function startNightPhase(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  if (!game.roles) return;

  // Increment night count and persist
  game.nightCount = (game.nightCount ?? 0) + 1;
  if (game.lobbyMessageId) {
    const stateUrl = `https://garou.bot/s/${encodeState(game)}`;
    try {
      const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
      const embed = msg.embeds?.[0];
      if (embed) {
        embed.url = stateUrl;
        await editMessage(token, game.gameChannelId, game.lobbyMessageId, { embeds: [embed], components: msg.components ?? [] });
      }
    } catch {}
  }

  // Night 1 + cupidon alive → cupidon picks couple first, then chains to voyante → wolves
  if (game.nightCount === 1) {
    const dead = game.dead ?? [];
    const cupidonEntry = Object.entries(game.roles).find(([id, r]) => r === "cupidon" && !dead.includes(id));
    if (cupidonEntry) {
      const cupidonId = cupidonEntry[0];
      const livingPlayers = game.players.filter(id => !dead.includes(id));

      const playerTargets = await Promise.all(
        livingPlayers.filter(id => id !== cupidonId).map(async (id) => {
          const member: any = await getGuildMember(token, game.guildId, id);
          return { id, name: member.nick || member.user.global_name || member.user.username };
        })
      );

      const deadline = Math.floor(Date.now() / 1000) + CUPIDON_TIMEOUT_SECONDS;

      const cupidonThread: any = await createThread(token, game.gameChannelId, {
        name: "\u{1F498} Cupidon", type: 12, auto_archive_duration: 1440,
      });
      await addThreadMember(token, cupidonThread.id, cupidonId);

      const cupidonState: CupidonState = {
        gameNumber: game.gameNumber, guildId: game.guildId,
        gameChannelId: game.gameChannelId, lobbyMessageId: game.lobbyMessageId!,
        cupidonId, players: playerTargets, picks: [], deadline,
        roles: game.roles, allPlayers: game.players,
      };

      await sendMessage(token, cupidonThread.id, {
        content: `<@${cupidonId}>\n\n\u{1F498} **Cupidon se r\u00e9veille!** Choisis deux joueurs \u00e0 lier par l'amour.`,
      });
      const cupidonMsg: any = await sendMessage(token, cupidonThread.id, buildCupidonEmbed(cupidonState));

      ctx.waitUntil(
        fetch(WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
          body: JSON.stringify({ phase: "cupidon_timer", cupidonMessageId: cupidonMsg.id, cupidonThreadId: cupidonThread.id }),
        }).catch(err => console.error("Cupidon timer trigger failed:", err))
      );

      return;
    }
  }

  // No cupidon (or not night 1) → go to voyante phase which chains to wolf_phase
  triggerPhase(ctx, env, "voyante_phase", { game });
}

// ── Voyante Phase ────────────────────────────────────────────────────

async function phaseVoyante(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  if (!game.roles) { triggerPhase(ctx, env, "wolf_phase", { game }); return; }
  const dead = game.dead ?? [];

  const voyanteEntry = Object.entries(game.roles).find(([id, r]) => r === "voyante" && !dead.includes(id));
  if (!voyanteEntry) {
    triggerPhase(ctx, env, "wolf_phase", { game });
    return;
  }
  const voyanteId = voyanteEntry[0];

  // Targets = all living players except voyante
  const targetIds = game.players.filter((id) => id !== voyanteId && !dead.includes(id));
  const targets = await Promise.all(
    targetIds.map(async (id) => {
      const member: any = await getGuildMember(token, game.guildId, id);
      return { id, name: member.nick || member.user.global_name || member.user.username };
    })
  );

  const deadline = Math.floor(Date.now() / 1000) + VOYANTE_TIMEOUT_SECONDS;

  // Create private thread for voyante
  const voyanteThread: any = await createThread(token, game.gameChannelId, {
    name: "🔮 Vision",
    type: 12,
    auto_archive_duration: 1440,
  });

  await addThreadMember(token, voyanteThread.id, voyanteId);

  const vyState: VoyanteState = {
    gameNumber: game.gameNumber,
    guildId: game.guildId,
    gameChannelId: game.gameChannelId,
    voyanteThreadId: voyanteThread.id,
    lobbyMessageId: game.lobbyMessageId!,
    voyanteId,
    targets,
    deadline,
    allRoles: game.roles,
  };

  await sendMessage(token, voyanteThread.id, {
    content: `<@${voyanteId}>\n\n🔮 **La Voyante se réveille!** Choisis un joueur à espionner.`,
  });
  const vyMsg: any = await sendMessage(token, voyanteThread.id, buildVoyanteEmbed(vyState));

  // Schedule timer
  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
      body: JSON.stringify({ phase: "voyante_timer", voyanteMessageId: vyMsg.id, voyanteThreadId: voyanteThread.id, game }),
    }).catch((err) => console.error("Voyante timer trigger failed:", err))
  );
}

async function phaseVoyanteTimer(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { voyanteMessageId, voyanteThreadId, game } = data;
  if (!voyanteMessageId || !voyanteThreadId) return;

  const start = Date.now();
  while (Date.now() - start < 25000) {
    await sleep(5000);
    try {
      const msg: any = await getMessage(token, voyanteThreadId, voyanteMessageId);
      if (!msg.components?.length) {
        // Resolved — delete thread, move to wolf phase
        try { await deleteChannel(token, voyanteThreadId); } catch {}
        triggerPhase(ctx, env, "wolf_phase", { game });
        return;
      }
      const vy = parseVoyanteFromEmbed(msg);
      if (!vy) return;
      if (Date.now() / 1000 >= vy.deadline) {
        // Timeout — remove buttons, delete thread, move on
        await editMessage(token, voyanteThreadId, voyanteMessageId, {
          embeds: [{
            title: `🔮 Vision de la Voyante — Temps écoulé`,
            description: "La Voyante n'a pas choisi à temps.",
            color: EMBED_COLOR_PURPLE,
            thumbnail: { url: getRoleImage("voyante") },
          }],
          components: [],
        });
        await sleep(2000);
        try { await deleteChannel(token, voyanteThreadId); } catch {}
        triggerPhase(ctx, env, "wolf_phase", { game });
        return;
      }
    } catch { return; }
  }
  // Re-invoke
  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
      body: JSON.stringify({ phase: "voyante_timer", voyanteMessageId, voyanteThreadId, game }),
    }).catch((err) => console.error("Voyante timer re-trigger failed:", err))
  );
}

async function handleVoyanteSee(interaction: any, env: Env): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur.", flags: 64 } });

  const vy = parseVoyanteFromEmbed(interaction.message);
  if (!vy) return json({ type: 4, data: { content: "❌ Erreur: état introuvable.", flags: 64 } });
  if (userId !== vy.voyanteId) return json({ type: 4, data: { content: "❌ Seule la Voyante peut utiliser ce pouvoir.", flags: 64 } });

  const customId: string = interaction.data?.custom_id || "";
  const targetId = customId.replace(`voyante_see_${vy.gameNumber}_`, "");
  const target = vy.targets.find((t) => t.id === targetId);
  if (!target) return json({ type: 4, data: { content: "❌ Cible invalide.", flags: 64 } });

  const roleKey = vy.allRoles[targetId] ?? "villageois";
  const role = ROLES[roleKey] ?? ROLES.villageois!;

  // Mark resolved
  vy.resolved = true;
  const stateUrl = `https://garou.bot/vy/${encodeVoyanteState(vy)}`;

  return json({
    type: 7,
    data: {
      embeds: [{
        title: `🔮 Vision de la Voyante — Partie #${vy.gameNumber}`,
        url: stateUrl,
        description: [
          `Tu as espionné **${target.name}**...`,
          "",
          "━━━━━━━━━━━━━━━━━━━━",
          "",
          `${role.emoji} **${target.name}** est **${role.name}**!`,
          "",
          "━━━━━━━━━━━━━━━━━━━━",
        ].join("\n"),
        color: EMBED_COLOR_PURPLE,
        image: { url: getRoleImage(roleKey) },
      }],
      components: [],
    },
  });
}

// ── Phase: night_vote_timer — poll until deadline then auto-resolve ──
async function phaseVoteTimer(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { voteMessageId, wolfChannelId } = data;
  if (!voteMessageId || !wolfChannelId) return;

  const start = Date.now();
  while (Date.now() - start < 25000) {
    await sleep(5000);
    try {
      const currentMsg: any = await getMessage(token, wolfChannelId, voteMessageId);
      if (!currentMsg.components?.length) return; // Already resolved
      const currentVote = parseVoteFromEmbed(currentMsg);
      if (!currentVote) return;
      if (Date.now() / 1000 >= currentVote.deadline) {
        await resolveNightVote(token, currentVote, voteMessageId, ctx, env);
        return;
      }
    } catch { return; }
  }
  // Not resolved yet — re-invoke
  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
      body: JSON.stringify({ phase: "night_vote_timer", voteMessageId, wolfChannelId }),
    }).catch((err) => console.error("Vote timer re-trigger failed:", err))
  );
}

// ── Win Conditions ──────────────────────────────────────────────────

interface WinResult {
  winner: "village" | "loups" | "loup_blanc";
  title: string;
  description: string;
  image: string;
}

function checkWinCondition(game: GameState): WinResult | null {
  if (!game.roles) return null;
  const dead = game.dead ?? [];
  const alive = game.players.filter((id) => !dead.includes(id));

  const aliveWolves = alive.filter((id) => {
    const r = game.roles![id];
    return r === "loup" || r === "loup_blanc";
  });
  const aliveLoupBlanc = alive.filter((id) => game.roles![id] === "loup_blanc");
  const aliveVillagers = alive.filter((id) => {
    const r = game.roles![id];
    return r !== "loup" && r !== "loup_blanc";
  });

  // Loup Blanc wins if they are the last one alive
  if (alive.length === 1 && aliveLoupBlanc.length === 1) {
    return {
      winner: "loup_blanc",
      title: "⚪ Le Loup-Garou Blanc triomphe!",
      description: "Le Loup-Garou Blanc a éliminé tout le monde et règne seul sur le village désolé.",
      image: SCENE_IMAGES.victory_wolves,
    };
  }

  // All wolves dead → village wins
  if (aliveWolves.length === 0) {
    return {
      winner: "village",
      title: "🏘️ Le village est sauvé!",
      description: "Les villageois ont réussi à éliminer tous les loups-garous. La paix revient au village!",
      image: SCENE_IMAGES.victory_village,
    };
  }

  // Wolves >= villagers → wolves win
  if (aliveWolves.length >= aliveVillagers.length) {
    return {
      winner: "loups",
      title: "🐺 Les Loups-Garous ont gagné!",
      description: "Les loups-garous sont désormais aussi nombreux que les villageois. Le village est perdu!",
      image: SCENE_IMAGES.victory_wolves,
    };
  }

  return null;
}

async function announceVictory(token: string, game: GameState, result: WinResult, env: Env) {
  const dead = game.dead ?? [];

  // Build role reveal lines
  const revealLines = game.players.map((id) => {
    const roleKey = game.roles?.[id] ?? "villageois";
    const role = ROLES[roleKey] ?? ROLES.villageois!;
    const isDead = dead.includes(id);
    const status = isDead ? "💀" : "✅";
    return `${status} ${role.emoji} <@${id}> — **${role.name}**`;
  });

  await sendMessage(token, game.gameChannelId, {
    embeds: [{
      title: result.title,
      description: [
        result.description,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "**Récapitulatif des rôles:**",
        "",
        ...revealLines,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `🎮 **Partie #${game.gameNumber}** terminée!`,
      ].join("\n"),
      color: result.winner === "village" ? EMBED_COLOR_GREEN : EMBED_COLOR,
      image: { url: result.image },
    }],
  });

  // Clear KV entries for all players
  await clearAllPlayersForGame(env.ACTIVE_PLAYERS, game.players);

  // Clean up wolf channel if exists
  if (game.wolfChannelId) {
    try { await deleteChannel(token, game.wolfChannelId); } catch {}
  }

  // Clean up voice channel if exists
  if (game.voiceChannelId) {
    try { await deleteChannel(token, game.voiceChannelId); } catch {}
  }
}

async function resolveNightVote(token: string, vote: VoteState, voteMessageId: string, ctx?: ExecutionContext, env?: Env) {
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
        "*Le vote est terminé.*",
      ].join("\n"),
      color: EMBED_COLOR,
      image: { url: SCENE_IMAGES.night_kill },
    }],
    components: [],
  });

  // Delete wolf thread — a new one will be created next night
  try { await deleteChannel(token, vote.wolfChannelId); } catch {}

  // Recover game state and chain to post_wolf
  if (ctx && env) {
    let game: GameState | null = null;
    if (vote.lobbyMessageId && vote.gameChannelId) {
      try {
        const lobbyMsg: any = await getMessage(token, vote.gameChannelId, vote.lobbyMessageId);
        game = parseGameFromEmbed(lobbyMsg);
      } catch {}
    }
    if (game) {
      triggerPhase(ctx, env, "post_wolf", { game, _wolfVictimId: victimId, _wolfVictimName: victim.name });
      return;
    }
  }

  // Fallback: announce death directly if no ctx/env (should not happen in practice)
  await sendMessage(token, vote.gameChannelId, {
    embeds: [{
      title: "☀️ Le jour se lève...",
      description: [
        `Les villageois découvrent avec horreur que **${victim.name}** (<@${victim.id}>) a été dévoré(e) par les loups-garous cette nuit.`,
        "",
        "*Un moment de silence pour la victime...*",
      ].join("\n"),
      color: EMBED_COLOR,
      image: { url: SCENE_IMAGES.dawn_breaks },
    }],
  });
}

// ── Post-Wolf Routing ────────────────────────────────────────────────

async function phasePostWolf(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { game, _wolfVictimId, _wolfVictimName } = data as { game: GameState; _wolfVictimId: string; _wolfVictimName: string };
  if (!game) return;

  const dead = game.dead ?? [];

  // Check if sorciere is alive and has any potions
  const sorciereEntry = Object.entries(game.roles ?? {}).find(([id, r]) => r === "sorciere" && !dead.includes(id));
  const potions = game.witchPotions ?? { life: false, death: false };
  const hasPotions = potions.life || potions.death;

  if (sorciereEntry && hasPotions) {
    triggerPhase(ctx, env, "sorciere_phase", { game, _wolfVictimId, _wolfVictimName });
  } else {
    triggerPhase(ctx, env, "dawn_phase", { game, _wolfVictimId, _wolfVictimName, _witchSaved: false, _witchKillId: undefined });
  }
}

// ── Dawn Phase ───────────────────────────────────────────────────────

async function phaseDawn(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { game, _wolfVictimId, _wolfVictimName, _witchSaved, _witchKillId } = data as {
    game: GameState; _wolfVictimId: string; _wolfVictimName: string;
    _witchSaved?: boolean; _witchKillId?: string;
  };
  if (!game) return;

  if (!game.dead) game.dead = [];
  const deaths: { id: string; name: string; cause: string }[] = [];

  // Wolf kill (unless witch saved)
  if (!_witchSaved && _wolfVictimId) {
    if (!game.dead.includes(_wolfVictimId)) {
      game.dead.push(_wolfVictimId);
      deaths.push({ id: _wolfVictimId, name: _wolfVictimName, cause: "dévoré(e) par les loups-garous" });
      try {
        await setChannelPermission(token, game.gameChannelId, _wolfVictimId, {
          allow: String(1 << 10), deny: String(1 << 11), type: 1,
        });
      } catch {}
    }
  }

  // Witch kill
  if (_witchKillId) {
    if (!game.dead.includes(_witchKillId)) {
      game.dead.push(_witchKillId);
      let killName = _witchKillId;
      try {
        const member: any = await getGuildMember(token, game.guildId, _witchKillId);
        killName = member.nick || member.user.global_name || member.user.username;
      } catch {}
      deaths.push({ id: _witchKillId, name: killName, cause: "empoisonné(e) pendant la nuit" });
      try {
        await setChannelPermission(token, game.gameChannelId, _witchKillId, {
          allow: String(1 << 10), deny: String(1 << 11), type: 1,
        });
      } catch {}
    }
  }

  // Couple death chain — if any dead player is in the couple, the partner dies too
  if (game.couple) {
    for (const d of [...deaths]) {
      if (game.couple.includes(d.id)) {
        const partnerId = d.id === game.couple[0] ? game.couple[1] : game.couple[0];
        if (!game.dead.includes(partnerId)) {
          game.dead.push(partnerId);
          let partnerName = "?";
          try {
            const pm: any = await getGuildMember(token, game.guildId, partnerId);
            partnerName = pm.nick || pm.user.global_name || pm.user.username;
          } catch {}
          deaths.push({ id: partnerId, name: partnerName, cause: "mort(e) de chagrin (couple 💔)" });
          try {
            await setChannelPermission(token, game.gameChannelId, partnerId, {
              allow: String(1 << 10), deny: String(1 << 11), type: 1,
            });
          } catch {}
        }
      }
    }
  }

  // Update witch potions: consume used potions
  if (_witchSaved && game.witchPotions) {
    game.witchPotions.life = false;
  }
  if (_witchKillId && game.witchPotions) {
    game.witchPotions.death = false;
  }

  // Clean up petite fille spy thread if it exists
  if (game.petiteFilleThreadId) {
    try { await deleteChannel(token, game.petiteFilleThreadId); } catch {}
    game.petiteFilleThreadId = undefined;
  }

  // Persist updated state to lobby embed
  if (game.lobbyMessageId) {
    const stateUrl = `https://garou.bot/s/${encodeState(game)}`;
    try {
      const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
      const embed = msg.embeds?.[0];
      if (embed) {
        embed.url = stateUrl;
        await editMessage(token, game.gameChannelId, game.lobbyMessageId, { embeds: [embed], components: msg.components ?? [] });
      }
    } catch {}
  }

  // Check win conditions first
  const winResult = checkWinCondition(game);

  // Announce deaths
  if (deaths.length === 0) {
    await sendMessage(token, game.gameChannelId, {
      embeds: [{
        title: "☀️ Le jour se lève...",
        description: [
          "Les villageois se réveillent et... **personne n'est mort cette nuit!** 🎉",
          "",
          "*La sorcière a veillé sur le village...*",
        ].join("\n"),
        color: EMBED_COLOR_GREEN,
        image: { url: SCENE_IMAGES.dawn_breaks },
      }],
    });
  } else if (deaths.length === 1) {
    const d = deaths[0]!;
    await sendMessage(token, game.gameChannelId, {
      embeds: [{
        title: "☀️ Le jour se lève...",
        description: [
          `Les villageois découvrent avec horreur que **${d.name}** (<@${d.id}>) a été ${d.cause} cette nuit.`,
          "",
          "*Un moment de silence pour la victime...*",
        ].join("\n"),
        color: EMBED_COLOR,
        image: { url: SCENE_IMAGES.dawn_breaks },
      }],
    });
  } else {
    const deathLines = deaths.map((d) => `💀 **${d.name}** (<@${d.id}>) — ${d.cause}`);
    await sendMessage(token, game.gameChannelId, {
      embeds: [{
        title: "☀️ Le jour se lève... Double meurtre!",
        description: [
          "Les villageois découvrent avec horreur que **deux personnes** sont mortes cette nuit!",
          "",
          "━━━━━━━━━━━━━━━━━━━━",
          "",
          ...deathLines,
          "",
          "━━━━━━━━━━━━━━━━━━━━",
          "",
          "*Un moment de silence pour les victimes...*",
        ].join("\n"),
        color: EMBED_COLOR,
        image: { url: SCENE_IMAGES.dawn_breaks },
      }],
    });
  }

  // Check if any dead player is a chasseur → trigger their last shot
  for (const d of deaths) {
    if (game.roles?.[d.id] === "chasseur") {
      await sleep(2000);
      await triggerChasseurShoot(token, game, d.id, ctx, env);
      // Chasseur handler will check win conditions after shooting
      return;
    }
  }

  if (winResult) {
    await sleep(3000);
    await announceVictory(token, game, winResult, env);
    return;
  }

  // Trigger loup_blanc vote on even nights if loup_blanc is alive
  if (game.nightCount && game.nightCount % 2 === 0) {
    const loupBlancEntry = Object.entries(game.roles ?? {}).find(([id, r]) => r === "loup_blanc" && !game.dead!.includes(id));
    if (loupBlancEntry) {
      triggerPhase(ctx, env, "loup_blanc_vote", { game });
      return;
    }
  }
}

// ── Sorciere Phase ───────────────────────────────────────────────────

async function phaseSorciere(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { game, _wolfVictimId, _wolfVictimName } = data as { game: GameState; _wolfVictimId: string; _wolfVictimName: string };
  if (!game?.roles) { triggerPhase(ctx, env, "dawn_phase", { game, _wolfVictimId, _wolfVictimName, _witchSaved: false }); return; }

  const dead = game.dead ?? [];
  const sorciereEntry = Object.entries(game.roles).find(([id, r]) => r === "sorciere" && !dead.includes(id));
  if (!sorciereEntry) {
    triggerPhase(ctx, env, "dawn_phase", { game, _wolfVictimId, _wolfVictimName, _witchSaved: false });
    return;
  }
  const sorciereId = sorciereEntry[0];
  const potions = game.witchPotions ?? { life: false, death: false };

  // Build targets for death potion (all living players except sorciere)
  const targetIds = game.players.filter((id) => id !== sorciereId && !dead.includes(id));
  const targets = await Promise.all(
    targetIds.map(async (id) => {
      const member: any = await getGuildMember(token, game.guildId, id);
      return { id, name: member.nick || member.user.global_name || member.user.username };
    })
  );

  const deadline = Math.floor(Date.now() / 1000) + SORCIERE_TIMEOUT_SECONDS;

  // Create private thread
  const sorciereThread: any = await createThread(token, game.gameChannelId, {
    name: "🧪 Laboratoire",
    type: 12,
    auto_archive_duration: 1440,
  });

  await addThreadMember(token, sorciereThread.id, sorciereId);

  const soState: SorciereState = {
    gameNumber: game.gameNumber,
    guildId: game.guildId,
    gameChannelId: game.gameChannelId,
    sorciereThreadId: sorciereThread.id,
    lobbyMessageId: game.lobbyMessageId!,
    sorciereId,
    wolfVictimId: _wolfVictimId,
    wolfVictimName: _wolfVictimName,
    potions,
    targets,
    deadline,
  };

  await sendMessage(token, sorciereThread.id, {
    content: `<@${sorciereId}>\n\n🧪 **La Sorcière se réveille!** Les loups ont choisi leur victime...`,
  });
  const soMsg: any = await sendMessage(token, sorciereThread.id, buildSorciereEmbed(soState));

  // Schedule timer
  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
      body: JSON.stringify({
        phase: "sorciere_timer",
        sorciereMessageId: soMsg.id,
        sorciereThreadId: sorciereThread.id,
        game,
        _wolfVictimId,
        _wolfVictimName,
      }),
    }).catch((err) => console.error("Sorciere timer trigger failed:", err))
  );
}

async function phaseSorciereTimer(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { sorciereMessageId, sorciereThreadId, game, _wolfVictimId, _wolfVictimName } = data;
  if (!sorciereMessageId || !sorciereThreadId) return;

  const start = Date.now();
  while (Date.now() - start < 25000) {
    await sleep(5000);
    try {
      const msg: any = await getMessage(token, sorciereThreadId, sorciereMessageId);
      if (!msg.components?.length) {
        // Resolved — read decision from embed state
        const so = parseSorciereFromEmbed(msg);
        const witchSaved = so?.witchSaved ?? false;
        const witchKillId = so?.witchKillTargetId;
        try { await deleteChannel(token, sorciereThreadId); } catch {}
        triggerPhase(ctx, env, "dawn_phase", { game, _wolfVictimId, _wolfVictimName, _witchSaved: witchSaved, _witchKillId: witchKillId });
        return;
      }
      const so = parseSorciereFromEmbed(msg);
      if (!so) return;
      if (Date.now() / 1000 >= so.deadline) {
        // Timeout — skip
        await editMessage(token, sorciereThreadId, sorciereMessageId, {
          embeds: [{
            title: `🧪 Sorcière — Temps écoulé`,
            description: "La Sorcière n'a pas agi à temps.",
            color: EMBED_COLOR_PURPLE,
            thumbnail: { url: getRoleImage("sorciere") },
          }],
          components: [],
        });
        await sleep(2000);
        try { await deleteChannel(token, sorciereThreadId); } catch {}
        triggerPhase(ctx, env, "dawn_phase", { game, _wolfVictimId, _wolfVictimName, _witchSaved: false });
        return;
      }
    } catch { return; }
  }
  // Re-invoke
  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
      body: JSON.stringify({ phase: "sorciere_timer", sorciereMessageId, sorciereThreadId, game, _wolfVictimId, _wolfVictimName }),
    }).catch((err) => console.error("Sorciere timer re-trigger failed:", err))
  );
}

async function handleSorciereLife(interaction: any, env: Env): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const so = parseSorciereFromEmbed(interaction.message);
  if (!so) return json({ type: 4, data: { content: "❌ Erreur: état introuvable.", flags: 64 } });
  if (userId !== so.sorciereId) return json({ type: 4, data: { content: "❌ Seule la Sorcière peut utiliser ce pouvoir.", flags: 64 } });
  if (!so.potions.life) return json({ type: 4, data: { content: "❌ Tu as déjà utilisé ta Potion de Vie.", flags: 64 } });

  so.witchSaved = true;
  so.resolved = true;
  const stateUrl = `https://garou.bot/so/${encodeSorciereState(so)}`;

  return json({
    type: 7,
    data: {
      embeds: [{
        title: `🧪 Sorcière — Partie #${so.gameNumber}`,
        url: stateUrl,
        description: [
          `💚 Tu as utilisé la **Potion de Vie** pour sauver **${so.wolfVictimName}**!`,
          "",
          "*La victime des loups survivra cette nuit.*",
        ].join("\n"),
        color: EMBED_COLOR_GREEN,
        thumbnail: { url: getRoleImage("sorciere") },
      }],
      components: [],
    },
  });
}

async function handleSorciereDeath(interaction: any, env: Env): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const so = parseSorciereFromEmbed(interaction.message);
  if (!so) return json({ type: 4, data: { content: "❌ Erreur: état introuvable.", flags: 64 } });
  if (userId !== so.sorciereId) return json({ type: 4, data: { content: "❌ Seule la Sorcière peut utiliser ce pouvoir.", flags: 64 } });
  if (!so.potions.death) return json({ type: 4, data: { content: "❌ Tu as déjà utilisé ta Potion de Mort.", flags: 64 } });

  // Show target picker
  return json({ type: 7, data: buildSorciereTargetEmbed(so) });
}

async function handleSorciereTarget(interaction: any, env: Env): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const so = parseSorciereFromEmbed(interaction.message);
  if (!so) return json({ type: 4, data: { content: "❌ Erreur: état introuvable.", flags: 64 } });
  if (userId !== so.sorciereId) return json({ type: 4, data: { content: "❌ Seule la Sorcière peut utiliser ce pouvoir.", flags: 64 } });

  const customId: string = interaction.data?.custom_id || "";
  const targetId = customId.replace(`sorciere_target_${so.gameNumber}_`, "");
  const target = so.targets.find((t) => t.id === targetId);
  if (!target) return json({ type: 4, data: { content: "❌ Cible invalide.", flags: 64 } });

  so.witchKillTargetId = targetId;
  so.resolved = true;
  const stateUrl = `https://garou.bot/so/${encodeSorciereState(so)}`;

  return json({
    type: 7,
    data: {
      embeds: [{
        title: `🧪 Sorcière — Partie #${so.gameNumber}`,
        url: stateUrl,
        description: [
          `💀 Tu as utilisé la **Potion de Mort** sur **${target.name}**!`,
          "",
          "*Ton poison fera effet cette nuit...*",
        ].join("\n"),
        color: EMBED_COLOR,
        thumbnail: { url: getRoleImage("sorciere") },
      }],
      components: [],
    },
  });
}

async function handleSorciereSkip(interaction: any, env: Env): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const so = parseSorciereFromEmbed(interaction.message);
  if (!so) return json({ type: 4, data: { content: "❌ Erreur: état introuvable.", flags: 64 } });
  if (userId !== so.sorciereId) return json({ type: 4, data: { content: "❌ Seule la Sorcière peut faire ça.", flags: 64 } });

  so.resolved = true;
  const stateUrl = `https://garou.bot/so/${encodeSorciereState(so)}`;

  return json({
    type: 7,
    data: {
      embeds: [{
        title: `🧪 Sorcière — Partie #${so.gameNumber}`,
        url: stateUrl,
        description: "Tu as choisi de ne rien faire cette nuit.",
        color: EMBED_COLOR_PURPLE,
        thumbnail: { url: getRoleImage("sorciere") },
      }],
      components: [],
    },
  });
}

// ── Loup Blanc Solo Kill System ──────────────────────────────────────

interface LoupBlancVoteState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  lobbyMessageId: string;
  loupBlancId: string;
  targets: { id: string; name: string }[];
  dmChannelId: string;
  dmMessageId: string;
  deadline: number;
}

function encodeLBState(lb: LoupBlancVoteState): string {
  return btoa(JSON.stringify({
    g: lb.gameNumber, gi: lb.guildId, gc: lb.gameChannelId,
    lm: lb.lobbyMessageId, lb: lb.loupBlancId,
    t: lb.targets.map((t) => [t.id, t.name]),
    dc: lb.dmChannelId, dm: lb.dmMessageId, dl: lb.deadline,
  }));
}

function decodeLBState(url: string): LoupBlancVoteState | null {
  try {
    const b64 = url.split("/lb/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc,
      lobbyMessageId: c.lm, loupBlancId: c.lb,
      targets: (c.t as [string, string][]).map(([id, name]) => ({ id, name })),
      dmChannelId: c.dc, dmMessageId: c.dm, deadline: c.dl,
    };
  } catch { return null; }
}

const LOUP_BLANC_VOTE_SECONDS = 30;

async function phaseLoupBlancVote(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  if (!game.roles) return;
  const dead = game.dead ?? [];

  const loupBlancEntry = Object.entries(game.roles).find(([id, r]) => r === "loup_blanc" && !dead.includes(id));
  if (!loupBlancEntry) return;
  const loupBlancId = loupBlancEntry[0];

  // Targets = living regular wolves (not loup_blanc itself)
  const wolfTargetIds = Object.entries(game.roles)
    .filter(([id, r]) => r === "loup" && !dead.includes(id) && id !== loupBlancId)
    .map(([id]) => id);

  if (wolfTargetIds.length === 0) return; // No wolves to kill

  const targets = await Promise.all(
    wolfTargetIds.map(async (id) => {
      const member: any = await getGuildMember(token, game.guildId, id);
      return { id, name: member.nick || member.user.global_name || member.user.username };
    })
  );

  const deadline = Math.floor(Date.now() / 1000) + LOUP_BLANC_VOTE_SECONDS;

  // Create DM channel to loup_blanc
  const dmChannel: any = await createDM(token, loupBlancId);

  const lbState: LoupBlancVoteState = {
    gameNumber: game.gameNumber,
    guildId: game.guildId,
    gameChannelId: game.gameChannelId,
    lobbyMessageId: game.lobbyMessageId!,
    loupBlancId,
    targets,
    dmChannelId: dmChannel.id,
    dmMessageId: "", // will be set after sending
    deadline,
  };

  const stateUrl = `https://garou.bot/lb/${encodeLBState(lbState)}`;

  // Build kill buttons + skip button
  const killButtons: any[] = targets.map((t) => ({
    type: 2,
    style: 4,
    label: `🔪 ${t.name}`,
    custom_id: `lb_kill_${game.gameNumber}_${t.id}`,
  }));

  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const btn of killButtons) {
    currentRow.push(btn);
    if (currentRow.length === 5) {
      buttonRows.push({ type: 1, components: currentRow });
      currentRow = [];
    }
  }
  // Add skip button in the last row or a new one
  currentRow.push({
    type: 2,
    style: 2,
    label: "⏭️ Passer",
    custom_id: `lb_skip_${game.gameNumber}`,
  });
  buttonRows.push({ type: 1, components: currentRow });

  const dmMsg: any = await sendMessage(token, dmChannel.id, {
    embeds: [{
      title: `⚪ Loup-Garou Blanc — Nuit ${game.nightCount}`,
      url: stateUrl,
      description: [
        "**C'est ton tour!** Tu peux éliminer un loup-garou cette nuit.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...targets.map((t) => `🐺 **${t.name}** (<@${t.id}>)`),
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `⏰ Tu as **${LOUP_BLANC_VOTE_SECONDS}s** pour décider. (<t:${deadline}:R>)`,
        "",
        "*Tu peux aussi passer ton tour.*",
      ].join("\n"),
      color: 0xffffff,
      thumbnail: { url: getRoleImage("loup_blanc") },
    }],
    components: buttonRows,
  });

  // Update state with DM message ID and re-encode
  lbState.dmMessageId = dmMsg.id;
  const updatedUrl = `https://garou.bot/lb/${encodeLBState(lbState)}`;
  await editMessage(token, dmChannel.id, dmMsg.id, {
    embeds: [{
      ...dmMsg.embeds[0],
      url: updatedUrl,
    }],
    components: buttonRows,
  });

  // Schedule timer via direct self-invocation (not triggerPhase, since we need custom payload)
  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
      body: JSON.stringify({ phase: "loup_blanc_timer", lbDmChannelId: dmChannel.id, lbDmMessageId: dmMsg.id }),
    }).catch((err) => console.error("LB timer trigger failed:", err))
  );
}

async function handleLoupBlancKill(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur.", flags: 64 } });

  const lb = (() => {
    const embed = interaction.message?.embeds?.[0];
    if (!embed?.url?.includes("/lb/")) return null;
    return decodeLBState(embed.url);
  })();
  if (!lb) return json({ type: 4, data: { content: "❌ Erreur: état introuvable.", flags: 64 } });

  if (userId !== lb.loupBlancId) {
    return json({ type: 4, data: { content: "❌ Ce n'est pas ton choix.", flags: 64 } });
  }

  const customId: string = interaction.data?.custom_id || "";
  const token = env.DISCORD_BOT_TOKEN;

  // Handle skip
  if (customId.startsWith("lb_skip_")) {
    return json({
      type: 7,
      data: {
        embeds: [{
          title: "⚪ Loup-Garou Blanc — Passé",
          description: "Tu as choisi de ne tuer personne cette nuit.",
          color: 0xffffff,
          thumbnail: { url: getRoleImage("loup_blanc") },
        }],
        components: [],
      },
    });
  }

  // Handle kill
  const targetId = customId.replace(`lb_kill_${lb.gameNumber}_`, "");
  const target = lb.targets.find((t) => t.id === targetId);
  if (!target) return json({ type: 4, data: { content: "❌ Cible invalide.", flags: 64 } });

  // Remove buttons immediately
  const ackResponse = json({
    type: 7,
    data: {
      embeds: [{
        title: "⚪ Loup-Garou Blanc — Choix fait",
        description: `Tu as choisi d'éliminer **${target.name}**.`,
        color: 0xffffff,
        thumbnail: { url: getRoleImage("loup_blanc") },
      }],
      components: [],
    },
  });

  // Process kill in background
  ctx.waitUntil((async () => {
    try {
      // Recover game state
      let game: GameState | null = null;
      try {
        const lobbyMsg: any = await getMessage(token, lb.gameChannelId, lb.lobbyMessageId);
        game = parseGameFromEmbed(lobbyMsg);
      } catch {}
      if (!game) return;

      if (!game.dead) game.dead = [];
      game.dead.push(targetId);

      // Set victim as spectator
      try {
        await setChannelPermission(token, lb.gameChannelId, targetId, {
          allow: String(1 << 10),
          deny: String(1 << 11),
          type: 1,
        });
      } catch {}

      // Persist state
      if (game.lobbyMessageId) {
        const stateUrl = `https://garou.bot/s/${encodeState(game)}`;
        try {
          const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
          const embed = msg.embeds?.[0];
          if (embed) {
            embed.url = stateUrl;
            await editMessage(token, game.gameChannelId, game.lobbyMessageId, { embeds: [embed], components: msg.components ?? [] });
          }
        } catch {}
      }

      // Announce mysterious death in game channel
      await sendMessage(token, lb.gameChannelId, {
        embeds: [{
          title: "💀 Une mort mystérieuse...",
          description: [
            `Au petit matin, les villageois trouvent le corps sans vie de **${target.name}** (<@${targetId}>).`,
            "",
            "*Personne ne sait ce qui s'est passé...*",
          ].join("\n"),
          color: 0xffffff,
          image: { url: SCENE_IMAGES.night_kill },
        }],
      });

      // Check win conditions
      const winResult = checkWinCondition(game);
      if (winResult) {
        await sleep(2000);
        await announceVictory(token, game, winResult, env);
      }
    } catch (err) {
      console.error("Loup Blanc kill error:", err);
    }
  })());

  return ackResponse;
}

async function phaseLoupBlancTimer(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const dmChannelId = data.lbDmChannelId;
  const dmMessageId = data.lbDmMessageId;
  if (!dmChannelId || !dmMessageId) return;

  const start = Date.now();
  while (Date.now() - start < 25000) {
    await sleep(5000);
    try {
      const msg: any = await getMessage(token, dmChannelId, dmMessageId);
      if (!msg.components?.length) return; // Already resolved (player clicked)
      const lb = (() => {
        const embed = msg.embeds?.[0];
        if (!embed?.url?.includes("/lb/")) return null;
        return decodeLBState(embed.url);
      })();
      if (!lb) return;
      if (Date.now() / 1000 >= lb.deadline) {
        // Auto-skip: remove buttons
        await editMessage(token, dmChannelId, dmMessageId, {
          embeds: [{
            title: "⚪ Loup-Garou Blanc — Temps écoulé",
            description: "Tu n'as pas choisi à temps. Aucun loup n'est éliminé cette nuit.",
            color: 0xffffff,
            thumbnail: { url: getRoleImage("loup_blanc") },
          }],
          components: [],
        });
        return;
      }
    } catch { return; }
  }
  // Re-invoke if not resolved yet
  ctx.waitUntil(
    fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal": env.DISCORD_BOT_TOKEN },
      body: JSON.stringify({ phase: "loup_blanc_timer", ...data }),
    }).catch((err) => console.error("LB timer re-trigger failed:", err))
  );
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

  // Mirror vote to petite fille spy thread (non-blocking)
  if (vote.petiteFilleThreadId) {
    const wolfIndex = vote.wolves.indexOf(userId) + 1;
    const token = env.DISCORD_BOT_TOKEN;
    ctx.waitUntil(
      sendMessage(token, vote.petiteFilleThreadId, {
        content: `👀 **Loup #${wolfIndex}** a voté pour **${target.name}**`,
      }).catch(() => {})
    );
  }

  // Check if unanimous
  const allVoted = vote.wolves.every((wId) => vote.votes[wId]);
  const allSameTarget = allVoted && new Set(Object.values(vote.votes)).size === 1;

  if (allSameTarget) {
    // Unanimous! Resolve in background
    const token = env.DISCORD_BOT_TOKEN;
    ctx.waitUntil(resolveNightVote(token, vote, interaction.message.id, ctx, env));
    return json({ type: 7, data: buildVoteEmbed(vote) });
  }

  // Update embed with new vote
  return json({ type: 7, data: buildVoteEmbed(vote) });
}

// ── Reveal Role (ephemeral) ──────────────────────────────────────────

async function handleRevealRole(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
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
  const token = env.DISCORD_BOT_TOKEN;

  // Update seen list in background with retry loop to handle concurrent clicks
  if (game.lobbyMessageId) {
    ctx.waitUntil((async () => {
      const lobbyId = game.lobbyMessageId!;
      const channelId = game.gameChannelId;

      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          // Always re-read the latest embed before writing
          const latestMsg: any = await getMessage(token, channelId, lobbyId);
          const latest = parseGameFromEmbed(latestMsg);
          if (!latest) return;

          const seen = latest.seen ?? [];
          if (seen.includes(userId)) return; // Already saved by another attempt
          seen.push(userId);
          latest.seen = seen;

          await editMessage(token, channelId, lobbyId, buildRoleCheckEmbed(latest));

          // Verify our write persisted
          await sleep(150);
          const verifyMsg: any = await getMessage(token, channelId, lobbyId);
          const verify = parseGameFromEmbed(verifyMsg);
          if (verify?.seen?.includes(userId)) {
            // All players seen → trigger countdown + night
            if (verify.seen.length >= verify.players.length) {
              const title: string = verifyMsg.embeds?.[0]?.title ?? "";
              if (title.includes("Découvrez vos rôles")) {
                await runCountdownAndNight(token, verify, ctx, env);
              }
            }
            return; // Success
          }
          // Our write was overwritten — retry with backoff
          await sleep(200 * (attempt + 1));
        } catch {}
      }
    })());
  }

  // Build description lines
  const descLines = [
    "",
    `> ${role.description}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
  ];

  // Show wolf teammates if this player is a wolf (loup or loup_blanc)
  if (roleKey === "loup" || roleKey === "loup_blanc") {
    const teammates = Object.entries(game.roles)
      .filter(([id, r]) => (r === "loup" || r === "loup_blanc") && id !== userId)
      .map(([id]) => `🐺 <@${id}>`);
    if (teammates.length > 0) {
      descLines.push(`**Tes coéquipiers:**`, ...teammates, "", "━━━━━━━━━━━━━━━━━━━━", "");
    }
    if (roleKey === "loup_blanc") {
      descLines.push("⚪ **Objectif secret:** Élimine tous les autres joueurs — loups compris — pour gagner seul!", "", "━━━━━━━━━━━━━━━━━━━━", "");
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
          image: { url: getRoleImage(roleKey) },
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
    // Return immediately and run the phase in waitUntil so each phase gets its own 30s budget.
    const internalToken = req.headers.get("X-Internal");
    if (internalToken === env.DISCORD_BOT_TOKEN) {
      const payload = await req.json() as any;
      const { phase } = payload;
      const token = env.DISCORD_BOT_TOKEN;
      const work = (async () => {
        try {
          if (phase === "start_game") await startGame(token, payload.game, ctx, env);
          else if (phase === "night_start") await startNightPhase(token, payload.game, ctx, env);
          else if (phase === "voyante_phase") await phaseVoyante(token, payload.game, ctx, env);
          else if (phase === "voyante_timer") await phaseVoyanteTimer(token, payload, ctx, env);
          else if (phase === "wolf_phase") await startWolfPhase(token, payload.game, ctx, env);
          else if (phase === "night_vote_timer") await phaseVoteTimer(token, payload, ctx, env);
          else if (phase === "post_wolf") await phasePostWolf(token, payload, ctx, env);
          else if (phase === "sorciere_phase") await phaseSorciere(token, payload, ctx, env);
          else if (phase === "sorciere_timer") await phaseSorciereTimer(token, payload, ctx, env);
          else if (phase === "dawn_phase") await phaseDawn(token, payload, ctx, env);
          else if (phase === "cupidon_timer") await phaseCupidonTimer(token, payload, ctx, env);
          else if (phase === "chasseur_timer") await phaseChasseurTimer(token, payload, ctx, env);
          else if (phase === "loup_blanc_vote") await phaseLoupBlancVote(token, payload.game, ctx, env);
          else if (phase === "loup_blanc_timer") await phaseLoupBlancTimer(token, payload, ctx, env);
          else console.error("Unknown phase:", phase);
        } catch (err) {
          console.error(`Phase ${phase} failed:`, err);
        }
      })();
      ctx.waitUntil(work);
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

      // Config interactions (select menus & buttons)
      if (customId.startsWith("cfg_")) {
        const componentType = interaction.data?.component_type;
        if (componentType === 3) return handleConfigSelect(interaction, env);
        if (componentType === 2) return handleConfigButton(interaction, env, ctx);
      }

      if (customId.startsWith("join_game_")) return handleJoin(interaction, env, ctx);

      if (customId.startsWith("quit_game_")) return handleQuit(interaction, env);

      if (customId.startsWith("reveal_role_")) return handleRevealRole(interaction, env, ctx);

      if (customId.startsWith("voyante_see_")) return handleVoyanteSee(interaction, env);

      if (customId.startsWith("vote_kill_")) return handleVoteKill(interaction, env, ctx);

      if (customId.startsWith("cupidon_pick_")) return handleCupidonPick(interaction, env, ctx);
      if (customId.startsWith("cupidon_confirm_")) return handleCupidonConfirm(interaction, env, ctx);
      if (customId.startsWith("chasseur_shoot_")) return handleChasseurShoot(interaction, env, ctx);

      if (customId.startsWith("sorciere_life_")) return handleSorciereLife(interaction, env);
      if (customId.startsWith("sorciere_death_")) return handleSorciereDeath(interaction, env);
      if (customId.startsWith("sorciere_target_")) return handleSorciereTarget(interaction, env);
      if (customId.startsWith("sorciere_skip_")) return handleSorciereSkip(interaction, env);

      if (customId.startsWith("lb_kill_") || customId.startsWith("lb_skip_")) return handleLoupBlancKill(interaction, env, ctx);

      if (customId.startsWith("start_game_") || customId.startsWith("skip_countdown_")) {
        const handler = customId.startsWith("skip_countdown_") ? handleSkipCountdown : handleStart;
        return handler(interaction, env, ctx);
      }
    }

    // Modal submit (type 5)
    if (interaction.type === 5) {
      return handleModalSubmit(interaction, env);
    }

    console.error("Unknown interaction:", JSON.stringify({ type: interaction.type, customId: interaction.data?.custom_id, component_type: interaction.data?.component_type }));
    return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
  },
};
