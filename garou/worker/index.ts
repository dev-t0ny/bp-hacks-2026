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

// ── Types ───────────────────────────────────────────────────────────

interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  PRESETS_KV?: any; // KVNamespace — optional
}

interface GameState {
  gameNumber: number;
  creatorId: string;
  creatorName: string;
  guildId: string;
  gameChannelId: string;
  maxPlayers: number;
  players: string[];
  anonymousVotes: boolean;
  discussionTime: number;
  voteTime: number;
  rolesBitmask: string;
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
  body: { allow?: string; deny?: string; type: 0 | 1 },
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
  return fetch(`${DISCORD_API}/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  const existing = channels.find((c: any) => c.type === 4 && c.name.toLowerCase() === "loup-garou");
  if (existing) return existing.id;
  const created: any = await createChannel(token, guildId, { name: "Loup-Garou", type: 4 });
  return created.id;
}

async function getNextGameNumber(token: string, guildId: string, categoryId: string): Promise<number> {
  const channels: any[] = await getGuildChannels(token, guildId);
  const gameChannels = channels.filter((c: any) => c.parent_id === categoryId && c.name.startsWith("partie-"));
  return gameChannels.length + 1;
}

function getConfigFromInteraction(interaction: any): ConfigState | null {
  const embed = interaction.message?.embeds?.[0];
  if (!embed?.url) return null;
  return decodeConfigState(embed.url);
}

async function loadCustomPresets(env: Env, guildId: string): Promise<PresetConfig[]> {
  if (!env.PRESETS_KV) return [];
  try {
    const data = await env.PRESETS_KV.get(`guild:${guildId}`, "json");
    return (data as PresetConfig[]) ?? [];
  } catch {
    return [];
  }
}

async function saveCustomPresets(env: Env, guildId: string, presets: PresetConfig[]): Promise<void> {
  if (!env.PRESETS_KV) return;
  await env.PRESETS_KV.put(`guild:${guildId}`, JSON.stringify(presets));
}

// ── Game State Encoding (Lobby Embed) ───────────────────────────────

const EMBED_COLOR = 0x8b0000;
const WEREWOLF_IMAGE = "https://i.imgur.com/JfOLPcY.png";
const MIN_PLAYERS = 3;

function encodeGameState(game: GameState): string {
  const compact = {
    g: game.gameNumber,
    c: game.creatorId,
    n: game.creatorName,
    gi: game.guildId,
    ch: game.gameChannelId,
    m: game.maxPlayers,
    p: game.players,
    av: game.anonymousVotes ? 1 : 0,
    dt: game.discussionTime,
    vt: game.voteTime,
    rb: game.rolesBitmask,
  };
  return btoa(JSON.stringify(compact));
}

function decodeGameState(url: string): GameState | null {
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
      anonymousVotes: compact.av === 1,
      discussionTime: compact.dt ?? 120,
      voteTime: compact.vt ?? 60,
      rolesBitmask: compact.rb ?? "0000000000000000",
    };
  } catch {
    return null;
  }
}

function formatTimeShort(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (sec === 0) return `${min}m`;
  return `${min}m${sec}s`;
}

function buildGameEmbed(game: GameState) {
  const playerCount = game.players.length;
  const isFull = playerCount >= game.maxPlayers;
  const stateUrl = `https://garou.bot/s/${encodeGameState(game)}`;

  const roles = bitmaskToRoles(game.rolesBitmask);
  const roleNames = roles
    .slice(0, 10)
    .map((id) => ALL_ROLES[id]?.name)
    .filter(Boolean);
  const rolesDisplay = roles.length > 10 ? `${roleNames.join(", ")}... (+${roles.length - 10})` : roleNames.join(", ");

  const descriptionLines = [
    `Créée par <@${game.creatorId}>`,
    "",
    `**Joueurs:** ${playerCount}/${game.maxPlayers}`,
    `**Votes:** ${game.anonymousVotes ? "🔒 Anonyme" : "👁️ Public"}`,
    `**Discussion:** ${formatTimeShort(game.discussionTime)} • **Vote:** ${formatTimeShort(game.voteTime)}`,
    `**Rôles (${roles.length}):** ${rolesDisplay}`,
  ];

  if (playerCount > 0) {
    descriptionLines.push("");
    descriptionLines.push(game.players.map((id) => `> <@${id}>`).join("\n"));
  }

  descriptionLines.push("");
  descriptionLines.push(isFull ? "**La partie est pleine!**" : "Cliquez sur le bouton ci-dessous pour rejoindre!");

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
  return decodeGameState(embed.url);
}

// ── Slash Command Handler (/loupgarou) ──────────────────────────────

async function handleSlashCommand(interaction: any, env: Env): Promise<Response> {
  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  const userId = interaction.member?.user?.id;

  console.log("handleSlashCommand called", { guildId, channelId, userId });

  if (!guildId || !channelId || !userId) {
    return json({
      type: 4,
      data: { content: "❌ Cette commande ne fonctionne que dans un serveur Discord.", flags: 64 },
    });
  }

  // Load custom presets for this guild
  const customPresets = await loadCustomPresets(env, guildId);
  console.log("Custom presets loaded:", customPresets.length);

  // Build initial config state with defaults
  const config: ConfigState = {
    step: 1,
    creatorId: userId,
    guildId,
    channelId,
    presetName: "",
    anonymousVotes: false,
    discussionTime: 120,
    voteTime: 60,
    selectedRoles: [],
  };

  const embed = buildStep1Embed(config, customPresets);
  const responsePayload = {
    type: 4,
    data: {
      ...embed,
      flags: 64, // Ephemeral
    },
  };
  console.log("Response payload size:", JSON.stringify(responsePayload).length);
  return json(responsePayload);
}

// ── Config Select Menu Handlers ─────────────────────────────────────

async function handleConfigSelect(interaction: any, env: Env): Promise<Response> {
  const customId: string = interaction.data.custom_id;
  const values: string[] = interaction.data.values ?? [];
  const config = getConfigFromInteraction(interaction);

  if (!config) {
    return json({ type: 4, data: { content: "❌ Erreur: configuration introuvable.", flags: 64 } });
  }

  switch (customId) {
    case "cfg_preset": {
      const presetValue = values[0];
      if (presetValue === "none") {
        config.presetName = "";
        config.selectedRoles = [];
      } else {
        const customPresets = await loadCustomPresets(env, config.guildId);
        const preset = findPreset(presetValue, customPresets);
        if (preset) {
          config.presetName = preset.name;
          config.anonymousVotes = preset.anonymousVotes;
          config.discussionTime = preset.discussionTime;
          config.voteTime = preset.voteTime;
          config.selectedRoles = [...preset.roles];
        }
      }
      const customPresets = await loadCustomPresets(env, config.guildId);
      return json({ type: 7, data: buildStep1Embed(config, customPresets) });
    }

    case "cfg_votes": {
      config.anonymousVotes = values[0] === "anonyme";
      const customPresets = await loadCustomPresets(env, config.guildId);
      return json({ type: 7, data: buildStep1Embed(config, customPresets) });
    }

    case "cfg_disc_time": {
      config.discussionTime = parseInt(values[0]!, 10);
      const customPresets = await loadCustomPresets(env, config.guildId);
      return json({ type: 7, data: buildStep1Embed(config, customPresets) });
    }

    case "cfg_vote_time": {
      config.voteTime = parseInt(values[0]!, 10);
      const customPresets = await loadCustomPresets(env, config.guildId);
      return json({ type: 7, data: buildStep1Embed(config, customPresets) });
    }

    case "cfg_roles_v1": {
      const newIds = values.map((v) => parseInt(v, 10));
      const groupIds = VILLAGEOIS_GROUP_1.map((r) => r.id);
      config.selectedRoles = updateRolesForGroup(config.selectedRoles, groupIds, newIds);
      return json({ type: 7, data: buildStep2Embed(config) });
    }

    case "cfg_roles_v2": {
      const newIds = values.map((v) => parseInt(v, 10));
      const groupIds = VILLAGEOIS_GROUP_2.map((r) => r.id);
      config.selectedRoles = updateRolesForGroup(config.selectedRoles, groupIds, newIds);
      return json({ type: 7, data: buildStep2Embed(config) });
    }

    case "cfg_roles_loups": {
      const newIds = values.map((v) => parseInt(v, 10));
      const groupIds = LOUPS_ROLES.map((r) => r.id);
      config.selectedRoles = updateRolesForGroup(config.selectedRoles, groupIds, newIds);
      return json({ type: 7, data: buildStep2Embed(config) });
    }

    case "cfg_roles_solo": {
      const newIds = values.map((v) => parseInt(v, 10));
      const groupIds = SOLITAIRE_ROLES.map((r) => r.id);
      config.selectedRoles = updateRolesForGroup(config.selectedRoles, groupIds, newIds);
      return json({ type: 7, data: buildStep2Embed(config) });
    }

    default:
      return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
  }
}

// ── Config Button Handlers ──────────────────────────────────────────

async function handleConfigButton(interaction: any, env: Env): Promise<Response> {
  const customId: string = interaction.data.custom_id;
  const config = getConfigFromInteraction(interaction);

  if (!config) {
    return json({ type: 4, data: { content: "❌ Erreur: configuration introuvable.", flags: 64 } });
  }

  switch (customId) {
    case "cfg_next": {
      // Go to step 2 — role selection
      config.step = 2;
      return json({ type: 7, data: buildStep2Embed(config) });
    }

    case "cfg_back": {
      // Go back to step 1
      config.step = 1;
      const customPresets = await loadCustomPresets(env, config.guildId);
      return json({ type: 7, data: buildStep1Embed(config, customPresets) });
    }

    case "cfg_create": {
      // Create the game
      return await handleCreateGame(interaction, config, env);
    }

    case "cfg_save": {
      // Show modal to save preset
      const rb = rolesToBitmask(config.selectedRoles);
      const av = config.anonymousVotes ? "1" : "0";
      const modalCustomId = `csm:${rb}:${av}:${config.discussionTime}:${config.voteTime}`;

      return json({
        type: 9, // MODAL
        data: {
          custom_id: modalCustomId,
          title: "Sauvegarder le preset",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4, // TEXT_INPUT
                  custom_id: "preset_name",
                  label: "Nom du preset",
                  style: 1, // SHORT
                  min_length: 1,
                  max_length: 30,
                  placeholder: "Ex: Ma config préférée",
                  required: true,
                },
              ],
            },
          ],
        },
      });
    }

    default:
      return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
  }
}

// ── Game Creation ───────────────────────────────────────────────────

async function handleCreateGame(interaction: any, config: ConfigState, env: Env): Promise<Response> {
  const token = env.DISCORD_BOT_TOKEN;
  const appId = interaction.application_id;
  const interactionToken = interaction.token;

  if (config.selectedRoles.length === 0) {
    return json({ type: 4, data: { content: "❌ Aucun rôle sélectionné!", flags: 64 } });
  }

  // Defer the update (shows loading on button)
  const deferredResponse = json({ type: 6 });

  const backgroundWork = (async () => {
    try {
      // Get creator info
      const member: any = await getGuildMember(token, config.guildId, config.creatorId);
      const creatorName = member.nick || member.user.global_name || member.user.username;

      // Find or create category
      const categoryId = await findOrCreateCategory(token, config.guildId);

      // Get game number
      const gameNumber = await getNextGameNumber(token, config.guildId, categoryId);

      // Get bot user for permissions
      const botUser: any = await getBotUser(token);

      // Determine max players
      const maxPlayers = Math.max(config.selectedRoles.length, 6);

      // Create game channel
      const gameChannel: any = await createChannel(token, config.guildId, {
        name: `partie-${gameNumber}`,
        type: 0,
        parent_id: categoryId,
        permission_overwrites: [
          {
            id: config.guildId,
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
        creatorId: config.creatorId,
        creatorName,
        guildId: config.guildId,
        gameChannelId: gameChannel.id,
        maxPlayers,
        players: [],
        anonymousVotes: config.anonymousVotes,
        discussionTime: config.discussionTime,
        voteTime: config.voteTime,
        rolesBitmask: rolesToBitmask(config.selectedRoles),
      };

      // Send public lobby embed to the channel
      await sendMessage(token, config.channelId, buildGameEmbed(gameState));

      // Send welcome message in game channel
      const roles = config.selectedRoles.map((id) => ALL_ROLES[id]?.name).filter(Boolean);
      await sendMessage(token, gameChannel.id, {
        embeds: [
          {
            title: `🐺 Salle d'attente — Partie #${gameNumber}`,
            description: [
              `Créée par **${creatorName}**`,
              `**Joueurs max:** ${maxPlayers}`,
              `**Votes:** ${config.anonymousVotes ? "🔒 Anonyme" : "👁️ Public"}`,
              `**Discussion:** ${formatTimeShort(config.discussionTime)} • **Vote:** ${formatTimeShort(config.voteTime)}`,
              "",
              `**Rôles (${roles.length}):**`,
              roles.join(", "),
              "",
              "En attente de joueurs...",
            ].join("\n"),
            color: EMBED_COLOR,
          },
        ],
      });

      // Edit the ephemeral message to show confirmation
      await editOriginalInteractionResponse(appId, interactionToken, {
        embeds: [
          {
            title: "✅ Partie créée!",
            description: [
              `**Partie #${gameNumber}** créée avec succès!`,
              "",
              `🎭 ${roles.length} rôles • 👥 Max ${maxPlayers} joueurs`,
              "",
              `Le lobby est ouvert dans <#${config.channelId}>`,
              `Salon de jeu: <#${gameChannel.id}>`,
            ].join("\n"),
            color: 0x00ff00,
          },
        ],
        components: [],
      });
    } catch (err) {
      console.error("Error creating game:", err);
      try {
        await editOriginalInteractionResponse(appId, interactionToken, {
          embeds: [
            {
              title: "❌ Erreur",
              description: "Une erreur est survenue lors de la création de la partie.",
              color: 0xff0000,
            },
          ],
          components: [],
        });
      } catch {}
    }
  })();

  (globalThis as any).__backgroundWork = backgroundWork;
  return deferredResponse;
}

// ── Modal Submit Handler ────────────────────────────────────────────

async function handleModalSubmit(interaction: any, env: Env): Promise<Response> {
  const customId: string = interaction.data.custom_id;

  if (!customId.startsWith("csm:")) {
    return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
  }

  // Parse preset config from modal custom_id: csm:{rb}:{av}:{dt}:{vt}
  const parts = customId.split(":");
  if (parts.length !== 5) {
    return json({ type: 4, data: { content: "❌ Données invalides.", flags: 64 } });
  }

  const [, rb, av, dt, vt] = parts;
  const roles = bitmaskToRoles(rb!);
  const anonymousVotes = av === "1";
  const discussionTime = parseInt(dt!, 10);
  const voteTime = parseInt(vt!, 10);

  // Get preset name from text input
  const nameInput = interaction.data.components?.[0]?.components?.[0];
  const presetName = nameInput?.value?.trim();

  if (!presetName) {
    return json({ type: 4, data: { content: "❌ Nom du preset requis.", flags: 64 } });
  }

  const guildId = interaction.guild_id;
  if (!guildId) {
    return json({ type: 4, data: { content: "❌ Erreur: serveur introuvable.", flags: 64 } });
  }

  // Save preset
  const customPresets = await loadCustomPresets(env, guildId);

  // Replace existing preset with same name or add new
  const existingIdx = customPresets.findIndex((p) => p.name === presetName);
  const newPreset: PresetConfig = {
    name: presetName,
    roles,
    anonymousVotes,
    discussionTime,
    voteTime,
  };

  if (existingIdx >= 0) {
    customPresets[existingIdx] = newPreset;
  } else {
    customPresets.push(newPreset);
  }

  await saveCustomPresets(env, guildId, customPresets);

  return json({
    type: 4,
    data: {
      content: `✅ Preset **${presetName}** sauvegardé! (${roles.length} rôles)\nIl sera disponible dans le menu preset la prochaine fois.`,
      flags: 64,
    },
  });
}

// ── Join Handler (Lobby) ────────────────────────────────────────────

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

  // Give player VIEW_CHANNEL, deny SEND_MESSAGES
  await setChannelPermission(token, game.gameChannelId, userId, {
    allow: String(1 << 10),
    deny: String(1 << 11),
    type: 1,
  });

  // Update lobby embed
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
      content: `✅ Tu as rejoint la Partie #${game.gameNumber}!`,
      flags: 64,
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "🐺 Aller au salon",
              url: `https://discord.com/channels/${game.guildId}/${game.gameChannelId}`,
            },
          ],
        },
      ],
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
    console.log("Interaction received:", JSON.stringify({ type: interaction.type, data_name: interaction.data?.name, data_custom_id: interaction.data?.custom_id, data_component_type: interaction.data?.component_type }));

    try {
      // PING handshake
      if (interaction.type === 1) {
        return json({ type: 1 });
      }

      // APPLICATION_COMMAND (slash commands)
      if (interaction.type === 2) {
        const commandName = interaction.data?.name;
        if (commandName === "loupgarou") {
          console.log("Handling /loupgarou slash command");
          const response = await handleSlashCommand(interaction, env);
          const bgWork = (globalThis as any).__backgroundWork;
          if (bgWork) {
            ctx.waitUntil(bgWork);
            (globalThis as any).__backgroundWork = null;
          }
          console.log("Returning slash command response");
          return response;
        }
      }

      // MESSAGE_COMPONENT (buttons, select menus)
      if (interaction.type === 3) {
        const customId: string = interaction.data?.custom_id || "";
        const componentType: number = interaction.data?.component_type;
        console.log("Component interaction:", customId, "type:", componentType);

        // Config select menus (type 3 = string select)
        if (componentType === 3 && customId.startsWith("cfg_")) {
          const response = await handleConfigSelect(interaction, env);
          return response;
        }

        // Config buttons (type 2 = button)
        if (componentType === 2 && customId.startsWith("cfg_")) {
          const response = await handleConfigButton(interaction, env);
          const bgWork = (globalThis as any).__backgroundWork;
          if (bgWork) {
            ctx.waitUntil(bgWork);
            (globalThis as any).__backgroundWork = null;
          }
          return response;
        }

        // Join game button
        if (customId.startsWith("join_game_")) {
          return await handleJoin(interaction, env);
        }
      }

      // MODAL_SUBMIT
      if (interaction.type === 5) {
        return await handleModalSubmit(interaction, env);
      }

      console.log("No handler matched, returning unknown action");
      return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
    } catch (err: any) {
      console.error("Handler error:", err?.message, err?.stack);
      return json({ type: 4, data: { content: "❌ Erreur interne du serveur.", flags: 64 } });
    }
  },
};
