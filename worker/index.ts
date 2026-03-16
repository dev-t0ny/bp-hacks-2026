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
import { pickBots, type BotPlayer } from "./bot-personalities";
import {
  buildBotPrompt,
  botDelay,
  botSpeaks,
  fallbackDecision,
  loadHistory,
  appendHistory,
  type BotDecisionRequest,
  type BotDecisionResult,
} from "./bot-orchestrator";
import {
  type GameState,
  type WinResult,
  type Role,
  EMBED_COLOR,
  EMBED_COLOR_GREEN,
  EMBED_COLOR_ORANGE,
  EMBED_COLOR_NIGHT,
  EMBED_COLOR_PURPLE,
  ASSET_BASE,
  SCENE_IMAGES,
  MIN_PLAYERS,
  MAX_PLAYERS,
  ROLES,
  ROLE_ID_TO_KEY,
  roleIdToKey,
  secureRandom,
  assignRoles,
  encodeState,
  decodeState,
  checkWinCondition,
  getRoleImage,
  progressBar,
} from "./game-logic";
import {
  type VoteState,
  type VoyanteState,
  type SorciereState,
  type CupidonState,
  type ChasseurState,
  type DayVoteState,
  encodeVoteState,
  decodeVoteState,
  parseVoteFromEmbed,
  buildVoteEmbed,
  encodeVoyanteState,
  decodeVoyanteState,
  parseVoyanteFromEmbed,
  buildVoyanteEmbed,
  encodeSorciereState,
  decodeSorciereState,
  parseSorciereFromEmbed,
  buildSorciereEmbed,
  buildSorciereTargetEmbed,
  encodeCupidonState,
  decodeCupidonState,
  parseCupidonFromEmbed,
  buildCupidonEmbed,
  encodeChasseurState,
  decodeChasseurState,
  parseChasseurFromEmbed,
  buildChasseurEmbed,
  encodeDayVoteState,
  decodeDayVoteState,
  parseDayVoteFromEmbed,
  buildRoleCheckEmbed,
  buildAnnounceEmbed,
  buildLobbyEmbed,
  parseGameFromEmbed,
} from "./embed-builders";

interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  ACTIVE_PLAYERS: KVNamespace;
  PRESETS_KV?: KVNamespace;
  GATEWAY_URL?: string;
  GATEWAY_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  WORKER_URL?: string;
  PHASE_QUEUE: Queue; // Cloudflare Queue for delayed phase dispatch
}

const PLAYER_TTL = 86400;

async function saveBots(kv: KVNamespace, gameNumber: number, bots: BotPlayer[]) {
  await kv.put(`game:${gameNumber}:bots`, JSON.stringify(bots), { expirationTtl: PLAYER_TTL });
}

async function loadBots(kv: KVNamespace, gameNumber: number): Promise<BotPlayer[]> {
  const val = await kv.get(`game:${gameNumber}:bots`);
  if (!val) return [];
  try { return JSON.parse(val); } catch { return []; }
}

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

// ── Game State (imported from ./game-logic and ./embed-builders) ────


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

// ── LLM Call via Botpress ADK (for bot decisions) ───────────────────

async function callLLM(prompt: string, env: Env): Promise<string> {
  console.log(`[callLLM] Starting, prompt length: ${prompt.length}, BOTPRESS_PAT: ${env.BOTPRESS_PAT ? "SET" : "UNSET"}, BOTPRESS_BOT_ID: ${env.BOTPRESS_BOT_ID ?? "UNSET"}`);
  // Use Botpress ADK action (zai) for AI generation
  if (env.BOTPRESS_PAT && env.BOTPRESS_BOT_ID) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("https://api.botpress.cloud/v1/chat/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.BOTPRESS_PAT}`,
          "x-bot-id": env.BOTPRESS_BOT_ID,
        },
        body: JSON.stringify({
          action: "botAiResponse",
          input: { prompt, structured: false },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        console.error(`[callLLM] Botpress API ${res.status}: ${await res.text()}`);
        throw new Error(`Botpress API ${res.status}`);
      }
      const data: any = await res.json();
      return data.output?.text ?? "";
    } catch (err) {
      clearTimeout(timeoutId);
      console.error("[callLLM] Botpress call failed, falling back:", err);
    }
  }

  // Fallback: direct Anthropic call
  if (!env.ANTHROPIC_API_KEY) throw new Error("No AI configured (set BOTPRESS_PAT+BOTPRESS_BOT_ID or ANTHROPIC_API_KEY)");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`LLM API ${res.status}`);
    const data: any = await res.json();
    return data.content?.[0]?.text ?? "";
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ── Bot Wolf Vote Execution ─────────────────────────────────────────

async function executeBotWolfVote(
  token: string,
  env: Env,
  bot: BotPlayer,
  allBots: BotPlayer[],
  wolfChannelId: string,
  voteMessageId: string,
  gameNumber: number,
  ctx: ExecutionContext,
): Promise<void> {
  console.log(`[botWolfVote] 🐺 Bot ${bot.name} (${bot.id}) voting in game #${gameNumber}`);
  // Re-read VoteState from embed to avoid race conditions
  const currentMsg: any = await getMessage(token, wolfChannelId, voteMessageId);
  if (!currentMsg.components?.length) { console.log(`[botWolfVote] Already resolved, skipping ${bot.name}`); return; }
  const voteState = parseVoteFromEmbed(currentMsg);
  if (!voteState) { console.log(`[botWolfVote] No vote state found for ${bot.name}`); return; }

  // Instant random decision — pick a random non-wolf target
  const decision = fallbackDecision(voteState.targets, bot.id);
  console.log(`[botWolfVote] ${bot.name} randomly chose: ${decision.action}`);

  // Apply vote
  voteState.votes[bot.id] = decision.action;

  // Post bot message in wolf thread
  await sendMessage(token, wolfChannelId, {
    content: `**${bot.emoji} ${bot.name}** : "${decision.message}"`,
  });

  // Update vote embed with new state
  await editMessage(token, wolfChannelId, voteMessageId, buildVoteEmbed(voteState));

  // Check unanimous
  const allVoted = voteState.wolves.every((wId) => voteState.votes[wId]);
  const allSameTarget = allVoted && new Set(Object.values(voteState.votes)).size === 1;
  if (allSameTarget) {
    await resolveNightVote(token, voteState, voteMessageId, ctx, env);
  }
}

// ── Bot Day Discussion ──────────────────────────────────────────────

async function executeBotDiscussion(
  token: string,
  _env: Env,
  bot: BotPlayer,
  _allBots: BotPlayer[],
  gameChannelId: string,
  _gameNumber: number,
  role: string,
  alivePlayers: { id: string; name: string }[],
): Promise<void> {
  console.log(`[botDiscussion] 💬 Bot ${bot.name} (${bot.id}), role: ${role}`);

  const others = alivePlayers.filter(p => p.id !== bot.id);
  const randomTarget = others[Math.floor(Math.random() * others.length)];
  const randomTarget2 = others.filter(p => p.id !== randomTarget?.id)[Math.floor(Math.random() * Math.max(1, others.length - 1))];

  const phrases = role === "loup" ? [
    `Hmm, je trouve ${randomTarget?.name ?? "quelqu'un"} un peu louche...`,
    `Moi je dis qu'on devrait surveiller ${randomTarget?.name ?? "certains"} de plus près.`,
    `J'ai rien vu de suspect, mais ${randomTarget?.name ?? "quelqu'un"} me donne un mauvais feeling.`,
    `C'est bizarre que personne n'accuse ${randomTarget?.name ?? "cette personne"}...`,
    `Perso je fais confiance à personne. Surtout pas à ${randomTarget?.name ?? "certains"}.`,
    `Moi j'accuse ${randomTarget?.name ?? "quelqu'un"}, y'a quelque chose qui cloche.`,
    `Faut regarder du côté de ${randomTarget?.name ?? "certains"}, sérieux.`,
    `Wsh ${randomTarget?.name ?? "toi là"}, t'as été bien silencieux cette nuit...`,
    `Perso je vote ${randomTarget?.name ?? "quelqu'un"}, c'est clair que c'est un loup.`,
    `Non mais attendez, ${randomTarget?.name ?? "quelqu'un"} a dit quoi exactement hier??`,
    `Moi je dis c'est entre ${randomTarget?.name ?? "quelqu'un"} et ${randomTarget2?.name ?? "l'autre"}.`,
    `${randomTarget?.name ?? "Quelqu'un"} fait trop l'innocent, ça pue le loup.`,
    `On s'emballe pas, mais ${randomTarget?.name ?? "cette personne"} me dit rien de bon.`,
    `Quelqu'un peut m'expliquer pourquoi ${randomTarget?.name ?? "lui/elle"} a rien dit hier?`,
    `Moi je kiffe pas l'attitude de ${randomTarget?.name ?? "certains"}, c'est tout.`,
    `Ouais non, ${randomTarget?.name ?? "toi"}, tu nous caches quelque chose.`,
    `Bon on fait quoi? Moi je suis chaud pour virer ${randomTarget?.name ?? "quelqu'un"}.`,
  ] : [
    `Je suis pas sûr(e) mais ${randomTarget?.name ?? "quelqu'un"} agit bizarre non?`,
    `On devrait voter contre ${randomTarget?.name ?? "quelqu'un"}, j'ai un mauvais pressentiment.`,
    `Moi je suis innocent(e)! Regardez plutôt du côté de ${randomTarget?.name ?? "certains"}.`,
    `${randomTarget?.name ?? "Quelqu'un"} parle pas beaucoup... c'est suspect.`,
    `Faisons attention, les loups sont parmi nous. Je suspecte ${randomTarget?.name ?? "quelqu'un"}.`,
    `Je fais confiance à personne ici. Surtout pas ${randomTarget?.name ?? "certains"}.`,
    `Bon, moi je pense que ${randomTarget?.name ?? "quelqu'un"} nous ment depuis le début.`,
    `Nah fr ${randomTarget?.name ?? "toi"}, explique-nous pourquoi tu dis rien?`,
    `Moi je suis clean wallah, c'est ${randomTarget?.name ?? "quelqu'un"} le loup ici.`,
    `On devrait focus ${randomTarget?.name ?? "cette personne"}, ses arguments tiennent pas la route.`,
    `Écoutez moi, je vous jure c'est ${randomTarget?.name ?? "quelqu'un"} le problème.`,
    `${randomTarget?.name ?? "Toi"} et ${randomTarget2?.name ?? "l'autre"}, vous votez toujours pareil, c'est louche.`,
    `Les gars, faut se réveiller! ${randomTarget?.name ?? "Quelqu'un"} nous manipule depuis le début!`,
    `Moi j'ai confiance en personne sauf moi-même. ${randomTarget?.name ?? "Quelqu'un"} est suspect.`,
    `Honnêtement? ${randomTarget?.name ?? "Quelqu'un"} me donne des vibes de loup-garou.`,
    `C'est la guerre les amis, et ${randomTarget?.name ?? "quelqu'un"} est dans le camp adverse.`,
    `Attendez, ${randomTarget?.name ?? "cette personne"} a changé d'avis trop vite, non?`,
    `Moi j'ai dormi tranquille cette nuit. Par contre ${randomTarget?.name ?? "certains"}... 👀`,
  ];

  const message = phrases[Math.floor(Math.random() * phrases.length)]!;

  try {
    await sendMessage(token, gameChannelId, {
      content: `**${bot.emoji} ${bot.name}** : ${message}`,
    });
    console.log(`[botDiscussion] ${bot.name} posted: ${message}`);
  } catch (err) {
    console.error(`[botDiscussion] Failed to send message for ${bot.name}:`, err);
  }
}

// ── Bot Day Vote ────────────────────────────────────────────────────

async function executeBotDayVote(
  token: string,
  _env: Env,
  bot: BotPlayer,
  allBots: BotPlayer[],
  gameChannelId: string,
  voteMessageId: string,
  _gameNumber: number,
  _role: string,
  ctx: ExecutionContext,
): Promise<void> {
  console.log(`[botDayVote] 🗳️ Bot ${bot.name} (${bot.id}) voting`);
  // Re-read DayVoteState from embed
  const currentMsg: any = await getMessage(token, gameChannelId, voteMessageId);
  if (!currentMsg.components?.length) return;
  const dv = parseDayVoteFromEmbed(currentMsg);
  if (!dv) return;

  // Instant random decision
  const fd = fallbackDecision(dv.targets, bot.id);
  const targetId = fd.action;
  const message = fd.message;
  console.log(`[botDayVote] ${bot.name} randomly chose: ${targetId}`);

  dv.votes[bot.id] = targetId;

  // Build updated voter lines
  const voterLines = dv.voters.map((id) => {
    const vote = dv.votes[id];
    if (!vote) return `⬜ <@${id}> — *en attente...*`;
    if (id.startsWith("bot_")) {
      const b = allBots.find((b) => b.id === id);
      const bName = b ? `${b.emoji} ${b.name}` : id;
      if (vote === "skip") return `⏭️ ${bName} — **Passe**`;
      const target = dv.targets.find((t) => t.id === vote);
      return `✅ ${bName} — a voté pour **${target?.name ?? "?"}**`;
    }
    if (vote === "skip") return `⏭️ <@${id}> — **Passe**`;
    const target = dv.targets.find((t) => t.id === vote);
    return `✅ <@${id}> — a voté pour **${target?.name ?? "?"}**`;
  });

  const updatedUrl = `https://garou.bot/dv/${encodeDayVoteState(dv)}`;

  await editMessage(token, gameChannelId, voteMessageId, {
    embeds: [{
      title: `🗳️ Vote du village — Partie #${dv.gameNumber}`,
      url: updatedUrl,
      description: [
        "Votez pour éliminer un suspect, ou passez votre tour.",
        "",
        `⏰ Fin du vote: <t:${dv.deadline}:R>`,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...voterLines,
      ].join("\n"),
      color: EMBED_COLOR,
      image: { url: SCENE_IMAGES.day_elimination },
    }],
    components: currentMsg.components,
  });

  // Post message
  await sendMessage(token, gameChannelId, {
    content: `**${bot.emoji} ${bot.name}** vote : "${message}"`,
  });

  // Check all voted
  const allVoted = dv.voters.every((id) => dv.votes[id]);
  if (allVoted) {
    await editMessage(token, gameChannelId, voteMessageId, {
      embeds: [{
        title: `🗳️ Vote du village — Partie #${dv.gameNumber}`,
        url: updatedUrl,
        description: [
          "Votez pour éliminer un suspect, ou passez votre tour.",
          "",
          `⏰ Fin du vote: <t:${dv.deadline}:R>`,
          "",
          "━━━━━━━━━━━━━━━━━━━━",
          "",
          ...voterLines,
        ].join("\n"),
        color: EMBED_COLOR,
        image: { url: SCENE_IMAGES.day_elimination },
      }],
      components: [],
    });
    await resolveDayVote(token, dv, ctx, _env);
  }
}

function getMessage(token: string, channelId: string, messageId: string) {
  return discordFetch(token, `/channels/${channelId}/messages/${messageId}`);
}

function getChannelMessages(token: string, channelId: string, after?: string, limit = 100) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (after) params.set("after", after);
  return discordFetch(token, `/channels/${channelId}/messages?${params}`);
}

async function bulkDeleteMessages(token: string, channelId: string, messageIds: string[]) {
  for (let i = 0; i < messageIds.length; i += 100) {
    const batch = messageIds.slice(i, i + 100);
    if (batch.length === 1) {
      await deleteMessage(token, channelId, batch[0]!);
    } else if (batch.length >= 2) {
      await discordFetch(token, `/channels/${channelId}/messages/bulk-delete`, {
        method: "POST",
        body: JSON.stringify({ messages: batch }),
      });
    }
  }
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

async function updateAllEmbeds(token: string, game: GameState, lastEvent?: string, bots: BotPlayer[] = []) {
  // Update lobby FIRST (source of truth for re-fetches), THEN announce
  if (game.lobbyMessageId) {
    await editMessage(token, game.gameChannelId, game.lobbyMessageId, buildLobbyEmbed(game, bots, lastEvent));
  }
  if (game.announceChannelId && game.announceMessageId) {
    await editMessage(token, game.announceChannelId, game.announceMessageId, buildAnnounceEmbed(game));
  }
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

  if (customId === "cfg_max_players") {
    config.maxPlayers = parseInt(values[0] || "6", 10);
    // Auto-cap bots if they exceed total
    if (config.botCount >= config.maxPlayers) {
      config.botCount = Math.max(0, config.maxPlayers - 1);
    }
    const customPresets = await loadCustomPresets(env, config.guildId);
    return json({ type: 7, data: buildStep1Embed(config, customPresets) });
  }

  if (customId === "cfg_timers") {
    const parts = (values[0] || "120_60").split("_");
    config.discussionTime = parseInt(parts[0]!, 10);
    config.voteTime = parseInt(parts[1]!, 10);
    const customPresets = await loadCustomPresets(env, config.guildId);
    return json({ type: 7, data: buildStep1Embed(config, customPresets) });
  }

  if (customId === "cfg_bots") {
    config.botCount = parseInt(values[0] || "0", 10);
    // Auto-cap bots so at least 1 human slot remains
    if (config.botCount >= config.maxPlayers) {
      config.botCount = Math.max(0, config.maxPlayers - 1);
    }
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

  if (customId === "cfg_votes_public") {
    config.anonymousVotes = false;
    const customPresets = await loadCustomPresets(env, config.guildId);
    return json({ type: 7, data: buildStep1Embed(config, customPresets) });
  }

  if (customId === "cfg_votes_anonyme") {
    config.anonymousVotes = true;
    const customPresets = await loadCustomPresets(env, config.guildId);
    return json({ type: 7, data: buildStep1Embed(config, customPresets) });
  }

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
  const maxPlayers = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, config.maxPlayers));

  // Validate: at least 1 wolf role
  const hasWolf = config.selectedRoles.some((id) => ROLE_ID_TO_KEY[id] === "loup");
  if (!hasWolf) {
    return json({ type: 4, data: { content: "❌ La config doit contenir au moins un Loup-Garou.", flags: 64 } });
  }

  // ACK with deferred update (remove the config embed)
  const deferredResponse = json({ type: 5, data: { flags: 64 } });

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
          { id: botUser.id, type: 1, allow: ((1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 15n) | (1n << 34n) | (1n << 38n)).toString() },
          { id: userId, type: 1, allow: String(1 << 10) },
        ],
      });


      await markPlayerActive(env.ACTIVE_PLAYERS, userId, gameNumber, gameChannel.id);
      await env.ACTIVE_PLAYERS.put(`gp:${gameNumber}:${userId}`, "1", { expirationTtl: PLAYER_TTL });

      const gameState: GameState = {
        gameNumber,
        creatorId: userId,
        creatorName,
        guildId,
        gameChannelId: gameChannel.id,
        maxPlayers,
        players: [userId],
        announceChannelId: channelId,
        discussionTime: config.discussionTime,
        voteTime: config.voteTime,
        selectedRoleIds: config.selectedRoles,
        botCount: config.botCount,
      };

      // Create bot players if configured
      let bots: BotPlayer[] = [];
      if (gameState.botCount && gameState.botCount > 0) {
        const personalities = pickBots(gameState.botCount);
        bots = personalities.map((p, i) => ({
          id: `bot_${i + 1}`,
          name: p.name,
          traits: p.traits,
          emoji: p.emoji,
          alive: true,
        }));
        await saveBots(env.ACTIVE_PLAYERS, gameNumber, bots);
      }

      // Send lobby embed in game channel
      const lobbyMsg: any = await sendMessage(token, gameChannel.id, buildLobbyEmbed(gameState, bots));
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
      await updateAllEmbeds(token, gameState, undefined, bots);
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
    botCount: 4,
    maxPlayers: 6,
  };

  const customPresets = await loadCustomPresets(env, guildId);

  // Return ephemeral config embed
  return json({ type: 4, data: { ...buildStep1Embed(config, customPresets), flags: 64 } });
}

// ── Join ────────────────────────────────────────────────────────────

async function handleJoin(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });

  const initialGame = parseGameFromEmbed(interaction.message);
  if (!initialGame) return json({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });

  // ACK immediately (deferred ephemeral) — prevents "interaction failed" on slow API calls
  const appId = interaction.application_id;
  const interactionToken = interaction.token;
  const deferredResponse = json({ type: 5, data: { flags: 64 } });

  const work = (async () => {
    const token = env.DISCORD_BOT_TOKEN;
    const kv = env.ACTIVE_PLAYERS;
    const gn = initialGame.gameNumber;

    try {
      const playerKey = `gp:${gn}:${userId}`;

      // ── Step 1: Re-fetch lobby embed (sole source of truth for player list) ──
      let game = initialGame;
      if (initialGame.lobbyMessageId) {
        try {
          const latestMsg: any = await getMessage(token, initialGame.gameChannelId, initialGame.lobbyMessageId);
          const latestGame = parseGameFromEmbed(latestMsg);
          if (latestGame) game = latestGame;
        } catch {}
      }

      // Already in the embed? (concurrent join resolved it)
      if (game.players.includes(userId)) {
        await kv.put(playerKey, "1", { expirationTtl: PLAYER_TTL });
        await markPlayerActive(kv, userId, gn, game.gameChannelId);
        await editOriginalInteractionResponse(appId, interactionToken, {
          content: `✅ Tu as rejoint la Partie #${game.gameNumber}!`,
          components: [{ type: 1, components: [{ type: 2, style: 5, label: "🐺 Aller au salon", url: `https://discord.com/channels/${game.guildId}/${game.gameChannelId}` }] }],
        });
        return;
      }

      const bots = await loadBots(kv, game.gameNumber);
      const humanSlots = game.maxPlayers - bots.length;
      if (game.players.length >= humanSlots) {
        await editOriginalInteractionResponse(appId, interactionToken, {
          content: "❌ La partie est pleine!",
        });
        return;
      }

      // ── Step 3: Set permissions BEFORE embed (player must have access before appearing) ──
      await setChannelPermission(token, game.gameChannelId, userId, {
        allow: String(1 << 10),
        deny: String(1 << 11),
        type: 1,
      });


      // ── Step 4: Add player + update embeds ──
      await kv.put(playerKey, "1", { expirationTtl: PLAYER_TTL });
      await markPlayerActive(kv, userId, gn, game.gameChannelId);

      game.players.push(userId);

      const member: any = await getGuildMember(token, game.guildId, userId);
      const playerName = member.nick || member.user.global_name || member.user.username;

      await updateAllEmbeds(token, game, `${playerName} a rejoint la partie`, bots);

      // ── Step 5: Post-update verify (fix race with concurrent joins) ──
      await sleep(1500);
      try {
        const verifyMsg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId!);
        const verifyGame = parseGameFromEmbed(verifyMsg);
        if (verifyGame && !verifyGame.players.includes(userId)) {
          // Our update got overwritten by a concurrent join — re-add
          verifyGame.players.push(userId);
          await updateAllEmbeds(token, verifyGame, `${playerName} a rejoint la partie`, bots);
          game = verifyGame;
        } else if (verifyGame) {
          game = verifyGame;
        }
      } catch {}

      // Game is full → start countdown
      const totalWithBots = game.players.length + bots.length;
      if (totalWithBots >= game.maxPlayers) {
        ctx.waitUntil(runCountdown(token, game, ctx, env));
      }

      await editOriginalInteractionResponse(appId, interactionToken, {
        content: `✅ Tu as rejoint la Partie #${game.gameNumber}!`,
        components: [
          {
            type: 1,
            components: [
              { type: 2, style: 5, label: "🐺 Aller au salon", url: `https://discord.com/channels/${game.guildId}/${game.gameChannelId}` },
            ],
          },
        ],
      });
    } catch (err) {
      console.error("handleJoin background error:", err);
      try {
        await editOriginalInteractionResponse(appId, interactionToken, {
          content: "❌ Une erreur est survenue en rejoignant la partie.",
        });
      } catch {}
    }
  })();

  ctx.waitUntil(work);
  return deferredResponse;
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

  // Clear player from active games + KV game player key
  await clearPlayerActive(env.ACTIVE_PLAYERS, userId);
  try { await env.ACTIVE_PLAYERS.delete(`gp:${game.gameNumber}:${userId}`); } catch {}

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
    const newCreatorId = game.players[Math.floor(secureRandom() * game.players.length)]!;
    game.creatorId = newCreatorId;
    const newCreatorMember: any = await getGuildMember(token, game.guildId, newCreatorId);
    game.creatorName = newCreatorMember.nick || newCreatorMember.user.global_name || newCreatorMember.user.username;
    lastEvent = `${playerName} a quitté — ${game.creatorName} est le nouveau créateur`;
  } else {
    lastEvent = `${playerName} a quitté la partie`;
  }

  const quitBots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
  await updateAllEmbeds(token, game, lastEvent, quitBots);

  return json({ type: 4, data: { content: `🚪 Tu as quitté la Partie #${game.gameNumber}.`, flags: 64 } });
}

// ── Game Start (animated role reveal) ────────────────────────────────

const COUNTDOWN_SECONDS = 30;

// ── Phase dispatch: directly call the phase handler in ctx.waitUntil ──
// (Self-invocation via HTTP was returning 404 — Cloudflare blocks it from within ctx.waitUntil)
const WORKER_URL = "https://garou-interactions.gabgingras.workers.dev";

async function dispatchPhase(token: string, phase: string, payload: any, ctx: ExecutionContext, env: Env) {
  console.log(`[phase] ▶ Dispatching: ${phase}`);
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
    else if (phase === "day_discussion") await phaseDiscussion(token, payload, ctx, env);
    else if (phase === "discussion_timer") await phaseDiscussionEnd(token, payload, ctx, env);
    else if (phase === "discussion_end") await phaseDiscussionEnd(token, payload, ctx, env);
    else if (phase === "day_vote") await phaseDayVote(token, payload, ctx, env);
    else if (phase === "day_vote_timer") await phaseDayVoteTimer(token, payload, ctx, env);
    else console.error(`[phase] ❌ Unknown phase: ${phase}`);
    console.log(`[phase] ✅ ${phase} completed`);
  } catch (err) {
    console.error(`[phase] ❌ ${phase} FAILED:`, err);
  }
}

function triggerPhase(ctx: ExecutionContext, env: Env, phase: string, data: Record<string, unknown>) {
  console.log(`[triggerPhase] Scheduling: ${phase}`);
  const token = env.DISCORD_BOT_TOKEN;
  ctx.waitUntil(dispatchPhase(token, phase, data, ctx, env));
}

/** Lightweight timer — polls getMessage every 5s to detect early resolution.
 *  Discord's native <t:DEADLINE:R> handles the visual countdown (zero API cost).
 *  ZERO editMessage calls — the entire game runs in one ctx.waitUntil chain
 *  and any extra API calls risk hitting Cloudflare's execution limits. */
async function runVisualTimer(opts: {
  token: string;
  channelId: string;
  messageId: string;
  totalSeconds: number;
  label: string;
}): Promise<"timeout" | "resolved"> {
  const { token, channelId, messageId, totalSeconds, label } = opts;
  const startTime = Date.now();
  console.log(`[${label}] ⏱️ START: ${totalSeconds}s (poll-only, no editMessage)`);

  while (true) {
    await sleep(5000);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const remaining = Math.max(0, totalSeconds - elapsed);

    try {
      const msg: any = await getMessage(token, channelId, messageId);
      if (!msg.components?.length) {
        console.log(`[${label}] ⏱️ RESOLVED at ${remaining}s remaining`);
        return "resolved";
      }
      if (remaining <= 0) {
        console.log(`[${label}] ⏱️ TIMEOUT`);
        return "timeout";
      }
    } catch (err) {
      console.error(`[${label}] ⏱️ ERROR:`, err);
    }
  }
}

/** Schedule a phase to run after `delaySeconds` via Cloudflare Queue.
 *  The queue consumer gets a FRESH worker invocation with full CPU budget.
 *  This breaks the ctx.waitUntil chain that would otherwise die from wall clock limits. */
async function schedulePhase(env: Env, phase: string, data: Record<string, unknown>, delaySeconds: number) {
  console.log(`[schedulePhase] → ${phase} in ${delaySeconds}s via queue`);
  try {
    await env.PHASE_QUEUE.send(
      { phase, ...data },
      { delaySeconds },
    );
    console.log(`[schedulePhase] → ${phase} queued OK`);
  } catch (err) {
    console.error(`[schedulePhase] → ${phase} FAILED:`, err);
  }
}


// ── Gateway Service (message mirroring for Petite Fille) ────────────

const GATEWAY_TIMEOUT_MS = 5_000;

async function gatewayTrackThread(
  env: Env,
  wolfThreadId: string,
  spyThreadId: string,
  wolves: { id: string; index: number }[]
): Promise<void> {
  if (!env.GATEWAY_URL) {
    console.log("[garou] Gateway skipped: GATEWAY_URL not set");
    return;
  }
  const endpoint = `${env.GATEWAY_URL.replace(/\/+$/, "")}/track-thread`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.GATEWAY_TOKEN) headers.Authorization = `Bearer ${env.GATEWAY_TOKEN}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ wolfThreadId, spyThreadId, wolves }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const body = await res.text();
      console.error(`[garou] Gateway track-thread failed (${res.status}): ${body}`);
    } else {
      console.log(`[garou] Gateway tracking wolf thread ${wolfThreadId} → spy thread ${spyThreadId}`);
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") console.error("[garou] Gateway track-thread timeout");
    else console.error("[garou] Gateway track-thread error:", err);
  }
}

async function gatewayUntrackThread(env: Env, wolfThreadId: string): Promise<void> {
  if (!env.GATEWAY_URL) return;
  const endpoint = `${env.GATEWAY_URL.replace(/\/+$/, "")}/untrack-thread`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.GATEWAY_TOKEN) headers.Authorization = `Bearer ${env.GATEWAY_TOKEN}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  try {
    await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ wolfThreadId }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
  } catch {
    clearTimeout(timeoutId);
  }
}

// ── Phase Status Helper ─────────────────────────────────────────────
// Updates the lobby embed to show which phase is currently active

async function updatePhaseStatus(token: string, game: GameState, title: string, description: string, color: number, image?: string) {
  if (!game.lobbyMessageId) return;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;
  try {
    await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
      embeds: [{
        title: `${title} — Partie #${game.gameNumber}`,
        url: stateUrl,
        description,
        color,
        image: image ? { url: image } : undefined,
      }],
      components: [],
    });
  } catch (err) {
    console.error(`[phaseStatus] Failed to update: ${title}`, err);
  }
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
          `**${game.players.length + (game.botCount ?? 0)} cartes** sont distribuées face cachée...`,
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
  const bots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
  const botIds = bots.map((b) => b.id);
  game.roles = assignRoles(game.players, botIds, game.selectedRoleIds);
  game.witchPotions = { life: true, death: true };

  await sleep(3000);

  // ── Phase 3: Role check (channels are created lazily when players reveal) ──
  game.seen = [...botIds]; // Bots "see" their role instantly
  await editMessage(token, game.gameChannelId, game.lobbyMessageId, buildRoleCheckEmbed(game));

  if (game.announceChannelId && game.announceMessageId) {
    await editMessage(token, game.announceChannelId, game.announceMessageId, {
      embeds: [{
        title: `🎮 Partie #${game.gameNumber} — En cours!`,
        url: `https://garou.bot/s/${encodeState(game)}`,
        description: [`Lancée par <@${game.creatorId}>`, "", `**${game.players.length + (game.botCount ?? 0)} joueurs** — Les rôles sont distribués!`].join("\n"),
        color: EMBED_COLOR_GREEN,
        image: { url: SCENE_IMAGES.night_falls },
        footer: { text: "La partie est en cours!" },
      }],
      components: [],
    });
  }

  // Countdown is triggered directly by handleRevealRole when all players click "Voir mon rôle".
}


// ── Countdown + Night — runs in ctx.waitUntil from handleRevealRole (~15s) ──
async function runCountdownAndNight(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  console.log(`[countdown] Starting for game #${game.gameNumber}`);

  try {
    const msg: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId!);
    const latest = parseGameFromEmbed(msg);
    if (latest) game = latest;
  } catch (e) {
    console.error("[countdown] Re-read failed:", e);
  }

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
          image: { url: SCENE_IMAGES.night_falls },
          footer: { text: "🤫 Ne révèle ton rôle à personne!" },
        }],
        components: [],
      });
    } catch (err) {
      console.error("[countdown] Edit failed:", err);
    }
    await sleep(1000);
  }

  // "Le village s'endort..."
  try {
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
  } catch (err) {
    console.error("[countdown] 'Village s'endort' edit failed:", err);
  }

  await sleep(3000);

  // Trigger night orchestrator (cupidon night 1 → voyante → wolves → sorciere → dawn)
  console.log(`[countdown] Triggering night_start for game #${game.gameNumber}`);
  await dispatchPhase(token, "night_start", { game }, ctx, env);
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
              image: { url: SCENE_IMAGES.game_start },
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
    await dispatchPhase(token, "start_game", { game: currentGame }, ctx, env);
  } catch (err) {
    console.error("Countdown auto-start failed:", err);
  }
}

// ── Night Phase (Wolf Vote) ──────────────────────────────────────────

const NIGHT_VOTE_SECONDS = 90;
const ROLE_CHECK_TIMEOUT = 120; // 2 minutes to check roles
const GAME_START_DELAY = 10; // 10s countdown before night

// ── Voyante State ────────────────────────────────────────────────────

const VOYANTE_TIMEOUT_SECONDS = 60;

// ── Sorciere State ───────────────────────────────────────────────────

const SORCIERE_TIMEOUT_SECONDS = 60;

// ── Cupidon State ────────────────────────────────────────────────────

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
  await dispatchPhase(token, "voyante_phase", { game }, ctx, env);
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

  // Check if already resolved (user acted before timeout)
  const checkMsg: any = await getMessage(token, cupidonThreadId, cupidonMessageId);
  if (!checkMsg.components?.length) { console.log("[cupidonTimer] Already resolved"); return; }

  // Timeout — pick random couple
  const msg: any = await getMessage(token, cupidonThreadId, cupidonMessageId);
  const s = parseCupidonFromEmbed(msg);
  if (!s) return;

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
}

// ── Chasseur State ──────────────────────────────────────────────────

const CHASSEUR_TIMEOUT_SECONDS = 30;

async function triggerChasseurShoot(token: string, game: GameState, chasseurId: string, ctx: ExecutionContext, env: Env) {
  const dead = game.dead ?? [];
  const livingTargets = game.players.filter(id => !dead.includes(id) && id !== chasseurId);
  const humanTargets = await Promise.all(
    livingTargets.map(async (id) => {
      const member: any = await getGuildMember(token, game.guildId, id);
      return { id, name: member.nick || member.user.global_name || member.user.username };
    })
  );
  const chBots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
  const chBotTargets = chBots.filter(b => b.alive && b.id !== chasseurId && !dead.includes(b.id)).map(b => ({ id: b.id, name: b.name }));
  const targets = [...humanTargets, ...chBotTargets];
  if (targets.length === 0) return;

  // BOT AUTO-PLAY: If chasseur is a bot, pick a random target instantly
  if (chasseurId.startsWith("bot_")) {
    const target = targets[Math.floor(Math.random() * targets.length)]!;
    console.log(`[chasseur] Bot ${chasseurId} auto-shooting ${target.name}`);

    await sendMessage(token, game.gameChannelId, {
      embeds: [{
        title: "🏹 Le chasseur tire une dernière flèche!",
        description: `Dans un dernier souffle, le chasseur abat **${target.name}**!`,
        color: 0xe67e22, image: { url: SCENE_IMAGES.snipe_reveal },
      }],
    });

    if (!game.dead) game.dead = [];
    game.dead.push(target.id);

    // Mark bot target as dead
    if (target.id.startsWith("bot_")) {
      const b2 = chBots.find(b => b.id === target.id);
      if (b2) { b2.alive = false; await saveBots(env.ACTIVE_PLAYERS, game.gameNumber, chBots); }
    } else {
      try { await setChannelPermission(token, game.gameChannelId, target.id, { allow: String(1 << 10), deny: String(1 << 11), type: 1 }); } catch {}
    }

    // Couple death chain
    if (game.couple && game.couple.includes(target.id)) {
      const pid = target.id === game.couple[0] ? game.couple[1] : game.couple[0];
      if (pid && !game.dead.includes(pid)) {
        game.dead.push(pid);
        if (!pid.startsWith("bot_")) {
          try { await setChannelPermission(token, game.gameChannelId, pid, { allow: String(1 << 10), deny: String(1 << 11), type: 1 }); } catch {}
        }
        const pName = pid.startsWith("bot_") ? chBots.find(b => b.id === pid)?.name ?? "?" : ((await getGuildMember(token, game.guildId, pid).catch(() => null) as any)?.nick || "?");
        await sendMessage(token, game.gameChannelId, { embeds: [{ title: "💔 Le couple est brisé...", description: `**${pName}** meurt de chagrin.`, color: 0xe91e63 }] });
      }
    }

    // Persist state
    if (game.lobbyMessageId) {
      const su = `https://garou.bot/s/${encodeState(game)}`;
      try {
        const m: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
        const e = m.embeds?.[0];
        if (e) { e.url = su; await editMessage(token, game.gameChannelId, game.lobbyMessageId, { embeds: [e], components: m.components ?? [] }); }
      } catch {}
    }

    const wr = checkWinCondition(game);
    if (wr) { await sleep(2000); await announceVictory(token, game, wr, env); return; }
    await sleep(2000);
    await dispatchPhase(token, "day_discussion", { game }, ctx, env);
    return;
  }

  const deadline = Math.floor(Date.now() / 1000) + CHASSEUR_TIMEOUT_SECONDS;
  const chasseurState: ChasseurState = {
    gameNumber: game.gameNumber, guildId: game.guildId,
    gameChannelId: game.gameChannelId, lobbyMessageId: game.lobbyMessageId!,
    chasseurId, targets, deadline, roles: game.roles ?? {},
    allPlayers: game.players, couple: game.couple, dead: [...dead],
  };

  const chasseurMsg: any = await sendMessage(token, game.gameChannelId, buildChasseurEmbed(chasseurState));

  await schedulePhase(env, "chasseur_timer", { chasseurMessageId: chasseurMsg.id, gameChannelId: game.gameChannelId }, CHASSEUR_TIMEOUT_SECONDS);
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
    if (wr) { await sleep(2000); await announceVictory(token, game, wr, env); return; }

    // No win → start day discussion
    await sleep(2000);
    await dispatchPhase(token, "day_discussion", { game }, ctx, env);
  })());

  return ackResponse;
}

async function phaseChasseurTimer(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { chasseurMessageId, gameChannelId } = data;
  if (!chasseurMessageId || !gameChannelId) return;

  // Check if already resolved (user acted before timeout)
  const checkMsg: any = await getMessage(token, gameChannelId, chasseurMessageId);
  if (!checkMsg.components?.length) { console.log("[chasseurTimer] Already resolved"); return; }

  // Timeout — random target
  const msg: any = await getMessage(token, gameChannelId, chasseurMessageId);
  const s = parseChasseurFromEmbed(msg);
  if (!s) return;

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
  if (wr) { await sleep(2000); await announceVictory(token, game, wr, env); return; }
  await sleep(2000);
  await dispatchPhase(token, "day_discussion", { game }, ctx, env);
}

// ── Wolf Phase (extracted for reuse by cupidon flow) ────────────────

async function startWolfPhase(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  console.log(`[wolfPhase] 🐺 Starting wolf phase for game #${game.gameNumber}`);
  if (!game.roles) { console.error("[wolfPhase] No roles!"); return; }

  // Show wolf wake-up animation in game channel
  await updatePhaseStatus(token, game,
    "🐺 Les loups-garous se réveillent...",
    `*Des ombres se faufilent dans la nuit...*\n*Les loups-garous ouvrent les yeux et choisissent leur victime.*\n\n⏰ Les loups ont **${NIGHT_VOTE_SECONDS} secondes** pour décider.`,
    EMBED_COLOR_NIGHT, getRoleImage("loup"),
  );

  const dead = game.dead ?? [];
  const livingPlayers = game.players.filter(id => !dead.includes(id));
  const humanWolfIds = livingPlayers.filter(id => {
    const r = game.roles![id];
    return r === "loup" || r === "loup_blanc";
  });

  // Load bots and find bot wolves
  const bots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
  const botWolfIds = bots
    .filter((b) => b.alive && (game.roles?.[b.id] === "loup" || game.roles?.[b.id] === "loup_blanc"))
    .map((b) => b.id);
  const allWolfIds = [...humanWolfIds, ...botWolfIds];
  console.log(`[wolfPhase] Wolves: ${allWolfIds.length} total (${humanWolfIds.length} humans, ${botWolfIds.length} bots)`);
  console.log(`[wolfPhase] Bot wolves: ${bots.filter(b => botWolfIds.includes(b.id)).map(b => b.name).join(", ") || "none"}`);

  // Human non-wolf targets
  const humanTargetIds = livingPlayers.filter(id => !allWolfIds.includes(id));
  const humanTargets = await Promise.all(
    humanTargetIds.map(async (id) => {
      const member: any = await getGuildMember(token, game.guildId, id);
      return { id, name: member.nick || member.user.global_name || member.user.username };
    })
  );

  // Bot non-wolf targets
  const botTargets = bots
    .filter((b) => b.alive && !botWolfIds.includes(b.id))
    .map((b) => ({ id: b.id, name: b.name }));

  const targets = [...humanTargets, ...botTargets];

  const deadline = Math.floor(Date.now() / 1000) + NIGHT_VOTE_SECONDS;

  // Build wolf name map for display
  const wolfNames: Record<string, string> = {};
  for (const b of bots.filter((b) => botWolfIds.includes(b.id))) {
    wolfNames[b.id] = b.name;
  }

  const voteState: VoteState = {
    gameNumber: game.gameNumber, guildId: game.guildId,
    gameChannelId: game.gameChannelId, wolfChannelId: "",
    lobbyMessageId: game.lobbyMessageId!, wolves: allWolfIds,
    targets, votes: {}, deadline,
    petiteFilleThreadId: game.petiteFilleThreadId,
    couple: game.couple, allRoles: game.roles,
    allPlayers: [...livingPlayers, ...bots.filter((b) => b.alive).map((b) => b.id)],
    wolfNames,
  };

  const wolfThread: any = await createThread(token, game.gameChannelId, {
    name: "🐺 Tanière", type: 12, auto_archive_duration: 1440,
  });
  game.wolfChannelId = wolfThread.id;
  voteState.wolfChannelId = wolfThread.id;

  // Only add human wolves to thread (bots don't need thread access)
  for (const wolfId of humanWolfIds) {
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
        description: "Tu espionnes les loups-garous cette nuit...\n\nTu verras leurs messages apparaître ici en temps réel.\nIls ne savent pas que tu les observes.\n\n*Fais attention à ne pas te faire repérer...*",
        color: 0x9b59b6, thumbnail: { url: getRoleImage("petite_fille") },
      }],
    });

    // Tell the gateway to mirror wolf thread messages to spy thread
    const wolfIndices = humanWolfIds.map((id, i) => ({ id, index: i + 1 }));
    ctx.waitUntil(gatewayTrackThread(env, wolfThread.id, spyThread.id, wolfIndices).catch(() => {}));
  }

  // If ALL wolves are bots, skip the whole thread/vote UI — just pick a random victim after 5s
  if (humanWolfIds.length === 0) {
    console.log(`[wolfPhase] All wolves are bots — auto-picking victim in 5s`);
    await sendMessage(token, wolfThread.id, {
      content: `🌙 **La nuit est tombée!** Les loups choisissent leur victime...`,
    });

    await sleep(5000);

    // Pick a random non-wolf target
    const victim = targets[Math.floor(Math.random() * targets.length)];
    if (!victim) {
      console.error("[wolfPhase] No targets available!");
      try { await deleteChannel(token, wolfThread.id); } catch {}
      return;
    }
    console.log(`[wolfPhase] Bots chose victim: ${victim.name} (${victim.id})`);

    // Post result in wolf thread
    await sendMessage(token, wolfThread.id, {
      embeds: [{
        title: `☠️ La meute a choisi — Partie #${game.gameNumber}`,
        description: `**${victim.name}** sera dévoré(e) cette nuit.`,
        color: EMBED_COLOR,
        image: { url: SCENE_IMAGES.night_kill },
      }],
    });

    // Clean up and chain to post_wolf (sorciere phase)
    await sleep(2000);
    try { await deleteChannel(token, wolfThread.id); } catch {}
    if (game.petiteFilleThreadId) {
      try { await deleteChannel(token, game.petiteFilleThreadId); } catch {}
    }

    await dispatchPhase(token, "sorciere_phase", {
      game, _wolfVictimId: victim.id, _wolfVictimName: victim.name,
    }, ctx, env);
    return;
  }

  // There are human wolves — use the normal vote UI
  const wolfMentions = humanWolfIds.map(id => `<@${id}>`).join(" ");
  await sendMessage(token, wolfThread.id, {
    content: `${wolfMentions}\n\n🌙 **La nuit est tombée!** Choisissez votre victime ci-dessous.`,
  });
  const voteMsg: any = await sendMessage(token, wolfThread.id, buildVoteEmbed(voteState));

  // Pre-fill bot wolf votes immediately (no delay, no LLM)
  for (const botWolf of bots.filter((b) => b.alive && botWolfIds.includes(b.id))) {
    const fd = fallbackDecision(targets, botWolf.id);
    voteState.votes[botWolf.id] = fd.action;
    console.log(`[wolfPhase] Bot ${botWolf.name} pre-voted for ${fd.action}`);
    await sendMessage(token, wolfThread.id, {
      content: `**${botWolf.emoji} ${botWolf.name}** : "${fd.message}"`,
    });
  }

  // Update vote embed with bot votes already applied
  await editMessage(token, wolfThread.id, voteMsg.id, buildVoteEmbed(voteState));

  // Check if all wolves already voted (bots filled + maybe only bots)
  const allVoted = voteState.wolves.every((wId) => voteState.votes[wId]);
  if (allVoted) {
    const allSameTarget = new Set(Object.values(voteState.votes)).size === 1;
    if (allSameTarget) {
      await resolveNightVote(token, voteState, voteMsg.id, ctx, env);
      return;
    }
  }

  await schedulePhase(env, "night_vote_timer", { voteMessageId: voteMsg.id, wolfChannelId: wolfThread.id }, NIGHT_VOTE_SECONDS);
}

// ── Night Phase Orchestrator ────────────────────────────────────────
// Turn order: Night 1 → Cupidon picks couple → Voyante → Wolves
//             Night 2+ → Voyante → Wolves directly

async function startNightPhase(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  console.log(`[nightStart] 🌙 Starting night #${(game.nightCount ?? 0) + 1} for game #${game.gameNumber}, players: ${game.players.length}, dead: ${(game.dead ?? []).length}`);
  if (!game.roles) { console.error("[nightStart] No roles assigned!"); return; }

  // Increment night count and persist
  game.nightCount = (game.nightCount ?? 0) + 1;

  // Clean up game channel: delete all messages except the lobby/storytelling embed
  if (game.nightCount > 1 && game.lobbyMessageId) {
    try {
      const allMsgs: any[] = [];
      let lastId: string | undefined;
      // Fetch all messages (paginated)
      for (let page = 0; page < 10; page++) {
        const batch: any[] = await getChannelMessages(token, game.gameChannelId, lastId, 100);
        if (!batch.length) break;
        allMsgs.push(...batch);
        lastId = batch[batch.length - 1]!.id;
        if (batch.length < 100) break;
      }
      const toDelete = allMsgs
        .filter((m: any) => m.id !== game.lobbyMessageId)
        .map((m: any) => m.id);
      if (toDelete.length > 0) {
        console.log(`[nightStart] Cleaning ${toDelete.length} messages from game channel`);
        await bulkDeleteMessages(token, game.gameChannelId, toDelete);
      }
    } catch (err) {
      console.error("[nightStart] Failed to clean game channel:", err);
    }
  }

  await updatePhaseStatus(token, game,
    `🌙 Nuit ${game.nightCount} — Le village s'endort...`,
    "*Chaque villageois ferme les yeux...*\n*Le silence envahit le village...*",
    EMBED_COLOR_NIGHT, SCENE_IMAGES.night_falls,
  );

  // Night 1 + cupidon alive → cupidon picks couple first, then chains to voyante → wolves
  if (game.nightCount === 1) {
    const dead = game.dead ?? [];
    const cupidonEntry = Object.entries(game.roles).find(([id, r]) => r === "cupidon" && !dead.includes(id));
    if (cupidonEntry) {
      const cupidonId = cupidonEntry[0];
      const livingPlayers = game.players.filter(id => !dead.includes(id));

      const humanTargets = await Promise.all(
        livingPlayers.filter(id => id !== cupidonId).map(async (id) => {
          const member: any = await getGuildMember(token, game.guildId, id);
          return { id, name: member.nick || member.user.global_name || member.user.username };
        })
      );
      // Include bots as cupidon targets
      const cupBots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
      const botTargets = cupBots.filter(b => b.alive && b.id !== cupidonId && !dead.includes(b.id)).map(b => ({ id: b.id, name: b.name }));
      const playerTargets = [...humanTargets, ...botTargets];

      // BOT AUTO-PLAY: If cupidon is a bot, pick 2 random targets instantly
      if (cupidonId.startsWith("bot_")) {
        await updatePhaseStatus(token, game,
          "💘 Cupidon se réveille...",
          "*Cupidon bande son arc et choisit deux âmes à lier...*",
          EMBED_COLOR_PURPLE, getRoleImage("cupidon"),
        );
        await sleep(3000);
        console.log(`[cupidon] Bot ${cupidonId} auto-picking couple`);
        if (playerTargets.length >= 2) {
          const shuffled = [...playerTargets].sort(() => Math.random() - 0.5);
          const pick1 = shuffled[0]!;
          const pick2 = shuffled[1]!;
          game.couple = [pick1.id, pick2.id];
          console.log(`[cupidon] Bot chose couple: ${pick1.name} + ${pick2.name}`);
          await sendMessage(token, game.gameChannelId, {
            embeds: [{
              title: "💘 Cupidon a tiré ses flèches!",
              description: "Deux âmes sont désormais liées par l'amour...",
              color: 0xe91e63,
            }],
          });
          // Persist couple in game state
          if (game.lobbyMessageId) {
            const su = `https://garou.bot/s/${encodeState(game)}`;
            try {
              const m: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
              const e = m.embeds?.[0];
              if (e) { e.url = su; await editMessage(token, game.gameChannelId, game.lobbyMessageId, { embeds: [e], components: m.components ?? [] }); }
            } catch {}
          }
        }
        await dispatchPhase(token, "voyante_phase", { game }, ctx, env);
        return;
      }

      await updatePhaseStatus(token, game,
        "💘 Cupidon se réveille...",
        "*Cupidon bande son arc et choisit deux âmes à lier...*",
        EMBED_COLOR_PURPLE, getRoleImage("cupidon"),
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

      await schedulePhase(env, "cupidon_timer", { cupidonMessageId: cupidonMsg.id, cupidonThreadId: cupidonThread.id }, CUPIDON_TIMEOUT_SECONDS);

      return;
    }
  }

  // No cupidon (or not night 1) → go to voyante phase which chains to wolf_phase
  await dispatchPhase(token, "voyante_phase", { game }, ctx, env);
}

// ── Voyante Phase ────────────────────────────────────────────────────

async function phaseVoyante(token: string, game: GameState, ctx: ExecutionContext, env: Env) {
  if (!game.roles) { await dispatchPhase(token, "wolf_phase", { game }, ctx, env); return; }
  const dead = game.dead ?? [];

  const voyanteEntry = Object.entries(game.roles).find(([id, r]) => r === "voyante" && !dead.includes(id));
  if (!voyanteEntry) {
    await dispatchPhase(token, "wolf_phase", { game }, ctx, env);
    return;
  }
  const voyanteId = voyanteEntry[0];

  // Update lobby status
  await updatePhaseStatus(token, game,
    "🔮 La Voyante se réveille...",
    "*La Voyante ouvre les yeux et scrute le village...*",
    EMBED_COLOR_PURPLE, getRoleImage("voyante"),
  );

  // Targets = all living players (humans + bots) except voyante
  const targetIds = game.players.filter((id) => id !== voyanteId && !dead.includes(id));
  const humanTargets = await Promise.all(
    targetIds.map(async (id) => {
      const member: any = await getGuildMember(token, game.guildId, id);
      return { id, name: member.nick || member.user.global_name || member.user.username };
    })
  );
  // Also include alive bots as targets
  const bots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
  const botTargets = bots.filter((b) => b.alive && b.id !== voyanteId && !dead.includes(b.id)).map((b) => ({ id: b.id, name: b.name }));
  const targets = [...humanTargets, ...botTargets];
  console.log(`[voyante] Targets: ${targets.map(t => t.name).join(", ")} (${humanTargets.length} humans, ${botTargets.length} bots)`);

  // BOT AUTO-PLAY: If voyante is a bot, skip instantly (just look at a random person, no visible effect)
  if (voyanteId.startsWith("bot_")) {
    const pick = targets[Math.floor(Math.random() * targets.length)];
    console.log(`[voyante] Bot ${voyanteId} auto-spied on ${pick?.name ?? "nobody"}`);
    await dispatchPhase(token, "wolf_phase", { game }, ctx, env);
    return;
  }

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

  // Schedule timeout via queue (fresh worker invocation)
  await schedulePhase(env, "voyante_timer", { voyanteMessageId: vyMsg.id, voyanteThreadId: voyanteThread.id, game }, VOYANTE_TIMEOUT_SECONDS);
}

async function phaseVoyanteTimer(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { voyanteMessageId, voyanteThreadId, game } = data;
  if (!voyanteMessageId || !voyanteThreadId) return;

  // Check if already resolved (user acted before timeout)
  const checkMsg: any = await getMessage(token, voyanteThreadId, voyanteMessageId);
  if (!checkMsg.components?.length) { console.log("[voyanteTimer] Already resolved"); return; }

  // Timeout — voyante didn't act
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
  console.log("[voyanteTimer] Timeout → wolf_phase");
  await dispatchPhase(token, "wolf_phase", { game }, ctx, env);
}

async function handleVoyanteSee(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
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

  const token = env.DISCORD_BOT_TOKEN;

  // Chain to wolf phase after a short delay (don't rely on timer)
  ctx.waitUntil((async () => {
    await sleep(3000);
    try { await deleteChannel(token, vy.voyanteThreadId); } catch {}
    // Re-read game state from lobby embed
    const lobbyMsg: any = await getMessage(token, vy.gameChannelId, vy.lobbyMessageId);
    const game = parseGameFromEmbed(lobbyMsg);
    if (game) {
      console.log("[voyanteSee] → wolf_phase");
      await dispatchPhase(token, "wolf_phase", { game }, ctx, env);
    }
  })());

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
  console.log(`[voteTimer] Timeout triggered, voteMsg=${voteMessageId}, wolfChannel=${wolfChannelId}`);
  if (!voteMessageId || !wolfChannelId) { console.error("[voteTimer] Missing fields!"); return; }

  // Check if already resolved (users voted before timeout)
  const currentMsg: any = await getMessage(token, wolfChannelId, voteMessageId);
  if (!currentMsg.components?.length) { console.log("[voteTimer] Already resolved"); return; }
  const currentVote = parseVoteFromEmbed(currentMsg);
  if (!currentVote) return;
  console.log("[voteTimer] Deadline reached, resolving...");
  await resolveNightVote(token, currentVote, voteMessageId, ctx, env);
}

// ── Win Conditions ──────────────────────────────────────────────────

async function announceVictory(token: string, game: GameState, result: WinResult, env: Env) {
  const dead = game.dead ?? [];
  const bots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);

  // Build role reveal lines — humans
  const revealLines = game.players.map((id) => {
    const roleKey = game.roles?.[id] ?? "villageois";
    const role = ROLES[roleKey] ?? ROLES.villageois!;
    const isDead = dead.includes(id);
    const status = isDead ? "💀" : "✅";
    return `${status} ${role.emoji} <@${id}> — **${role.name}**`;
  });
  // Bot reveal lines
  for (const bot of bots) {
    const roleKey = game.roles?.[bot.id] ?? "villageois";
    const role = ROLES[roleKey] ?? ROLES.villageois!;
    const status = bot.alive ? "✅" : "💀";
    revealLines.push(`${status} ${role.emoji} 🤖 ${bot.name} — **${role.name}**`);
  }

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
    gatewayUntrackThread(env, game.wolfChannelId).catch(() => {});
    try { await deleteChannel(token, game.wolfChannelId); } catch {}
  }

}

async function resolveNightVote(token: string, vote: VoteState, voteMessageId: string, ctx?: ExecutionContext, env?: Env) {
  console.log(`[resolveNightVote] Resolving for game #${vote.gameNumber}, votes: ${JSON.stringify(vote.votes)}`);
  // Safety: check if already resolved
  try {
    const check: any = await getMessage(token, vote.wolfChannelId, voteMessageId);
    if (!check.components?.length) { console.log("[resolveNightVote] Already resolved"); return; }
  } catch (err) { console.error("[resolveNightVote] Safety check failed:", err); return; }

  // Determine victim
  const voteCounts: Record<string, number> = {};
  for (const targetId of Object.values(vote.votes)) {
    voteCounts[targetId] = (voteCounts[targetId] ?? 0) + 1;
  }

  let victimId: string;
  const entries = Object.entries(voteCounts);

  if (entries.length === 0) {
    victimId = vote.targets[Math.floor(secureRandom() * vote.targets.length)]!.id;
  } else {
    const maxVotes = Math.max(...entries.map(([_, c]) => c));
    const topTargets = entries.filter(([_, c]) => c === maxVotes).map(([id]) => id);
    victimId = topTargets.length === 1
      ? topTargets[0]!
      : topTargets[Math.floor(secureRandom() * topTargets.length)]!;
  }

  const victim = vote.targets.find((t) => t.id === victimId)!;
  const stateUrl = `https://garou.bot/v/${encodeVoteState(vote)}`;

  // Edit vote embed — show result, remove buttons
  await editMessage(token, vote.wolfChannelId, voteMessageId, {
    embeds: [{
      title: `☠️ La meute a choisi — Partie #${vote.gameNumber}`,
      url: stateUrl,
      description: [
        `**${victim.name}**${victim.id.startsWith("bot_") ? " 🤖" : ` (<@${victim.id}>)`} sera dévoré(e) cette nuit.`,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...vote.wolves.map((wId) => {
          const targetId = vote.votes[wId];
          const target = targetId ? vote.targets.find((t) => t.id === targetId) : null;
          const wolfLabel = wId.startsWith("bot_")
            ? `🤖 **${vote.wolfNames?.[wId] ?? wId}**`
            : `🐺 <@${wId}>`;
          return `${wolfLabel} → ${target ? target.name : "*(pas voté)*"}`;
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
  if (ctx && env) ctx.waitUntil(gatewayUntrackThread(env, vote.wolfChannelId).catch(() => {}));
  try { await deleteChannel(token, vote.wolfChannelId); } catch {}

  // Mark bot victim as dead in KV
  if (env && victimId.startsWith("bot_")) {
    const bots = await loadBots(env.ACTIVE_PLAYERS, vote.gameNumber);
    const bot = bots.find((b) => b.id === victimId);
    if (bot) {
      bot.alive = false;
      await saveBots(env.ACTIVE_PLAYERS, vote.gameNumber, bots);
    }
  }

  // Append to game history
  if (env) {
    await appendHistory(
      env.ACTIVE_PLAYERS,
      vote.gameNumber,
      `Nuit: ${victim.name} a été dévoré(e) par les loups-garous`,
    );
  }

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
      await dispatchPhase(token, "post_wolf", { game, _wolfVictimId: victimId, _wolfVictimName: victim.name }, ctx, env);
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
    await dispatchPhase(token, "sorciere_phase", { game, _wolfVictimId, _wolfVictimName }, ctx, env);
  } else {
    await dispatchPhase(token, "dawn_phase", { game, _wolfVictimId, _wolfVictimName, _witchSaved: false, _witchKillId: undefined }, ctx, env);
  }
}

// ── Dawn Phase ───────────────────────────────────────────────────────

async function phaseDawn(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { game, _wolfVictimId, _wolfVictimName, _witchSaved, _witchKillId } = data as {
    game: GameState; _wolfVictimId: string; _wolfVictimName: string;
    _witchSaved?: boolean; _witchKillId?: string;
  };
  if (!game) return;

  // Update lobby status
  await updatePhaseStatus(token, game,
    "☀️ Le jour se lève...",
    "*Les premiers rayons du soleil éclairent le village...*",
    EMBED_COLOR_ORANGE, SCENE_IMAGES.dawn_breaks,
  );

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
      await dispatchPhase(token, "loup_blanc_vote", { game }, ctx, env);
      return;
    }
  }

  // No special phases → start day discussion (fresh budget via self-invocation)
  await sleep(3000);
  await dispatchPhase(token, "day_discussion", { game }, ctx, env);
}

// ── Sorciere Phase ───────────────────────────────────────────────────

async function phaseSorciere(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { game, _wolfVictimId, _wolfVictimName } = data as { game: GameState; _wolfVictimId: string; _wolfVictimName: string };
  if (!game?.roles) { await dispatchPhase(token, "dawn_phase", { game, _wolfVictimId, _wolfVictimName, _witchSaved: false }, ctx, env); return; }

  const dead = game.dead ?? [];
  const sorciereEntry = Object.entries(game.roles).find(([id, r]) => r === "sorciere" && !dead.includes(id));
  if (!sorciereEntry) {
    await dispatchPhase(token, "dawn_phase", { game, _wolfVictimId, _wolfVictimName, _witchSaved: false }, ctx, env);
    return;
  }
  const sorciereId = sorciereEntry[0];
  const potions = game.witchPotions ?? { life: false, death: false };

  // Update lobby status
  await updatePhaseStatus(token, game,
    "🧪 La Sorcière se réveille...",
    "*La Sorcière ouvre les yeux et prépare ses potions...*",
    EMBED_COLOR_PURPLE, getRoleImage("sorciere"),
  );

  // BOT AUTO-PLAY: If sorciere is a bot, skip instantly (don't use potions)
  if (sorciereId.startsWith("bot_")) {
    console.log(`[sorciere] Bot ${sorciereId} auto-skipping (no potions used)`);
    await sleep(3000);
    await dispatchPhase(token, "dawn_phase", { game, _wolfVictimId, _wolfVictimName, _witchSaved: false }, ctx, env);
    return;
  }

  // Build targets for death potion (all living players + bots except sorciere)
  const targetIds = game.players.filter((id) => id !== sorciereId && !dead.includes(id));
  const humanTargets = await Promise.all(
    targetIds.map(async (id) => {
      const member: any = await getGuildMember(token, game.guildId, id);
      return { id, name: member.nick || member.user.global_name || member.user.username };
    })
  );
  const soBots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
  const soBotTargets = soBots.filter(b => b.alive && b.id !== sorciereId && !dead.includes(b.id)).map(b => ({ id: b.id, name: b.name }));
  const targets = [...humanTargets, ...soBotTargets];

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

  // Schedule timeout via queue (fresh worker invocation)
  await schedulePhase(env, "sorciere_timer", { sorciereMessageId: soMsg.id, sorciereThreadId: sorciereThread.id, game, _wolfVictimId, _wolfVictimName }, SORCIERE_TIMEOUT_SECONDS);
}

async function phaseSorciereTimer(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { sorciereMessageId, sorciereThreadId, game, _wolfVictimId, _wolfVictimName } = data;
  if (!sorciereMessageId || !sorciereThreadId) return;

  // Check if already resolved (user acted before timeout)
  const checkMsg: any = await getMessage(token, sorciereThreadId, sorciereMessageId);
  if (!checkMsg.components?.length) { console.log("[sorciereTimer] Already resolved"); return; }

  // Timeout — sorciere didn't act
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
  console.log("[sorciereTimer] Timeout → dawn_phase");
  await dispatchPhase(token, "dawn_phase", { game, _wolfVictimId, _wolfVictimName, _witchSaved: false }, ctx, env);
}

async function handleSorciereLife(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const so = parseSorciereFromEmbed(interaction.message);
  if (!so) return json({ type: 4, data: { content: "❌ Erreur: état introuvable.", flags: 64 } });
  if (userId !== so.sorciereId) return json({ type: 4, data: { content: "❌ Seule la Sorcière peut utiliser ce pouvoir.", flags: 64 } });
  if (!so.potions.life) return json({ type: 4, data: { content: "❌ Tu as déjà utilisé ta Potion de Vie.", flags: 64 } });

  so.witchSaved = true;
  so.resolved = true;
  const stateUrl = `https://garou.bot/so/${encodeSorciereState(so)}`;

  const token = env.DISCORD_BOT_TOKEN;
  // Chain to dawn after response
  ctx.waitUntil((async () => {
    await sleep(3000);
    try { await deleteChannel(token, so.sorciereThreadId); } catch {}
    const lobbyMsg: any = await getMessage(token, so.gameChannelId, so.lobbyMessageId);
    const game = parseGameFromEmbed(lobbyMsg);
    if (game) {
      if (game.witchPotions) game.witchPotions.life = false;
      console.log("[sorciereLife] → dawn_phase (saved)");
      await dispatchPhase(token, "dawn_phase", { game, _wolfVictimId: so.wolfVictimId, _wolfVictimName: so.wolfVictimName, _witchSaved: true }, ctx, env);
    }
  })());

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

async function handleSorciereTarget(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
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

  const token = env.DISCORD_BOT_TOKEN;
  // Chain to dawn after response
  ctx.waitUntil((async () => {
    await sleep(3000);
    try { await deleteChannel(token, so.sorciereThreadId); } catch {}
    const lobbyMsg: any = await getMessage(token, so.gameChannelId, so.lobbyMessageId);
    const game = parseGameFromEmbed(lobbyMsg);
    if (game) {
      if (game.witchPotions) game.witchPotions.death = false;
      console.log("[sorciereTarget] → dawn_phase (killed)");
      await dispatchPhase(token, "dawn_phase", { game, _wolfVictimId: so.wolfVictimId, _wolfVictimName: so.wolfVictimName, _witchSaved: false, _witchKillId: targetId }, ctx, env);
    }
  })());

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

async function handleSorciereSkip(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const so = parseSorciereFromEmbed(interaction.message);
  if (!so) return json({ type: 4, data: { content: "❌ Erreur: état introuvable.", flags: 64 } });
  if (userId !== so.sorciereId) return json({ type: 4, data: { content: "❌ Seule la Sorcière peut faire ça.", flags: 64 } });

  so.resolved = true;
  const stateUrl = `https://garou.bot/so/${encodeSorciereState(so)}`;

  const token = env.DISCORD_BOT_TOKEN;
  // Chain to dawn after response
  ctx.waitUntil((async () => {
    await sleep(3000);
    try { await deleteChannel(token, so.sorciereThreadId); } catch {}
    const lobbyMsg: any = await getMessage(token, so.gameChannelId, so.lobbyMessageId);
    const game = parseGameFromEmbed(lobbyMsg);
    if (game) {
      console.log("[sorciereSkip] → dawn_phase");
      await dispatchPhase(token, "dawn_phase", { game, _wolfVictimId: so.wolfVictimId, _wolfVictimName: so.wolfVictimName, _witchSaved: false }, ctx, env);
    }
  })());

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

  // Update lobby status
  await updatePhaseStatus(token, game,
    "⚪ Le Loup-Garou Blanc rôde...",
    "*Une ombre plus pâle que les autres se faufile parmi les loups...*",
    0xffffff, getRoleImage("loup_blanc"),
  );
  const loupBlancId = loupBlancEntry[0];

  // Targets = living regular wolves (not loup_blanc itself)
  const wolfTargetIds = Object.entries(game.roles)
    .filter(([id, r]) => r === "loup" && !dead.includes(id) && id !== loupBlancId)
    .map(([id]) => id);

  if (wolfTargetIds.length === 0) return; // No wolves to kill

  // BOT AUTO-PLAY: If loup blanc is a bot, randomly kill a wolf or skip
  if (loupBlancId.startsWith("bot_")) {
    const doKill = Math.random() < 0.5;
    if (doKill && wolfTargetIds.length > 0) {
      const victimId = wolfTargetIds[Math.floor(Math.random() * wolfTargetIds.length)]!;
      console.log(`[loupBlanc] Bot ${loupBlancId} auto-killing wolf ${victimId}`);

      // Mark as dead
      if (!game.dead) game.dead = [];
      game.dead.push(victimId);

      // Mark bot as dead if it's a bot
      if (victimId.startsWith("bot_")) {
        const lbBots2 = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
        const victimBot = lbBots2.find(b => b.id === victimId);
        if (victimBot) {
          victimBot.alive = false;
          await saveBots(env.ACTIVE_PLAYERS, game.gameNumber, lbBots2);
        }
      } else {
        // Set spectator perms for human
        try { await setChannelPermission(token, game.gameChannelId, victimId, { allow: String(1 << 10), deny: String(1 << 11), type: 1 }); } catch {}
      }

      // Persist state
      if (game.lobbyMessageId) {
        const su = `https://garou.bot/s/${encodeState(game)}`;
        try {
          const m: any = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
          const e = m.embeds?.[0];
          if (e) { e.url = su; await editMessage(token, game.gameChannelId, game.lobbyMessageId, { embeds: [e], components: m.components ?? [] }); }
        } catch {}
      }
    } else {
      console.log(`[loupBlanc] Bot ${loupBlancId} auto-skipped`);
    }
    return;
  }

  const lbBots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
  const targets: { id: string; name: string }[] = [];
  for (const id of wolfTargetIds) {
    if (id.startsWith("bot_")) {
      const bot = lbBots.find(b => b.id === id);
      if (bot) targets.push({ id, name: bot.name });
    } else {
      const member: any = await getGuildMember(token, game.guildId, id);
      targets.push({ id, name: member.nick || member.user.global_name || member.user.username });
    }
  }

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

  // Schedule timeout via queue (fresh worker invocation)
  await schedulePhase(env, "loup_blanc_timer", { lbDmChannelId: dmChannel.id, lbDmMessageId: dmMsg.id, gameChannelId: game.gameChannelId, lobbyMessageId: game.lobbyMessageId }, LOUP_BLANC_VOTE_SECONDS);
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
    // Recover game and start day discussion
    ctx.waitUntil((async () => {
      try {
        const lobbyMsg: any = await getMessage(token, lb.gameChannelId, lb.lobbyMessageId);
        const game = parseGameFromEmbed(lobbyMsg);
        if (game) {
          await sleep(2000);
          await dispatchPhase(token, "day_discussion", { game }, ctx, env);
        }
      } catch {}
    })());
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
        return;
      }

      // No win → start day discussion
      await sleep(3000);
      await dispatchPhase(token, "day_discussion", { game }, ctx, env);
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

  // Check if already resolved (user acted before timeout)
  const checkMsg: any = await getMessage(token, dmChannelId, dmMessageId);
  if (!checkMsg.components?.length) { console.log("[loupBlancTimer] Already resolved"); return; }

  // Timeout — no kill
  await editMessage(token, dmChannelId, dmMessageId, {
    embeds: [{
      title: "⚪ Loup-Garou Blanc — Temps écoulé",
      description: "Tu n'as pas choisi à temps. Aucun loup n'est éliminé cette nuit.",
      color: 0xffffff,
      thumbnail: { url: getRoleImage("loup_blanc") },
    }],
    components: [],
  });
  if (data.gameChannelId && data.lobbyMessageId) {
    try {
      const lobbyMsg: any = await getMessage(token, data.gameChannelId, data.lobbyMessageId);
      const game = parseGameFromEmbed(lobbyMsg);
      if (game) {
        await sleep(2000);
        console.log("[loupBlancTimer] Timeout → day_discussion");
        await dispatchPhase(token, "day_discussion", { game }, ctx, env);
      }
    } catch {}
  }
}

// ── Day Discussion & Village Vote ────────────────────────────────────

// ── Discussion Phase ────────────────────────────────────────────────

async function phaseDiscussion(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { game } = data as { game: GameState };
  if (!game) return;

  const dead = game.dead ?? [];
  const livingPlayers = game.players.filter((id) => !dead.includes(id));
  const discussionSeconds = game.discussionTime ?? 120;
  const deadline = Math.floor(Date.now() / 1000) + discussionSeconds;

  // Unlock SEND_MESSAGES for living players
  for (const playerId of livingPlayers) {
    try {
      await setChannelPermission(token, game.gameChannelId, playerId, {
        allow: ((1n << 10n) | (1n << 11n)).toString(), // VIEW + SEND
        type: 1,
      });
    } catch {}
  }

  // Update lobby status with countdown
  await updatePhaseStatus(token, game,
    `💬 Discussion — ${discussionSeconds}s`,
    `*Les villageois discutent librement...*\n\n⏰ Fin de la discussion <t:${deadline}:R>`,
    EMBED_COLOR_ORANGE, SCENE_IMAGES.dawn_breaks,
  );

  console.log(`[discussion] ⏱️ START: ${discussionSeconds}s, gameChannel=${game.gameChannelId}`);

  // Fire bot messages concurrently (non-blocking)
  const bots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
  const aliveBots = bots.filter((b) => b.alive);
  if (aliveBots.length > 0 && game.roles) {
    const botAlivePlayers = await buildBotAlivePlayersList(token, game, livingPlayers, aliveBots);
    const botMsgCount = 5 + Math.floor(Math.random() * 2);
    console.log(`[discussion] ⏱️ launching ${botMsgCount} bot messages (ctx.waitUntil)`);
    ctx.waitUntil((async () => {
      for (let i = 0; i < botMsgCount; i++) {
        const bot = aliveBots[Math.floor(Math.random() * aliveBots.length)]!;
        const role = game.roles![bot.id] ?? "villageois";
        await sleep(2000 + Math.floor(Math.random() * 2000));
        try {
          await executeBotDiscussion(token, env, bot, bots, game.gameChannelId, game.gameNumber, role, botAlivePlayers);
        } catch (e) {
          console.error(`[discussion] ⏱️ bot msg error:`, e);
        }
      }
      console.log(`[discussion] ⏱️ all bot messages sent`);
    })());
  }

  // Schedule discussion timeout via queue — gets a FRESH worker invocation after delay
  // No sleep needed: the queue delivers the message after discussionSeconds
  console.log(`[discussion] ⏱️ scheduling discussion_end via queue in ${discussionSeconds}s`);
  await schedulePhase(env, "discussion_end", {
    game,
  }, discussionSeconds);
}

/** Build alive players list for bot context */
async function buildBotAlivePlayersList(
  token: string, game: GameState, livingPlayers: string[], aliveBots: BotPlayer[],
): Promise<{ id: string; name: string }[]> {
  const result: { id: string; name: string }[] = [];
  for (const id of livingPlayers) {
    try {
      const m: any = await getGuildMember(token, game.guildId, id);
      result.push({ id, name: m.nick || m.user.global_name || m.user.username });
    } catch { result.push({ id, name: id }); }
  }
  for (const b of aliveBots) {
    result.push({ id: b.id, name: b.name });
  }
  return result;
}

/** Discussion end — triggered by Cloudflare Queue after the discussion delay.
 *  Runs in a FRESH worker invocation with full CPU budget. No sleep needed. */
async function phaseDiscussionEnd(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { game } = data;
  if (!game) return;
  console.log(`[discussionEnd] ⏱️ Locking chat, transitioning to day_vote`);

  // Discussion over — lock chat
  const dead = game.dead ?? [];
  const livingPlayers = game.players.filter((id: string) => !dead.includes(id));
  for (const playerId of livingPlayers) {
    try {
      await setChannelPermission(token, game.gameChannelId, playerId, {
        allow: String(1 << 10),
        deny: String(1 << 11),
        type: 1,
      });
    } catch {}
  }

  await dispatchPhase(token, "day_vote", { game }, ctx, env);
}

// ── Day Vote Phase ──────────────────────────────────────────────────

async function phaseDayVote(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { game } = data as { game: GameState };
  if (!game) return;

  const dead = game.dead ?? [];
  const livingPlayers = game.players.filter((id) => !dead.includes(id));
  const voteSeconds = game.voteTime ?? 60;

  // Update lobby status
  const deadline2 = Math.floor(Date.now() / 1000) + voteSeconds;
  await updatePhaseStatus(token, game,
    "🗳️ Vote du village",
    `*Le village doit choisir qui éliminer...*\n\n⏰ Fin du vote: <t:${deadline2}:R>`,
    EMBED_COLOR, SCENE_IMAGES.day_elimination,
  );
  const deadline = Math.floor(Date.now() / 1000) + voteSeconds;

  // Load bots
  const bots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
  const aliveBots = bots.filter((b) => b.alive);

  // Build targets (all living players + bots)
  const targets: { id: string; name: string }[] = await Promise.all(
    livingPlayers.map(async (id) => {
      let name = id;
      try {
        const member: any = await getGuildMember(token, game.guildId, id);
        name = member.nick || member.user.global_name || member.user.username;
      } catch {}
      return { id, name };
    })
  );
  for (const b of aliveBots) {
    targets.push({ id: b.id, name: b.name });
  }

  // Voters = living humans + alive bots
  const allVoters = [...livingPlayers, ...aliveBots.map((b) => b.id)];

  const dvState: DayVoteState = {
    gameNumber: game.gameNumber,
    guildId: game.guildId,
    gameChannelId: game.gameChannelId,
    lobbyMessageId: game.lobbyMessageId!,
    targets,
    votes: {},
    voters: allVoters,
    deadline,
    allRoles: game.roles,
    couple: game.couple,
    discussionTime: game.discussionTime,
    voteTime: game.voteTime,
  };

  const stateUrl = `https://garou.bot/dv/${encodeDayVoteState(dvState)}`;

  // Build voter status lines
  const voterLines = allVoters.map((id) => {
    if (id.startsWith("bot_")) {
      const b = aliveBots.find((b) => b.id === id);
      return `⬜ 🤖 ${b?.name ?? id} — *en attente...*`;
    }
    return `⬜ <@${id}> — *en attente...*`;
  });

  // Build buttons (5 per row max)
  const rows: any[] = [];
  let currentRow: any[] = [];
  for (const t of targets) {
    currentRow.push({
      type: 2, style: 4, label: t.name.slice(0, 80),
      custom_id: `day_vote_${game.gameNumber}_${t.id}`,
    });
    if (currentRow.length === 5) {
      rows.push({ type: 1, components: currentRow });
      currentRow = [];
    }
  }
  // Add skip button
  currentRow.push({
    type: 2, style: 2, label: "⏭️ Passer",
    custom_id: `day_skip_${game.gameNumber}`,
  });
  if (currentRow.length > 5) {
    rows.push({ type: 1, components: currentRow.slice(0, 5) });
    rows.push({ type: 1, components: currentRow.slice(5) });
  } else {
    rows.push({ type: 1, components: currentRow });
  }

  const voteMsg: any = await sendMessage(token, game.gameChannelId, {
    embeds: [{
      title: `🗳️ Vote du village — Partie #${game.gameNumber}`,
      url: stateUrl,
      description: [
        "Votez pour éliminer un suspect, ou passez votre tour.",
        "",
        `⏰ Fin du vote: <t:${deadline}:R>`,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...voterLines,
      ].join("\n"),
      color: EMBED_COLOR,
      image: { url: SCENE_IMAGES.day_elimination },
    }],
    components: rows,
  });

  dvState.voteMessageId = voteMsg.id;

  // Update embed with voteMessageId
  const updatedUrl = `https://garou.bot/dv/${encodeDayVoteState(dvState)}`;
  try {
    const embed = voteMsg.embeds?.[0];
    if (embed) {
      embed.url = updatedUrl;
      await editMessage(token, game.gameChannelId, voteMsg.id, {
        embeds: [embed],
        components: voteMsg.components ?? rows,
      });
    }
  } catch {}

  // Bot voting (non-blocking) + schedule timeout via queue
  ctx.waitUntil((async () => {
    const bots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
    const aliveBots = bots.filter((b) => b.alive);
    for (const bot of aliveBots) {
      await sleep(2000 + Math.floor(Math.random() * 2000));
      try {
        await executeBotDayVote(token, env, bot, bots, game.gameChannelId, voteMsg.id, game.gameNumber, "villageois", ctx);
      } catch (err) {
        console.error(`[dayVote] Bot ${bot.name} vote failed:`, err);
      }
    }
  })());
  await schedulePhase(env, "day_vote_timer", {
    voteMessageId: voteMsg.id,
    gameChannelId: game.gameChannelId,
  }, voteSeconds);
}

async function handleDayVote(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "❌ Erreur.", flags: 64 } });

  const dv = parseDayVoteFromEmbed(interaction.message);
  if (!dv) return json({ type: 4, data: { content: "❌ Erreur: vote introuvable.", flags: 64 } });

  if (!dv.voters.includes(userId)) {
    return json({ type: 4, data: { content: "❌ Tu ne peux pas voter (éliminé ou non-joueur).", flags: 64 } });
  }

  if (Math.floor(Date.now() / 1000) > dv.deadline) {
    return json({ type: 4, data: { content: "⏰ Le temps de vote est écoulé!", flags: 64 } });
  }

  const customId: string = interaction.data?.custom_id || "";
  const token = env.DISCORD_BOT_TOKEN;

  if (customId.startsWith("day_skip_")) {
    dv.votes[userId] = "skip";
  } else {
    const targetId = customId.replace(`day_vote_${dv.gameNumber}_`, "");
    if (!dv.targets.find((t) => t.id === targetId)) {
      return json({ type: 4, data: { content: "❌ Cible invalide.", flags: 64 } });
    }
    dv.votes[userId] = targetId;
  }

  // Build updated voter lines
  const voterLines = dv.voters.map((id) => {
    const vote = dv.votes[id];
    const isBot = id.startsWith("bot_");
    const displayName = isBot ? `🤖 ${dv.targets.find((t) => t.id === id)?.name ?? id}` : `<@${id}>`;
    if (!vote) return `⬜ ${displayName} — *en attente...*`;
    if (vote === "skip") return `⏭️ ${displayName} — **Passe**`;
    const target = dv.targets.find((t) => t.id === vote);
    return `✅ ${displayName} — a voté pour **${target?.name ?? "?"}**`;
  });

  const allVoted = dv.voters.every((id) => dv.votes[id]);

  const updatedUrl = `https://garou.bot/dv/${encodeDayVoteState(dv)}`;
  const updatedEmbed = {
    title: `🗳️ Vote du village — Partie #${dv.gameNumber}`,
    url: updatedUrl,
    description: [
      "Votez pour éliminer un suspect, ou passez votre tour.",
      "",
      `⏰ Fin du vote: <t:${dv.deadline}:R>`,
      "",
      "━━━━━━━━━━━━━━━━━━━━",
      "",
      ...voterLines,
    ].join("\n"),
    color: EMBED_COLOR,
    image: { url: SCENE_IMAGES.day_elimination },
  };

  if (allVoted) {
    // Resolve immediately
    ctx.waitUntil(resolveDayVote(token, dv, ctx, env));
    return json({ type: 7, data: { embeds: [updatedEmbed], components: [] } });
  }

  return json({ type: 7, data: { embeds: [updatedEmbed], components: interaction.message.components } });
}

async function phaseDayVoteTimer(token: string, data: any, ctx: ExecutionContext, env: Env) {
  const { voteMessageId, gameChannelId } = data;
  if (!voteMessageId || !gameChannelId) return;
  console.log("[dayVoteTimer] Timeout triggered");

  // Check if already resolved (all users voted before timeout)
  const msg: any = await getMessage(token, gameChannelId, voteMessageId);
  if (!msg.components?.length) { console.log("[dayVoteTimer] Already resolved"); return; }
  const dv = parseDayVoteFromEmbed(msg);
  if (!dv) return;
  console.log("[dayVoteTimer] Deadline reached, resolving...");
  await editMessage(token, gameChannelId, voteMessageId, {
    embeds: msg.embeds,
    components: [],
  });
  await resolveDayVote(token, dv, ctx, env);
}

async function resolveDayVote(token: string, dv: DayVoteState, ctx: ExecutionContext, env: Env) {
  // Count votes (ignore "skip")
  const tally: Record<string, number> = {};
  for (const [, targetId] of Object.entries(dv.votes)) {
    if (targetId === "skip") continue;
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }

  const entries = Object.entries(tally);
  if (entries.length === 0) {
    // All skip or no votes
    await sendMessage(token, dv.gameChannelId, {
      embeds: [{
        title: "🗳️ Résultat du vote",
        description: "Le village n'a pas réussi à se mettre d'accord. **Personne n'est éliminé!**",
        color: EMBED_COLOR_GREEN,
      }],
    });
    await startNextNight(token, dv, ctx, env);
    return;
  }

  // Find max votes
  const maxVotes = Math.max(...entries.map(([, c]) => c));
  const winners = entries.filter(([, c]) => c === maxVotes);

  if (winners.length > 1) {
    // Tie — nobody dies
    const tiedNames = winners.map(([id]) => {
      const t = dv.targets.find((t) => t.id === id);
      return t ? `**${t.name}**` : `<@${id}>`;
    }).join(", ");
    await sendMessage(token, dv.gameChannelId, {
      embeds: [{
        title: "🗳️ Égalité!",
        description: [
          `Égalité entre ${tiedNames} (${maxVotes} voix chacun).`,
          "",
          "**Personne n'est éliminé!**",
        ].join("\n"),
        color: EMBED_COLOR_GREEN,
      }],
    });
    await startNextNight(token, dv, ctx, env);
    return;
  }

  // Clear winner — eliminate
  const eliminatedId = winners[0]![0];
  const eliminatedTarget = dv.targets.find((t) => t.id === eliminatedId);
  const eliminatedName = eliminatedTarget?.name ?? "?";
  const eliminatedRole = dv.allRoles?.[eliminatedId] ?? "villageois";
  const roleInfo = ROLES[eliminatedRole] ?? ROLES.villageois!;

  // Recover game state from lobby
  let game: GameState | null = null;
  try {
    const lobbyMsg: any = await getMessage(token, dv.gameChannelId, dv.lobbyMessageId);
    game = parseGameFromEmbed(lobbyMsg);
  } catch {}
  if (!game) return;
  if (!game.dead) game.dead = [];
  game.dead.push(eliminatedId);

  const isBot = eliminatedId.startsWith("bot_");

  // Set eliminated player as spectator (can view, can't send) — skip for bots
  if (!isBot) {
    try {
      await setChannelPermission(token, dv.gameChannelId, eliminatedId, {
        allow: String(1 << 10), deny: String(1 << 11), type: 1,
      });
    } catch {}
  } else {
    // Mark bot as dead in KV
    const bots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
    const bot = bots.find((b) => b.id === eliminatedId);
    if (bot) {
      bot.alive = false;
      await saveBots(env.ACTIVE_PLAYERS, game.gameNumber, bots);
    }
  }

  // Announce elimination with role reveal
  const eliminatedDisplay = isBot
    ? `🤖 **${eliminatedName}**`
    : `**${eliminatedName}** (<@${eliminatedId}>)`;
  await sendMessage(token, dv.gameChannelId, {
    embeds: [{
      title: "⚖️ Le village a rendu son verdict!",
      description: [
        `${eliminatedDisplay} a été éliminé(e) par le village!`,
        "",
        `${roleInfo.emoji} C'était **${roleInfo.name}**!`,
        "",
        `*${roleInfo.description}*`,
      ].join("\n"),
      color: EMBED_COLOR,
      thumbnail: { url: getRoleImage(eliminatedRole) },
      image: { url: SCENE_IMAGES.day_elimination },
    }],
  });

  // Couple death chain
  if (game.couple && game.couple.includes(eliminatedId)) {
    const partnerId = eliminatedId === game.couple[0] ? game.couple[1] : game.couple[0];
    if (!game.dead.includes(partnerId)) {
      game.dead.push(partnerId);
      const partnerIsBot = partnerId.startsWith("bot_");
      if (!partnerIsBot) {
        try {
          await setChannelPermission(token, dv.gameChannelId, partnerId, {
            allow: String(1 << 10), deny: String(1 << 11), type: 1,
          });
        } catch {}
      } else {
        const pBots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
        const pBot = pBots.find((b) => b.id === partnerId);
        if (pBot) { pBot.alive = false; await saveBots(env.ACTIVE_PLAYERS, game.gameNumber, pBots); }
      }
      let pName: string;
      if (partnerIsBot) {
        const pBots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
        pName = pBots.find((b) => b.id === partnerId)?.name ?? "?";
      } else {
        const pm: any = await getGuildMember(token, game.guildId, partnerId).catch(() => null);
        pName = pm?.nick || pm?.user?.global_name || pm?.user?.username || "?";
      }
      const partnerRole = game.roles?.[partnerId] ?? "villageois";
      const partnerRoleInfo = ROLES[partnerRole] ?? ROLES.villageois!;
      const partnerDisplay = partnerIsBot ? `🤖 **${pName}**` : `**${pName}** (<@${partnerId}>)`;
      await sendMessage(token, dv.gameChannelId, {
        embeds: [{
          title: "💔 Le couple est brisé...",
          description: [
            `${partnerDisplay} meurt de chagrin.`,
            "",
            `${partnerRoleInfo.emoji} C'était **${partnerRoleInfo.name}**!`,
          ].join("\n"),
          color: 0xe91e63,
        }],
      });
    }
  }

  // Append to game history
  await appendHistory(
    env.ACTIVE_PLAYERS,
    game.gameNumber,
    `Jour: ${eliminatedName} a été éliminé(e) par le village. ${roleInfo.name}.`,
  );

  // Check chasseur
  if (eliminatedRole === "chasseur") {
    // Persist state first
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
    await sleep(2000);
    await triggerChasseurShoot(token, game, eliminatedId, ctx, env);
    return;
  }

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

  // Check win conditions
  const winResult = checkWinCondition(game);
  if (winResult) {
    await sleep(2000);
    await announceVictory(token, game, winResult, env);
    return;
  }

  await sleep(3000);
  await sendMessage(token, game.gameChannelId, {
    embeds: [{
      title: "🌙 Le village se rendort...",
      description: "*Les villageois ferment les yeux...*\n*Le silence retombe sur le village...*",
      color: EMBED_COLOR_NIGHT,
      image: { url: SCENE_IMAGES.night_falls },
    }],
  });
  await dispatchPhase(token, "night_start", { game }, ctx, env);
}

async function startNextNight(token: string, dv: DayVoteState, ctx: ExecutionContext, env: Env) {
  // Recover game from lobby embed
  let game: GameState | null = null;
  try {
    const lobbyMsg: any = await getMessage(token, dv.gameChannelId, dv.lobbyMessageId);
    game = parseGameFromEmbed(lobbyMsg);
  } catch {}
  if (!game) return;

  // Check win conditions before starting next night
  const winResult = checkWinCondition(game);
  if (winResult) {
    await sleep(2000);
    await announceVictory(token, game, winResult, env);
    return;
  }

  // Send transition message
  await sendMessage(token, dv.gameChannelId, {
    embeds: [{
      title: "🌙 Le village se rendort...",
      description: "*Les villageois ferment les yeux...*\n*Le silence retombe sur le village...*",
      color: EMBED_COLOR_NIGHT,
      image: { url: SCENE_IMAGES.night_falls },
    }],
  });

  // Schedule next night via queue (fresh worker, guaranteed delivery)
  await schedulePhase(env, "night_start", { game }, 3);
}

// ── Wolf Vote (Night) ───────────────────────────────────────────────

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
            // All HUMAN players seen → trigger countdown + night
            const humansSeen = (verify.seen ?? []).filter((id: string) => !id.startsWith("bot_")).length;
            if (humansSeen >= verify.players.length) {
              const title: string = verifyMsg.embeds?.[0]?.title ?? "";
              if (title.includes("Découvrez vos rôles")) {
                // Mark title to prevent duplicate triggers from concurrent handlers
                try {
                  const embed = verifyMsg.embeds[0];
                  embed.title = `⏳ Lancement... — Partie #${verify.gameNumber}`;
                  await editMessage(token, channelId, lobbyId, { embeds: [embed], components: [] });
                } catch {}
                console.log(`[reveal] All ${verify.seen.length} seen, starting countdown`);
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

  if (game.players.length < 2) {
    return json({ type: 4, data: { content: "❌ Il faut au minimum 2 joueurs humains pour lancer.", flags: 64 } });
  }

  const token = env.DISCORD_BOT_TOKEN;

  // Auto-fill with bots if not enough total players
  const totalPlayers = game.players.length + (game.botCount ?? 0);
  if (totalPlayers < MIN_PLAYERS && game.players.length >= 2) {
    const needed = MIN_PLAYERS - game.players.length;
    const personalities = pickBots(needed);
    const bots: BotPlayer[] = personalities.map((p, i) => ({
      id: `bot_${i + 1}`,
      name: p.name,
      traits: p.traits,
      emoji: p.emoji,
      alive: true,
    }));
    game.botCount = bots.length;
    await saveBots(env.ACTIVE_PLAYERS, game.gameNumber, bots);
  }

  const totalWithBots = game.players.length + (game.botCount ?? 0);
  if (totalWithBots < MIN_PLAYERS) {
    return json({ type: 4, data: { content: `❌ Il faut au minimum ${MIN_PLAYERS} joueurs (humains + bots) pour lancer.`, flags: 64 } });
  }

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
    // Set worker URL for self-invocation (fresh 30s budget per HTTP call)
    env.WORKER_URL = new URL(req.url).origin;

    if (req.method !== "POST") {
      return new Response("🐺 Garou Interaction Server", { status: 200 });
    }

    // ── Internal phase calls (selfInvoke receives here — fresh worker with full budget) ──
    const internalToken = req.headers.get("X-Internal");
    if (internalToken === env.DISCORD_BOT_TOKEN) {
      const payload = await req.json() as any;
      const { phase } = payload;
      console.log(`[internal] ✅ Received selfInvoke for phase: ${phase}`);
      const token = env.DISCORD_BOT_TOKEN;
      ctx.waitUntil(dispatchPhase(token, phase, payload, ctx, env));
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

      if (customId.startsWith("voyante_see_")) return handleVoyanteSee(interaction, env, ctx);

      if (customId.startsWith("vote_kill_")) return handleVoteKill(interaction, env, ctx);

      if (customId.startsWith("cupidon_pick_")) return handleCupidonPick(interaction, env, ctx);
      if (customId.startsWith("cupidon_confirm_")) return handleCupidonConfirm(interaction, env, ctx);
      if (customId.startsWith("chasseur_shoot_")) return handleChasseurShoot(interaction, env, ctx);

      if (customId.startsWith("sorciere_life_")) return handleSorciereLife(interaction, env, ctx);
      if (customId.startsWith("sorciere_death_")) return handleSorciereDeath(interaction, env);
      if (customId.startsWith("sorciere_target_")) return handleSorciereTarget(interaction, env, ctx);
      if (customId.startsWith("sorciere_skip_")) return handleSorciereSkip(interaction, env, ctx);

      if (customId.startsWith("lb_kill_") || customId.startsWith("lb_skip_")) return handleLoupBlancKill(interaction, env, ctx);

      if (customId.startsWith("day_vote_") || customId.startsWith("day_skip_")) return handleDayVote(interaction, env, ctx);

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

  /** Queue consumer — each message gets a FRESH worker invocation with full CPU budget.
   *  Used for delayed phase dispatch (discussion timer, vote transitions, etc.) */
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const msg of batch.messages) {
      const payload = msg.body as any;
      const { phase } = payload;
      console.log(`[queue] ✅ Received delayed phase: ${phase}`);
      const token = env.DISCORD_BOT_TOKEN;
      try {
        await dispatchPhase(token, phase, payload, ctx, env);
      } catch (err) {
        console.error(`[queue] ❌ ${phase} FAILED:`, err);
      }
      msg.ack();
    }
  },
};
