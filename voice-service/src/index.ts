import "dotenv/config";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import express from "express";
import prism from "prism-media";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from "@discordjs/voice";
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type VoiceBasedChannel,
} from "discord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.VOICE_SERVICE_PORT ?? 3001);
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const SERVICE_TOKEN = process.env.VOICE_SERVICE_TOKEN ?? "";
const DEFAULT_SOUND_PATH = path.join(__dirname, "..", "sounds", "partie-commence.m4a");
const SOUND_FILE_PATH = process.env.SOUND_FILE_PATH ?? DEFAULT_SOUND_PATH;

if (!DISCORD_BOT_TOKEN) {
  throw new Error("DISCORD_BOT_TOKEN is required in voice-service/.env");
}

const app = express();
app.use(express.json());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const connections = new Map<string, VoiceConnection>();

/** Result of attempting to play the game-start sound */
export type PlayGameStartSoundResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; error: string };

export interface PlayGameStartSoundOptions {
  soundPath?: string;
  /** If true, do not play when no one is in the voice channel (default: true) */
  requireListeners?: boolean;
}

/**
 * Joins the given voice channel and plays the game-start sound.
 * Validates inputs, optionally skips when no one is in the channel, and handles errors cleanly.
 */
async function playGameStartSound(
  guildId: string,
  voiceChannelId: string,
  options: PlayGameStartSoundOptions = {}
): Promise<PlayGameStartSoundResult> {
  const { soundPath = SOUND_FILE_PATH, requireListeners = true } = options;

  if (!guildId.trim() || !voiceChannelId.trim()) {
    return { ok: false, error: "guildId and voiceChannelId are required" };
  }

  const resolvedPath = path.isAbsolute(soundPath) ? soundPath : path.resolve(soundPath);
  if (!fs.existsSync(resolvedPath)) {
    const err = `Sound file not found: ${resolvedPath}`;
    console.error(`[voice-service] ${err}`);
    return { ok: false, error: err };
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(voiceChannelId);

    if (!channel || !channel.isVoiceBased() || channel.type !== ChannelType.GuildVoice) {
      return { ok: false, error: "Target channel must be a guild voice channel" };
    }

    const voiceChannel = channel as VoiceBasedChannel;
    const memberCount = voiceChannel.members?.size ?? 0;
    if (requireListeners && memberCount === 0) {
      console.log(
        `[voice-service] Skipped start sound: no one in voice channel ${voiceChannelId} (guild ${guildId})`
      );
      return { ok: true, skipped: true };
    }

    console.log(
      `[voice-service] Playing start sound in guild=${guildId} channel=${voiceChannelId} (${memberCount} in channel)`
    );

    const connection = await ensureVoiceConnection(guildId, voiceChannelId);
    await playLocalFile(connection, resolvedPath);

    console.log(`[voice-service] Start sound finished successfully`);
    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown voice error";
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[voice-service] Play start sound failed:`, message);
    if (stack && process.env.NODE_ENV !== "production") {
      console.error(stack);
    }
    return { ok: false, error: message };
  }
}

function isAuthorized(req: express.Request): boolean {
  if (!SERVICE_TOKEN) return true;
  const raw = req.headers.authorization ?? "";
  return raw === `Bearer ${SERVICE_TOKEN}`;
}

async function ensureVoiceConnection(
  guildId: string,
  voiceChannelId: string
): Promise<VoiceConnection> {
  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(voiceChannelId);

  if (!channel || !channel.isVoiceBased() || channel.type !== ChannelType.GuildVoice) {
    throw new Error("Target channel must be a guild voice channel");
  }

  const voiceChannel = channel as VoiceBasedChannel;
  const existing = connections.get(guildId);
  if (existing && existing.joinConfig.channelId === voiceChannelId) {
    return existing;
  }
  if (existing) {
    try {
      existing.destroy();
    } catch {
      // Ignore cleanup errors and continue with fresh connection.
    }
  }

  const connection = joinVoiceChannel({
    guildId,
    channelId: voiceChannel.id,
    adapterCreator: guild.voiceAdapterCreator as any,
    selfDeaf: false,
    selfMute: false,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  connections.set(guildId, connection);
  console.log(`[voice-service] Joined voice channel ${voiceChannelId} in guild ${guildId}`);
  return connection;
}

async function playLocalFile(connection: VoiceConnection, filePath: string): Promise<void> {
  console.log(`[voice-service] Playing file: ${filePath}`);
  const transcoder = new prism.FFmpeg({
    args: [
      "-analyzeduration",
      "0",
      "-loglevel",
      "0",
      "-i",
      filePath,
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
    ],
  });

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Stop },
  });

  const resource = createAudioResource(transcoder, {
    inputType: StreamType.Raw,
  });

  connection.subscribe(player);
  player.play(resource);
  await entersState(player, AudioPlayerStatus.Playing, 10_000);

  await new Promise<void>((resolve) => {
    player.once(AudioPlayerStatus.Idle, () => resolve());
  });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    connectedGuilds: [...connections.keys()],
    ready: client.isReady(),
  });
});

/**
 * Test route to trigger start sound manually (same auth as POST /play-start-sfx).
 * Query: guildId, voiceChannelId; optional: requireListeners=0 to play even if channel is empty.
 * Example: GET /test-play?guildId=123&voiceChannelId=456
 * Header: Authorization: Bearer <VOICE_SERVICE_TOKEN> if VOICE_SERVICE_TOKEN is set.
 */
app.get("/test-play", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const guildId = String(req.query?.guildId ?? "").trim();
  const voiceChannelId = String(req.query?.voiceChannelId ?? "").trim();
  const requireListeners = String(req.query?.requireListeners ?? "1") !== "0";

  if (!guildId || !voiceChannelId) {
    res.status(400).json({
      ok: false,
      error: "Query params guildId and voiceChannelId are required. Optional: requireListeners=0 to play in empty channel.",
    });
    return;
  }

  console.log(
    `[voice-service] GET /test-play guildId=${guildId} voiceChannelId=${voiceChannelId} requireListeners=${requireListeners}`
  );

  const result = await playGameStartSound(guildId, voiceChannelId, {
    requireListeners,
  });

  if (result.ok) {
    res.json(result.skipped ? { ok: true, skipped: true } : { ok: true });
    return;
  }

  const isBadRequest =
    result.error.includes("required") || result.error.includes("must be a guild voice channel");
  res
    .status(isBadRequest ? 400 : 500)
    .json({ ok: false, error: result.error });
});

app.post("/play-start-sfx", async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const guildId = String(req.body?.guildId ?? "").trim();
  const voiceChannelId = String(req.body?.voiceChannelId ?? "").trim();
  const customSoundPath =
    typeof req.body?.soundPath === "string" && req.body.soundPath.trim().length
      ? req.body.soundPath.trim()
      : SOUND_FILE_PATH;

  console.log(
    `[voice-service] POST /play-start-sfx guildId=${guildId} voiceChannelId=${voiceChannelId}`
  );

  const result = await playGameStartSound(guildId, voiceChannelId, {
    soundPath: customSoundPath,
    requireListeners: true,
  });

  if (result.ok) {
    res.json(result.skipped ? { ok: true, skipped: true } : { ok: true });
    return;
  }

  const isBadRequest =
    result.error.includes("required") || result.error.includes("must be a guild voice channel");
  res
    .status(isBadRequest ? 400 : 500)
    .json({ ok: false, error: result.error });
});

client.once("ready", () => {
  console.log(`[voice-service] Connected as ${client.user?.tag}`);
});

client.on("error", (error) => {
  console.error("[voice-service] Discord client error:", error);
});

client.login(DISCORD_BOT_TOKEN).then(() => {
  app.listen(PORT, () => {
    console.log(`[voice-service] Listening on http://127.0.0.1:${PORT}`);
    console.log(`[voice-service] SOUND_FILE_PATH=${SOUND_FILE_PATH}`);
  });
});
