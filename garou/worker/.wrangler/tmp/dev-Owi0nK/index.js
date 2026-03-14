var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.ts
var DISCORD_API = "https://discord.com/api/v10";
async function discordFetch(token, path, options = {}) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Discord API ${res.status} ${path}: ${text}`);
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}
__name(discordFetch, "discordFetch");
function sendMessage(token, channelId, body) {
  return discordFetch(token, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}
__name(sendMessage, "sendMessage");
function editMessage(token, channelId, messageId, body) {
  return discordFetch(token, `/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}
__name(editMessage, "editMessage");
function deleteMessage(token, channelId, messageId) {
  return discordFetch(token, `/channels/${channelId}/messages/${messageId}`, { method: "DELETE" });
}
__name(deleteMessage, "deleteMessage");
function createChannel(token, guildId, body) {
  return discordFetch(token, `/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}
__name(createChannel, "createChannel");
function deleteChannel(token, channelId) {
  return discordFetch(token, `/channels/${channelId}`, { method: "DELETE" });
}
__name(deleteChannel, "deleteChannel");
function getGuildChannels(token, guildId) {
  return discordFetch(token, `/guilds/${guildId}/channels`);
}
__name(getGuildChannels, "getGuildChannels");
function setChannelPermission(token, channelId, targetId, body) {
  return discordFetch(token, `/channels/${channelId}/permissions/${targetId}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}
__name(setChannelPermission, "setChannelPermission");
function deleteChannelPermission(token, channelId, targetId) {
  return discordFetch(token, `/channels/${channelId}/permissions/${targetId}`, { method: "DELETE" });
}
__name(deleteChannelPermission, "deleteChannelPermission");
function getGuildMember(token, guildId, userId) {
  return discordFetch(token, `/guilds/${guildId}/members/${userId}`);
}
__name(getGuildMember, "getGuildMember");
function getBotUser(token) {
  return discordFetch(token, "/users/@me");
}
__name(getBotUser, "getBotUser");
function editOriginalInteractionResponse(appId, interactionToken, body) {
  return fetch(`${DISCORD_API}/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
__name(editOriginalInteractionResponse, "editOriginalInteractionResponse");
var EMBED_COLOR = 9109504;
var EMBED_COLOR_GREEN = 3066993;
var EMBED_COLOR_ORANGE = 15105570;
var WEREWOLF_IMAGE = "https://i.imgur.com/JfOLPcY.png";
var MIN_PLAYERS = 4;
var MAX_PLAYERS = 20;
var ROLES = {
  loup: {
    name: "Loup-Garou",
    emoji: "\u{1F43A}",
    team: "loups",
    description: "Chaque nuit, \xE9liminez un villageois avec votre meute. Ne vous faites pas d\xE9masquer!"
  },
  sorciere: {
    name: "Sorci\xE8re",
    emoji: "\u{1F9EA}",
    team: "village",
    description: "Vous avez une potion de vie et une potion de mort. Utilisez-les avec sagesse."
  },
  cupidon: {
    name: "Cupidon",
    emoji: "\u{1F498}",
    team: "village",
    description: "Au d\xE9but de la partie, liez deux joueurs par l'amour. Si l'un meurt, l'autre aussi."
  },
  villageois: {
    name: "Villageois",
    emoji: "\u{1F9D1}\u200D\u{1F33E}",
    team: "village",
    description: "Trouvez et \xE9liminez les loups-garous lors des votes du village. Votre instinct est votre arme."
  }
};
function assignRoles(playerCount) {
  const roles = ["loup", "loup", "sorciere", "cupidon"];
  for (let i = roles.length; i < playerCount; i++) {
    roles.push("villageois");
  }
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return roles;
}
__name(assignRoles, "assignRoles");
function encodeState(game) {
  const compact = {
    g: game.gameNumber,
    c: game.creatorId,
    n: game.creatorName,
    gi: game.guildId,
    ch: game.gameChannelId,
    vc: game.voiceChannelId,
    m: game.maxPlayers,
    p: game.players,
    lm: game.lobbyMessageId,
    ac: game.announceChannelId,
    am: game.announceMessageId,
    wc: game.wolfChannelId
  };
  if (game.roles) compact.r = game.roles;
  if (game.seen?.length) compact.s = game.seen;
  return btoa(JSON.stringify(compact));
}
__name(encodeState, "encodeState");
function decodeState(url) {
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
      voiceChannelId: compact.vc,
      maxPlayers: compact.m,
      players: compact.p ?? [],
      lobbyMessageId: compact.lm,
      announceChannelId: compact.ac,
      announceMessageId: compact.am,
      wolfChannelId: compact.wc,
      roles: compact.r,
      seen: compact.s ?? []
    };
  } catch {
    return null;
  }
}
__name(decodeState, "decodeState");
function buildRoleCheckEmbed(game) {
  const seen = game.seen ?? [];
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;
  const playerLines = game.players.map((id) => {
    const checked = seen.includes(id);
    return `${checked ? "\u2705" : "\u2B1C"} <@${id}>`;
  });
  return {
    embeds: [{
      title: `\u{1F52E} D\xE9couvrez vos r\xF4les \u2014 Partie #${game.gameNumber}`,
      url: stateUrl,
      description: [
        "Cliquez sur le bouton pour d\xE9couvrir votre r\xF4le en **secret**.",
        "",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        "",
        ...playerLines,
        "",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        "",
        `\u2705 **${seen.length}/${game.players.length}** ont vu leur r\xF4le`
      ].join("\n"),
      color: EMBED_COLOR_PURPLE,
      thumbnail: { url: WEREWOLF_IMAGE },
      footer: { text: "\u{1F92B} Ne r\xE9v\xE8le ton r\xF4le \xE0 personne!" }
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 1,
        label: "\u{1F52E} Voir mon r\xF4le",
        custom_id: `reveal_role_${game.gameNumber}`
      }]
    }]
  };
}
__name(buildRoleCheckEmbed, "buildRoleCheckEmbed");
function progressBar(current, max) {
  return "\u{1F315}".repeat(current) + "\u{1F311}".repeat(max - current);
}
__name(progressBar, "progressBar");
function buildAnnounceEmbed(game) {
  const playerCount = game.players.length;
  const isFull = playerCount >= game.maxPlayers;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;
  const lines = [
    progressBar(playerCount, game.maxPlayers),
    `**${playerCount}/${game.maxPlayers}** joueurs`,
    ""
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
        title: `\u{1F43A} Partie de Loup-Garou #${game.gameNumber}`,
        url: stateUrl,
        description: lines.join("\n"),
        color: isFull ? EMBED_COLOR_GREEN : EMBED_COLOR,
        image: { url: WEREWOLF_IMAGE },
        footer: { text: `Cr\xE9\xE9e par ${game.creatorName}` },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    ],
    components: isFull ? [] : [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "\u{1F43A} Rejoindre la partie",
            custom_id: `join_game_${game.gameNumber}`
          }
        ]
      }
    ]
  };
}
__name(buildAnnounceEmbed, "buildAnnounceEmbed");
function buildLobbyEmbed(game, lastEvent) {
  const playerCount = game.players.length;
  const isFull = playerCount >= game.maxPlayers;
  const canStart = playerCount >= MIN_PLAYERS;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;
  const playerLines = game.players.map((id) => {
    const icon = id === game.creatorId ? "\u{1F451}" : "\u{1F43A}";
    return `${icon} <@${id}>`;
  });
  for (let i = playerCount; i < game.maxPlayers; i++) {
    playerLines.push("\u2B1C *En attente...*");
  }
  const statusEmoji = isFull ? "\u{1F7E2}" : canStart ? "\u{1F7E1}" : "\u{1F534}";
  const statusText = isFull ? "La partie est pleine! Pr\xEAt \xE0 lancer." : canStart ? "Pr\xEAt \xE0 lancer ou en attente de joueurs..." : `En attente de joueurs (min. ${MIN_PLAYERS})`;
  const lines = [
    progressBar(playerCount, game.maxPlayers),
    `${statusEmoji} **${playerCount}/${game.maxPlayers}** \u2014 ${statusText}`,
    "",
    "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
    "",
    ...playerLines
  ];
  if (lastEvent) {
    lines.push("", "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501", "", `\u{1F4CB} *${lastEvent}*`);
  }
  const buttons = [];
  if (canStart) {
    buttons.push({
      type: 2,
      style: 3,
      label: "\u25B6\uFE0F Lancer la partie",
      custom_id: `start_game_${game.gameNumber}`
    });
  }
  buttons.push({
    type: 2,
    style: 4,
    label: "\u{1F6AA} Quitter la partie",
    custom_id: `quit_game_${game.gameNumber}`
  });
  return {
    embeds: [
      {
        title: `\u{1F43A} Salle d'attente \u2014 Partie #${game.gameNumber}`,
        url: stateUrl,
        description: lines.join("\n"),
        color: canStart ? isFull ? EMBED_COLOR_GREEN : EMBED_COLOR_ORANGE : EMBED_COLOR,
        thumbnail: { url: WEREWOLF_IMAGE },
        footer: { text: `Cr\xE9\xE9e par ${game.creatorName}` },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    ],
    components: [{ type: 1, components: buttons }]
  };
}
__name(buildLobbyEmbed, "buildLobbyEmbed");
function parseGameFromEmbed(message) {
  const embed = message.embeds?.[0];
  if (!embed?.url) return null;
  return decodeState(embed.url);
}
__name(parseGameFromEmbed, "parseGameFromEmbed");
function hexToUint8(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
__name(hexToUint8, "hexToUint8");
async function verifySignature(body, signature, timestamp, publicKey) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToUint8(publicKey),
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["verify"]
    );
    const msg = new TextEncoder().encode(timestamp + body);
    return await crypto.subtle.verify("Ed25519", key, hexToUint8(signature), msg);
  } catch {
    return false;
  }
}
__name(verifySignature, "verifySignature");
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json, "json");
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
__name(sleep, "sleep");
function getMessage(token, channelId, messageId) {
  return discordFetch(token, `/channels/${channelId}/messages/${messageId}`);
}
__name(getMessage, "getMessage");
var VOICE_SERVICE_TIMEOUT_MS = 1e4;
async function triggerStartSound(env, game) {
  if (!env.VOICE_SERVICE_URL || !game.voiceChannelId) {
    if (!env.VOICE_SERVICE_URL) {
      console.log("[garou] Voice service skipped: VOICE_SERVICE_URL not set");
    }
    return;
  }
  const endpoint = `${env.VOICE_SERVICE_URL.replace(/\/+$/, "")}/play-start-sfx`;
  const headers = { "Content-Type": "application/json" };
  if (env.VOICE_SERVICE_TOKEN) {
    headers.Authorization = `Bearer ${env.VOICE_SERVICE_TOKEN}`;
  }
  console.log(
    `[garou] Triggering start sound: guildId=${game.guildId} voiceChannelId=${game.voiceChannelId} endpoint=${endpoint}`
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VOICE_SERVICE_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        guildId: game.guildId,
        voiceChannelId: game.voiceChannelId,
        gameNumber: game.gameNumber
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const body = await res.text();
      console.error(`[garou] Voice service error ${res.status}: ${body}`);
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data.skipped) {
      console.log("[garou] Voice service skipped playback (e.g. no one in voice channel)");
    } else {
      console.log("[garou] Start sound played successfully");
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("abort")) {
      console.error("[garou] Voice service timeout: request took longer than", VOICE_SERVICE_TIMEOUT_MS, "ms");
    } else {
      console.error("[garou] Voice service unreachable:", err);
    }
  }
}
__name(triggerStartSound, "triggerStartSound");
async function findOrCreateCategory(token, guildId) {
  const channels = await getGuildChannels(token, guildId);
  const existing = channels.find(
    (c) => c.type === 4 && c.name.toLowerCase() === "loup-garou"
  );
  if (existing) return existing.id;
  const created = await createChannel(token, guildId, { name: "Loup-Garou", type: 4 });
  return created.id;
}
__name(findOrCreateCategory, "findOrCreateCategory");
async function getNextGameNumber(token, guildId, categoryId) {
  const channels = await getGuildChannels(token, guildId);
  const gameChannels = channels.filter(
    (c) => c.parent_id === categoryId && c.name.startsWith("partie-")
  );
  return gameChannels.length + 1;
}
__name(getNextGameNumber, "getNextGameNumber");
async function updateAllEmbeds(token, game, lastEvent) {
  const promises = [];
  if (game.lobbyMessageId) {
    promises.push(editMessage(token, game.gameChannelId, game.lobbyMessageId, buildLobbyEmbed(game, lastEvent)));
  }
  if (game.announceChannelId && game.announceMessageId) {
    promises.push(editMessage(token, game.announceChannelId, game.announceMessageId, buildAnnounceEmbed(game)));
  }
  await Promise.all(promises);
}
__name(updateAllEmbeds, "updateAllEmbeds");
async function handleSlashCommand(interaction, env) {
  const token = env.DISCORD_BOT_TOKEN;
  const appId = interaction.application_id;
  const interactionToken = interaction.token;
  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  const userId = interaction.member?.user?.id;
  if (!guildId || !channelId || !userId) {
    return json({ type: 4, data: { content: "\u274C Cette commande ne fonctionne que dans un serveur Discord.", flags: 64 } });
  }
  const maxPlayers = interaction.data?.options?.find((o) => o.name === "joueurs")?.value;
  if (!maxPlayers || maxPlayers < MIN_PLAYERS || maxPlayers > MAX_PLAYERS) {
    return json({ type: 4, data: { content: `\u274C Le nombre de joueurs doit \xEAtre entre ${MIN_PLAYERS} et ${MAX_PLAYERS}.`, flags: 64 } });
  }
  const deferredResponse = json({ type: 5 });
  const backgroundWork = (async () => {
    try {
      const member = await getGuildMember(token, guildId, userId);
      const creatorName = member.nick || member.user.global_name || member.user.username;
      const categoryId = await findOrCreateCategory(token, guildId);
      const gameNumber = await getNextGameNumber(token, guildId, categoryId);
      const botUser = await getBotUser(token);
      const gameChannel = await createChannel(token, guildId, {
        name: `partie-${gameNumber}`,
        type: 0,
        parent_id: categoryId,
        permission_overwrites: [
          { id: guildId, type: 0, deny: String(1 << 10) },
          { id: botUser.id, type: 1, allow: String(1 << 10 | 1 << 11 | 1 << 14 | 1 << 15) },
          { id: userId, type: 1, allow: String(1 << 10) }
        ]
      });
      const voiceChannel = await createChannel(token, guildId, {
        name: `vocal-partie-${gameNumber}`,
        type: 2,
        parent_id: categoryId,
        permission_overwrites: [
          { id: guildId, type: 0, deny: String(1 << 10) },
          {
            id: botUser.id,
            type: 1,
            allow: String(1 << 10 | 1 << 20 | 1 << 21)
          },
          {
            id: userId,
            type: 1,
            allow: String(1 << 10 | 1 << 20)
          }
        ]
      });
      const gameState = {
        gameNumber,
        creatorId: userId,
        creatorName,
        guildId,
        gameChannelId: gameChannel.id,
        voiceChannelId: voiceChannel.id,
        maxPlayers,
        players: [userId],
        announceChannelId: channelId
      };
      const lobbyMsg = await sendMessage(token, gameChannel.id, buildLobbyEmbed(gameState));
      gameState.lobbyMessageId = lobbyMsg.id;
      await editOriginalInteractionResponse(appId, interactionToken, buildAnnounceEmbed(gameState));
      const origRes = await fetch(
        `${DISCORD_API}/webhooks/${appId}/${interactionToken}/messages/@original`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (origRes.ok) {
        const origMsg = await origRes.json();
        gameState.announceMessageId = origMsg.id;
      }
      await updateAllEmbeds(token, gameState);
    } catch (err) {
      console.error("Error in /loupgarou handler:", err);
      try {
        await editOriginalInteractionResponse(appId, interactionToken, {
          content: "\u274C Une erreur est survenue lors de la cr\xE9ation de la partie."
        });
      } catch {
      }
    }
  })();
  globalThis.__backgroundWork = backgroundWork;
  return deferredResponse;
}
__name(handleSlashCommand, "handleSlashCommand");
async function handleJoin(interaction, env, ctx) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "\u274C Erreur: utilisateur introuvable.", flags: 64 } });
  const game = parseGameFromEmbed(interaction.message);
  if (!game) return json({ type: 4, data: { content: "\u274C Erreur: partie introuvable.", flags: 64 } });
  if (game.players.includes(userId)) return json({ type: 4, data: { content: "\u274C Tu es d\xE9j\xE0 dans cette partie!", flags: 64 } });
  if (game.players.length >= game.maxPlayers) return json({ type: 4, data: { content: "\u274C La partie est pleine!", flags: 64 } });
  const token = env.DISCORD_BOT_TOKEN;
  game.players.push(userId);
  await setChannelPermission(token, game.gameChannelId, userId, {
    allow: String(1 << 10),
    deny: String(1 << 11),
    type: 1
  });
  if (game.voiceChannelId) {
    await setChannelPermission(token, game.voiceChannelId, userId, {
      allow: String(1 << 10 | 1 << 20),
      type: 1
    });
  }
  const member = await getGuildMember(token, game.guildId, userId);
  const playerName = member.nick || member.user.global_name || member.user.username;
  await updateAllEmbeds(token, game, `${playerName} a rejoint la partie`);
  if (game.players.length >= game.maxPlayers) {
    ctx.waitUntil(runCountdown(token, game, env));
  }
  return json({
    type: 4,
    data: {
      content: `\u2705 Tu as rejoint la Partie #${game.gameNumber}!`,
      flags: 64,
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: "\u{1F43A} Aller au salon", url: `https://discord.com/channels/${game.guildId}/${game.gameChannelId}` },
            ...game.voiceChannelId ? [{ type: 2, style: 5, label: "\u{1F50A} Rejoindre le vocal", url: `https://discord.com/channels/${game.guildId}/${game.voiceChannelId}` }] : []
          ]
        }
      ]
    }
  });
}
__name(handleJoin, "handleJoin");
async function handleQuit(interaction, env) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "\u274C Erreur: utilisateur introuvable.", flags: 64 } });
  const game = parseGameFromEmbed(interaction.message);
  if (!game) return json({ type: 4, data: { content: "\u274C Erreur: partie introuvable.", flags: 64 } });
  if (!game.players.includes(userId)) return json({ type: 4, data: { content: "\u274C Tu n'es pas dans cette partie.", flags: 64 } });
  const token = env.DISCORD_BOT_TOKEN;
  game.players = game.players.filter((id) => id !== userId);
  try {
    await deleteChannelPermission(token, game.gameChannelId, userId);
  } catch {
  }
  if (game.voiceChannelId) {
    try {
      await deleteChannelPermission(token, game.voiceChannelId, userId);
    } catch {
    }
  }
  const member = await getGuildMember(token, game.guildId, userId);
  const playerName = member.nick || member.user.global_name || member.user.username;
  if (game.players.length === 0) {
    try {
      await deleteChannel(token, game.gameChannelId);
    } catch {
    }
    if (game.voiceChannelId) {
      try {
        await deleteChannel(token, game.voiceChannelId);
      } catch {
      }
    }
    if (game.wolfChannelId) {
      try {
        await deleteChannel(token, game.wolfChannelId);
      } catch {
      }
    }
    if (game.announceChannelId && game.announceMessageId) {
      try {
        await deleteMessage(token, game.announceChannelId, game.announceMessageId);
      } catch {
      }
    }
    return json({ type: 4, data: { content: `\u{1F5D1}\uFE0F La Partie #${game.gameNumber} a \xE9t\xE9 supprim\xE9e (plus aucun joueur).`, flags: 64 } });
  }
  let lastEvent;
  if (userId === game.creatorId) {
    const newCreatorId = game.players[Math.floor(Math.random() * game.players.length)];
    game.creatorId = newCreatorId;
    const newCreatorMember = await getGuildMember(token, game.guildId, newCreatorId);
    game.creatorName = newCreatorMember.nick || newCreatorMember.user.global_name || newCreatorMember.user.username;
    lastEvent = `${playerName} a quitt\xE9 \u2014 ${game.creatorName} est le nouveau cr\xE9ateur`;
  } else {
    lastEvent = `${playerName} a quitt\xE9 la partie`;
  }
  await updateAllEmbeds(token, game, lastEvent);
  return json({ type: 4, data: { content: `\u{1F6AA} Tu as quitt\xE9 la Partie #${game.gameNumber}.`, flags: 64 } });
}
__name(handleQuit, "handleQuit");
var COUNTDOWN_SECONDS = 30;
var EMBED_COLOR_NIGHT = 858922;
var EMBED_COLOR_PURPLE = 7091331;
async function startGame(token, game, env) {
  if (!game.lobbyMessageId) return;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;
  await triggerStartSound(env, game);
  await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
    embeds: [
      {
        title: "\u{1F311} La nuit tombe sur le village...",
        url: stateUrl,
        description: [
          "",
          "```",
          "     \u{1F315}",
          "   \xB7  \u2726  \xB7  \u2727  \xB7",
          " \u2727    \xB7    \u2726    \xB7",
          "   \xB7  \u2726  \xB7  \u2727  \xB7",
          "  \u{1F332}\u{1F332}\u{1F332}\u{1F332}\u{1F332}\u{1F332}\u{1F332}\u{1F332}",
          "```",
          "",
          "*Les villageois s'endorment...*",
          "*Quelque chose r\xF4de dans l'ombre...*"
        ].join("\n"),
        color: EMBED_COLOR_NIGHT,
        image: { url: WEREWOLF_IMAGE }
      }
    ],
    components: []
  });
  await sleep(3e3);
  await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
    embeds: [
      {
        title: "\u{1F0CF} Le destin se r\xE9v\xE8le...",
        url: stateUrl,
        description: [
          "",
          "```",
          " \u250C\u2500\u2500\u2500\u2500\u2500\u2510 \u250C\u2500\u2500\u2500\u2500\u2500\u2510 \u250C\u2500\u2500\u2500\u2500\u2500\u2510 \u250C\u2500\u2500\u2500\u2500\u2500\u2510",
          " \u2502 \u{1F43A}  \u2502 \u2502 \u{1F9EA}  \u2502 \u2502 \u{1F498}  \u2502 \u2502  ?  \u2502",
          " \u2502     \u2502 \u2502     \u2502 \u2502     \u2502 \u2502     \u2502",
          " \u2502 ??? \u2502 \u2502 ??? \u2502 \u2502 ??? \u2502 \u2502 ??? \u2502",
          " \u2514\u2500\u2500\u2500\u2500\u2500\u2518 \u2514\u2500\u2500\u2500\u2500\u2500\u2518 \u2514\u2500\u2500\u2500\u2500\u2500\u2518 \u2514\u2500\u2500\u2500\u2500\u2500\u2518",
          "```",
          "",
          `**${game.players.length} cartes** sont distribu\xE9es face cach\xE9e...`,
          "",
          "*Chaque joueur re\xE7oit son destin en message priv\xE9.*"
        ].join("\n"),
        color: EMBED_COLOR_PURPLE
      }
    ],
    components: []
  });
  const roleKeys = assignRoles(game.players.length);
  const rolesMap = {};
  game.players.forEach((id, i) => {
    rolesMap[id] = roleKeys[i];
  });
  game.roles = rolesMap;
  const playerRoles = game.players.map((id) => ({ id, roleKey: rolesMap[id], role: ROLES[rolesMap[id]] }));
  const wolfPlayerIds = playerRoles.filter((p) => p.role.team === "loups").map((p) => p.id);
  const botUser = await getBotUser(token);
  const categoryId = await findOrCreateCategory(token, game.guildId);
  const wolfChannel = await createChannel(token, game.guildId, {
    name: `taniere-partie-${game.gameNumber}`,
    type: 0,
    parent_id: categoryId,
    topic: `\u{1F43A} Canal secret des Loups-Garous \u2014 Partie #${game.gameNumber}`,
    permission_overwrites: [
      { id: game.guildId, type: 0, deny: String(1 << 10) },
      { id: botUser.id, type: 1, allow: String(1 << 10 | 1 << 11 | 1 << 14 | 1 << 15) },
      ...wolfPlayerIds.map((id) => ({
        id,
        type: 1,
        allow: String(1 << 10),
        // VIEW_CHANNEL only — read-only until night vote
        deny: String(1 << 11)
        // deny SEND_MESSAGES
      }))
    ]
  });
  game.wolfChannelId = wolfChannel.id;
  await sendMessage(token, wolfChannel.id, {
    embeds: [
      {
        title: "\u{1F43A} Bienvenue dans la Tani\xE8re",
        description: [
          "```",
          "  \u{1F311}  Canal secret des Loups-Garous",
          "  \u{1F441}\uFE0F  Invisible aux villageois",
          "```",
          "",
          "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
          "",
          ...wolfPlayerIds.map((id) => `\u{1F43A} <@${id}>`),
          "",
          "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
          "",
          "Complotez ici en toute discr\xE9tion.",
          "Personne d'autre ne peut voir ce canal.",
          "",
          `*Choisissez votre victime pour la nuit...*`
        ].join("\n"),
        color: EMBED_COLOR_NIGHT,
        image: { url: WEREWOLF_IMAGE },
        footer: { text: `Partie #${game.gameNumber} \u2014 Les villageois dorment` },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    ]
  });
  await sleep(3e3);
  game.seen = [];
  await editMessage(token, game.gameChannelId, game.lobbyMessageId, buildRoleCheckEmbed(game));
  if (game.announceChannelId && game.announceMessageId) {
    await editMessage(token, game.announceChannelId, game.announceMessageId, {
      embeds: [{
        title: `\u{1F3AE} Partie #${game.gameNumber} \u2014 En cours!`,
        url: `https://garou.bot/s/${encodeState(game)}`,
        description: [`Lanc\xE9e par <@${game.creatorId}>`, "", `**${game.players.length} joueurs** \u2014 Les r\xF4les sont distribu\xE9s!`].join("\n"),
        color: EMBED_COLOR_GREEN,
        image: { url: WEREWOLF_IMAGE },
        footer: { text: "La partie est en cours!" }
      }],
      components: []
    });
  }
  const roleCheckEnd = Date.now() + ROLE_CHECK_TIMEOUT * 1e3;
  while (Date.now() < roleCheckEnd) {
    await sleep(5e3);
    try {
      const msg = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
      const current = parseGameFromEmbed(msg);
      if (current?.seen?.length === game.players.length) break;
    } catch {
      break;
    }
  }
  await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
    embeds: [{
      title: `\u23F3 La partie d\xE9bute dans ${GAME_START_DELAY}s \u2014 Partie #${game.gameNumber}`,
      url: `https://garou.bot/s/${encodeState(game)}`,
      description: [
        "\u2705 Les r\xF4les ont \xE9t\xE9 distribu\xE9s!",
        "",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        "",
        ...game.players.map((id) => `\u{1F3AD} <@${id}>`),
        "",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        "",
        "\u{1F43A} La premi\xE8re nuit arrive bient\xF4t...",
        "",
        "*Pr\xE9parez-vous...*"
      ].join("\n"),
      color: EMBED_COLOR_ORANGE,
      thumbnail: { url: WEREWOLF_IMAGE },
      footer: { text: "\u{1F92B} Ne r\xE9v\xE8le ton r\xF4le \xE0 personne!" }
    }],
    components: []
  });
  await sleep(GAME_START_DELAY * 1e3);
  await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
    embeds: [{
      title: `\u{1F311} La nuit tombe \u2014 Partie #${game.gameNumber}`,
      url: `https://garou.bot/s/${encodeState(game)}`,
      description: [
        "*Les villageois s'endorment...*",
        "*Les loups-garous ouvrent les yeux.* \u{1F43A}",
        "",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        "",
        ...game.players.map((id) => `\u{1F3AD} <@${id}>`),
        "",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501"
      ].join("\n"),
      color: EMBED_COLOR_NIGHT,
      thumbnail: { url: WEREWOLF_IMAGE }
    }],
    components: []
  });
  await startNightPhase(token, game);
}
__name(startGame, "startGame");
function isGameStarted(title) {
  return title.includes("La nuit tombe") || title.includes("La chasse commence") || title.includes("Le destin");
}
__name(isGameStarted, "isGameStarted");
async function runCountdown(token, game, env) {
  if (!game.lobbyMessageId) return;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;
  for (let remaining = COUNTDOWN_SECONDS; remaining >= 0; remaining--) {
    try {
      const msg = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
      const title = msg.embeds?.[0]?.title ?? "";
      if (isGameStarted(title)) return;
      const currentGame = parseGameFromEmbed(msg);
      if (!currentGame || currentGame.players.length < currentGame.maxPlayers) return;
    } catch {
      return;
    }
    if (remaining === 0) break;
    if (remaining <= 5 || remaining % 5 === 0) {
      const filled = Math.round(remaining / COUNTDOWN_SECONDS * 20);
      const bar = "\u2593".repeat(filled) + "\u2591".repeat(20 - filled);
      try {
        await editMessage(token, game.gameChannelId, game.lobbyMessageId, {
          embeds: [
            {
              title: `\u23F3 La partie commence dans ${remaining}s...`,
              url: stateUrl,
              description: [
                "",
                `\`${bar}\` **${remaining}s**`,
                "",
                "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
                "",
                ...game.players.map((id) => {
                  const icon = id === game.creatorId ? "\u{1F451}" : "\u{1F43A}";
                  return `${icon} <@${id}>`;
                }),
                "",
                "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
                "",
                `\u{1F7E2} **${game.players.length}/${game.maxPlayers}** \u2014 Tous les joueurs sont pr\xEAts!`
              ].join("\n"),
              color: EMBED_COLOR_ORANGE,
              thumbnail: { url: WEREWOLF_IMAGE },
              footer: { text: `\u{1F451} Le cr\xE9ateur peut lancer imm\xE9diatement` }
            }
          ],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 3,
                  label: `\u23E9 Commencer maintenant`,
                  custom_id: `skip_countdown_${game.gameNumber}`
                },
                {
                  type: 2,
                  style: 4,
                  label: "\u{1F6AA} Quitter la partie",
                  custom_id: `quit_game_${game.gameNumber}`
                }
              ]
            }
          ]
        });
      } catch (err) {
        console.error("Countdown edit failed:", err);
      }
    }
    await sleep(1e3);
  }
  try {
    const msg = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
    const title = msg.embeds?.[0]?.title ?? "";
    if (isGameStarted(title)) return;
    const currentGame = parseGameFromEmbed(msg);
    if (!currentGame || currentGame.players.length < MIN_PLAYERS) return;
    await startGame(token, currentGame, env);
  } catch (err) {
    console.error("Countdown auto-start failed:", err);
  }
}
__name(runCountdown, "runCountdown");
var NIGHT_VOTE_SECONDS = 90;
var ROLE_CHECK_TIMEOUT = 120;
var GAME_START_DELAY = 10;
function encodeVoteState(vote) {
  return btoa(JSON.stringify({
    g: vote.gameNumber,
    gi: vote.guildId,
    gc: vote.gameChannelId,
    wc: vote.wolfChannelId,
    lm: vote.lobbyMessageId,
    w: vote.wolves,
    t: vote.targets.map((t) => [t.id, t.name]),
    v: vote.votes,
    dl: vote.deadline
  }));
}
__name(encodeVoteState, "encodeVoteState");
function decodeVoteState(url) {
  try {
    const b64 = url.split("/v/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g,
      guildId: c.gi,
      gameChannelId: c.gc,
      wolfChannelId: c.wc,
      lobbyMessageId: c.lm,
      wolves: c.w,
      targets: c.t.map(([id, name]) => ({ id, name })),
      votes: c.v ?? {},
      deadline: c.dl
    };
  } catch {
    return null;
  }
}
__name(decodeVoteState, "decodeVoteState");
function parseVoteFromEmbed(message) {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/v/")) return null;
  return decodeVoteState(embed.url);
}
__name(parseVoteFromEmbed, "parseVoteFromEmbed");
function buildVoteEmbed(vote) {
  const stateUrl = `https://garou.bot/v/${encodeVoteState(vote)}`;
  const voteLines = vote.wolves.map((wId) => {
    const targetId = vote.votes[wId];
    const target = targetId ? vote.targets.find((t) => t.id === targetId) : null;
    return `\u{1F43A} <@${wId}> \u2192 ${target ? `**${target.name}**` : "*(en attente...)*"}`;
  });
  const buttonRows = [];
  let currentRow = [];
  for (const target of vote.targets) {
    const voteCount = Object.values(vote.votes).filter((v) => v === target.id).length;
    currentRow.push({
      type: 2,
      style: voteCount > 0 ? 4 : 2,
      label: `${voteCount > 0 ? "\u{1F3AF} " : ""}${target.name}`,
      custom_id: `vote_kill_${vote.gameNumber}_${target.id}`
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
      title: `\u{1F43A} Vote de la Nuit \u2014 Partie #${vote.gameNumber}`,
      url: stateUrl,
      description: [
        "**Qui les loups veulent-ils d\xE9vorer cette nuit?**",
        "",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        "",
        ...voteLines,
        "",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        "",
        `\u23F0 Fin du vote <t:${vote.deadline}:R>`,
        "",
        "*Vote unanime = r\xE9solution imm\xE9diate*"
      ].join("\n"),
      color: EMBED_COLOR_NIGHT,
      thumbnail: { url: WEREWOLF_IMAGE }
    }],
    components: buttonRows
  };
}
__name(buildVoteEmbed, "buildVoteEmbed");
async function startNightPhase(token, game) {
  if (!game.wolfChannelId || !game.roles) return;
  const wolfIds = Object.entries(game.roles).filter(([_, r]) => r === "loup").map(([id]) => id);
  const targetIds = game.players.filter((id) => !wolfIds.includes(id));
  const targets = await Promise.all(
    targetIds.map(async (id) => {
      const member = await getGuildMember(token, game.guildId, id);
      return { id, name: member.nick || member.user.global_name || member.user.username };
    })
  );
  const deadline = Math.floor(Date.now() / 1e3) + NIGHT_VOTE_SECONDS;
  const voteState = {
    gameNumber: game.gameNumber,
    guildId: game.guildId,
    gameChannelId: game.gameChannelId,
    wolfChannelId: game.wolfChannelId,
    lobbyMessageId: game.lobbyMessageId,
    wolves: wolfIds,
    targets,
    votes: {},
    deadline
  };
  for (const wolfId of wolfIds) {
    try {
      await setChannelPermission(token, game.wolfChannelId, wolfId, {
        allow: String(1 << 10 | 1 << 11),
        // VIEW + SEND
        deny: String(0),
        // clear deny
        type: 1
      });
    } catch {
    }
  }
  await sendMessage(token, game.gameChannelId, {
    embeds: [{
      title: "\u{1F311} La nuit tombe sur le village...",
      description: [
        "*Les villageois s'endorment...*",
        "*Les loups-garous ouvrent les yeux.*",
        "",
        `\u23F0 Les loups ont **${NIGHT_VOTE_SECONDS} secondes** pour choisir leur victime.`
      ].join("\n"),
      color: EMBED_COLOR_NIGHT,
      thumbnail: { url: WEREWOLF_IMAGE }
    }]
  });
  const wolfMentions = wolfIds.map((id) => `<@${id}>`).join(" ");
  await sendMessage(token, game.wolfChannelId, {
    content: `${wolfMentions}

\u{1F319} **La nuit est tomb\xE9e!** Choisissez votre victime ci-dessous.`
  });
  const voteMsg = await sendMessage(token, game.wolfChannelId, buildVoteEmbed(voteState));
  await sleep(NIGHT_VOTE_SECONDS * 1e3);
  try {
    const currentMsg = await getMessage(token, game.wolfChannelId, voteMsg.id);
    if (!currentMsg.components?.length) return;
    const currentVote = parseVoteFromEmbed(currentMsg);
    if (!currentVote) return;
    await resolveNightVote(token, currentVote, voteMsg.id);
  } catch (err) {
    console.error("Night auto-resolve failed:", err);
  }
}
__name(startNightPhase, "startNightPhase");
async function resolveNightVote(token, vote, voteMessageId) {
  try {
    const check = await getMessage(token, vote.wolfChannelId, voteMessageId);
    if (!check.components?.length) return;
  } catch {
    return;
  }
  const voteCounts = {};
  for (const targetId of Object.values(vote.votes)) {
    voteCounts[targetId] = (voteCounts[targetId] ?? 0) + 1;
  }
  let victimId;
  const entries = Object.entries(voteCounts);
  if (entries.length === 0) {
    victimId = vote.targets[Math.floor(Math.random() * vote.targets.length)].id;
  } else {
    const maxVotes = Math.max(...entries.map(([_, c]) => c));
    const topTargets = entries.filter(([_, c]) => c === maxVotes).map(([id]) => id);
    victimId = topTargets.length === 1 ? topTargets[0] : topTargets[Math.floor(Math.random() * topTargets.length)];
  }
  const victim = vote.targets.find((t) => t.id === victimId);
  const stateUrl = `https://garou.bot/v/${encodeVoteState(vote)}`;
  await editMessage(token, vote.wolfChannelId, voteMessageId, {
    embeds: [{
      title: `\u2620\uFE0F La meute a choisi \u2014 Partie #${vote.gameNumber}`,
      url: stateUrl,
      description: [
        `**${victim.name}** (<@${victim.id}>) sera d\xE9vor\xE9(e) cette nuit.`,
        "",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        "",
        ...vote.wolves.map((wId) => {
          const targetId = vote.votes[wId];
          const target = targetId ? vote.targets.find((t) => t.id === targetId) : null;
          return `\u{1F43A} <@${wId}> \u2192 ${target ? target.name : "*(pas vot\xE9)*"}`;
        }),
        "",
        "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
        "",
        "*\u{1F512} Canal en lecture seule jusqu'\xE0 la prochaine nuit.*"
      ].join("\n"),
      color: EMBED_COLOR,
      thumbnail: { url: WEREWOLF_IMAGE }
    }],
    components: []
  });
  for (const wolfId of vote.wolves) {
    try {
      await setChannelPermission(token, vote.wolfChannelId, wolfId, {
        allow: String(1 << 10),
        deny: String(1 << 11),
        type: 1
      });
    } catch {
    }
  }
  await sendMessage(token, vote.gameChannelId, {
    embeds: [{
      title: "\u2600\uFE0F Le jour se l\xE8ve...",
      description: [
        `Les villageois d\xE9couvrent avec horreur que **${victim.name}** (<@${victim.id}>) a \xE9t\xE9 d\xE9vor\xE9(e) par les loups-garous cette nuit.`,
        "",
        "*Un moment de silence pour la victime...*"
      ].join("\n"),
      color: EMBED_COLOR,
      image: { url: WEREWOLF_IMAGE }
    }]
  });
}
__name(resolveNightVote, "resolveNightVote");
async function handleVoteKill(interaction, env) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "\u274C Erreur: utilisateur introuvable.", flags: 64 } });
  const vote = parseVoteFromEmbed(interaction.message);
  if (!vote) return json({ type: 4, data: { content: "\u274C Erreur: vote introuvable.", flags: 64 } });
  if (!vote.wolves.includes(userId)) {
    return json({ type: 4, data: { content: "\u274C Seuls les loups-garous peuvent voter.", flags: 64 } });
  }
  if (Math.floor(Date.now() / 1e3) > vote.deadline) {
    return json({ type: 4, data: { content: "\u23F0 Le temps de vote est \xE9coul\xE9!", flags: 64 } });
  }
  const customId = interaction.data?.custom_id || "";
  const targetId = customId.replace(`vote_kill_${vote.gameNumber}_`, "");
  const target = vote.targets.find((t) => t.id === targetId);
  if (!target) return json({ type: 4, data: { content: "\u274C Cible invalide.", flags: 64 } });
  vote.votes[userId] = targetId;
  const allVoted = vote.wolves.every((wId) => vote.votes[wId]);
  const allSameTarget = allVoted && new Set(Object.values(vote.votes)).size === 1;
  if (allSameTarget) {
    const token = env.DISCORD_BOT_TOKEN;
    globalThis.__backgroundWork = resolveNightVote(token, vote, interaction.message.id);
    return json({ type: 7, data: buildVoteEmbed(vote) });
  }
  return json({ type: 7, data: buildVoteEmbed(vote) });
}
__name(handleVoteKill, "handleVoteKill");
async function handleRevealRole(interaction, env) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "\u274C Erreur: utilisateur introuvable.", flags: 64 } });
  const game = parseGameFromEmbed(interaction.message);
  if (!game) return json({ type: 4, data: { content: "\u274C Erreur: partie introuvable.", flags: 64 } });
  if (!game.roles) return json({ type: 4, data: { content: "\u274C Les r\xF4les n'ont pas encore \xE9t\xE9 distribu\xE9s.", flags: 64 } });
  if (!game.players.includes(userId)) {
    return json({ type: 4, data: { content: "\u274C Tu ne fais pas partie de cette partie.", flags: 64 } });
  }
  const roleKey = game.roles[userId];
  if (!roleKey) return json({ type: 4, data: { content: "\u274C Aucun r\xF4le trouv\xE9 pour toi.", flags: 64 } });
  const role = ROLES[roleKey];
  const token = env.DISCORD_BOT_TOKEN;
  if (game.lobbyMessageId) {
    try {
      const latestMsg = await getMessage(token, game.gameChannelId, game.lobbyMessageId);
      const latest = parseGameFromEmbed(latestMsg);
      if (latest) game.seen = latest.seen ?? [];
    } catch {
    }
  }
  if (!game.seen) game.seen = [];
  if (!game.seen.includes(userId)) {
    game.seen.push(userId);
    if (game.lobbyMessageId) {
      try {
        await editMessage(token, game.gameChannelId, game.lobbyMessageId, buildRoleCheckEmbed(game));
      } catch {
      }
    }
  }
  const descLines = [
    "",
    `> ${role.description}`,
    "",
    "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
    ""
  ];
  if (roleKey === "loup") {
    const teammates = Object.entries(game.roles).filter(([id, r]) => r === "loup" && id !== userId).map(([id]) => `\u{1F43A} <@${id}>`);
    if (teammates.length > 0) {
      descLines.push(`**Tes co\xE9quipiers:**`, ...teammates, "", "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501", "");
    }
  }
  descLines.push(
    `\u{1F3AE} **Partie #${game.gameNumber}**`,
    `\u{1F465} **${game.players.length} joueurs**`,
    `\u2694\uFE0F \xC9quipe: **${role.team === "loups" ? "Loups-Garous \u{1F43A}" : "Village \u{1F3D8}\uFE0F"}**`
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
          footer: { text: "\u{1F92B} Ne r\xE9v\xE8le ton r\xF4le \xE0 personne!" }
        }
      ],
      flags: 64
    }
  });
}
__name(handleRevealRole, "handleRevealRole");
async function handleStart(interaction, env) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "\u274C Erreur: utilisateur introuvable.", flags: 64 } });
  const game = parseGameFromEmbed(interaction.message);
  if (!game) return json({ type: 4, data: { content: "\u274C Erreur: partie introuvable.", flags: 64 } });
  if (userId !== game.creatorId) {
    return json({ type: 4, data: { content: `\u274C Seul le cr\xE9ateur (<@${game.creatorId}>) peut lancer la partie.`, flags: 64 } });
  }
  if (game.players.length < MIN_PLAYERS) {
    return json({ type: 4, data: { content: `\u274C Il faut au minimum ${MIN_PLAYERS} joueurs pour lancer.`, flags: 64 } });
  }
  const token = env.DISCORD_BOT_TOKEN;
  const deferredResponse = json({ type: 6 });
  globalThis.__backgroundWork = startGame(token, game, env);
  return deferredResponse;
}
__name(handleStart, "handleStart");
async function handleSkipCountdown(interaction, env) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return json({ type: 4, data: { content: "\u274C Erreur: utilisateur introuvable.", flags: 64 } });
  const game = parseGameFromEmbed(interaction.message);
  if (!game) return json({ type: 4, data: { content: "\u274C Erreur: partie introuvable.", flags: 64 } });
  if (userId !== game.creatorId) {
    return json({ type: 4, data: { content: `\u274C Seul le cr\xE9ateur (<@${game.creatorId}>) peut sauter le compte \xE0 rebours.`, flags: 64 } });
  }
  const token = env.DISCORD_BOT_TOKEN;
  globalThis.__backgroundWork = startGame(token, game, env);
  return json({ type: 6 });
}
__name(handleSkipCountdown, "handleSkipCountdown");
var index_default = {
  async fetch(req, env, ctx) {
    if (req.method !== "POST") {
      return new Response("\u{1F43A} Garou Interaction Server", { status: 200 });
    }
    const signature = req.headers.get("x-signature-ed25519");
    const timestamp = req.headers.get("x-signature-timestamp");
    const body = await req.text();
    if (!signature || !timestamp || !await verifySignature(body, signature, timestamp, env.DISCORD_PUBLIC_KEY)) {
      return new Response("Invalid signature", { status: 401 });
    }
    const interaction = JSON.parse(body);
    if (interaction.type === 1) return json({ type: 1 });
    if (interaction.type === 2) {
      if (interaction.data?.name === "loupgarou") {
        const response = await handleSlashCommand(interaction, env);
        const bgWork = globalThis.__backgroundWork;
        if (bgWork) {
          ctx.waitUntil(bgWork);
          globalThis.__backgroundWork = null;
        }
        return response;
      }
    }
    if (interaction.type === 3) {
      const customId = interaction.data?.custom_id || "";
      if (customId.startsWith("join_game_")) return handleJoin(interaction, env, ctx);
      if (customId.startsWith("quit_game_")) return handleQuit(interaction, env);
      if (customId.startsWith("reveal_role_")) return handleRevealRole(interaction, env);
      if (customId.startsWith("vote_kill_")) {
        const response = await handleVoteKill(interaction, env);
        const bgWork = globalThis.__backgroundWork;
        if (bgWork) {
          ctx.waitUntil(bgWork);
          globalThis.__backgroundWork = null;
        }
        return response;
      }
      if (customId.startsWith("start_game_") || customId.startsWith("skip_countdown_")) {
        const handler = customId.startsWith("skip_countdown_") ? handleSkipCountdown : handleStart;
        const response = await handler(interaction, env);
        const bgWork = globalThis.__backgroundWork;
        if (bgWork) {
          ctx.waitUntil(bgWork);
          globalThis.__backgroundWork = null;
        }
        return response;
      }
    }
    return json({ type: 4, data: { content: "\u274C Action inconnue.", flags: 64 } });
  }
};

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-4ZE3Af/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// ../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-4ZE3Af/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
