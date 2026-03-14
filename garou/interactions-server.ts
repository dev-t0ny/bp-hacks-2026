import nacl from "tweetnacl";
import * as discord from "./src/actions/discord-api";
import { parseGameFromEmbed, buildGameEmbed } from "./src/actions/embed-builder";

const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || "";
const PORT = Number(process.env.PORT) || 3847;
const MIN_PLAYERS = 4;

if (!DISCORD_PUBLIC_KEY) {
  console.error("❌ DISCORD_PUBLIC_KEY env var is required");
  process.exit(1);
}

function verifyDiscordSignature(
  body: string,
  signature: string,
  timestamp: string
): boolean {
  const message = Buffer.from(timestamp + body);
  const sig = Buffer.from(signature, "hex");
  const key = Buffer.from(DISCORD_PUBLIC_KEY, "hex");
  return nacl.sign.detached.verify(
    new Uint8Array(message),
    new Uint8Array(sig),
    new Uint8Array(key)
  );
}

async function handleJoin(interaction: any): Promise<{ data: any; status: number }> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) {
    return jsonResponse({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });
  }

  const game = parseGameFromEmbed(interaction.message);
  if (!game) {
    return jsonResponse({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });
  }

  if (game.players.includes(userId)) {
    return jsonResponse({ type: 4, data: { content: "❌ Tu es déjà dans cette partie!", flags: 64 } });
  }
  if (game.players.length >= game.maxPlayers) {
    return jsonResponse({ type: 4, data: { content: "❌ La partie est pleine!", flags: 64 } });
  }

  // Add player
  game.players.push(userId);

  // Give player VIEW_CHANNEL on game channel (deny SEND_MESSAGES)
  await discord.setChannelPermission(game.gameChannelId, userId, {
    allow: String(1 << 10),
    deny: String(1 << 11),
    type: 1,
  });

  // Update the embed with new player count + data
  const channelId = interaction.channel_id;
  const messageId = interaction.message.id;
  const updatedEmbed = buildGameEmbed(game);
  await discord.editMessage(channelId, messageId, updatedEmbed);

  // Get player display name
  const member = await discord.getGuildMember(game.guildId, userId);
  const playerName = member.nick || member.user.global_name || member.user.username;

  // Send join message in game channel
  await discord.sendMessage(game.gameChannelId, {
    content: `**${playerName}** a rejoint la partie! (${game.players.length}/${game.maxPlayers})`,
  });

  // If full, announce auto-start
  if (game.players.length >= game.maxPlayers) {
    await discord.sendMessage(game.gameChannelId, {
      embeds: [
        {
          title: "🎮 La partie est pleine!",
          description: "La partie de Loup-Garou va commencer...",
          color: 0x00ff00,
        },
      ],
    });
  }
  // If exactly MIN_PLAYERS, notify creator can start early
  else if (game.players.length === MIN_PLAYERS) {
    await discord.sendMessage(game.gameChannelId, {
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

  return jsonResponse({
    type: 4,
    data: {
      content: `✅ Tu as rejoint la Partie #${game.gameNumber}! Regarde le salon <#${game.gameChannelId}>`,
      flags: 64,
    },
  });
}

import http from "http";

function sendJson(res: http.ServerResponse, data: any, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function jsonResponse(data: any, _status = 200): { data: any; status: number } {
  return { data, status: _status };
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  const body = await new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolve(data));
  });

  const signature = req.headers["x-signature-ed25519"] as string | undefined;
  const timestamp = req.headers["x-signature-timestamp"] as string | undefined;

  if (!signature || !timestamp || !verifyDiscordSignature(body, signature, timestamp)) {
    res.writeHead(401);
    res.end("Invalid signature");
    return;
  }

  const interaction = JSON.parse(body);

  // PING — Discord verification handshake
  if (interaction.type === 1) {
    sendJson(res, { type: 1 });
    return;
  }

  // BUTTON click (type 3 = MESSAGE_COMPONENT)
  if (interaction.type === 3) {
    const customId: string = interaction.data?.custom_id || "";
    if (customId.startsWith("join_game_")) {
      const result = await handleJoin(interaction);
      sendJson(res, JSON.parse(JSON.stringify(result.data)), result.status);
      return;
    }
  }

  sendJson(res, { type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
});

server.listen(PORT, () => {
  console.log(`🐺 Interaction server running on http://localhost:${PORT}`);
});
