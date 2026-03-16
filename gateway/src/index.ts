import "dotenv/config";

import express from "express";
import { Client, Events, GatewayIntentBits, type TextChannel } from "discord.js";

const PORT = Number(process.env.GATEWAY_PORT ?? 3002);
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const SERVICE_TOKEN = process.env.GATEWAY_TOKEN ?? "";

if (!DISCORD_BOT_TOKEN) {
  throw new Error("DISCORD_BOT_TOKEN is required in gateway/.env");
}

// ── Types ────────────────────────────────────────────────────────────

interface WolfInfo {
  id: string;
  index: number;
}

interface TrackedThread {
  spyThreadId: string;
  wolves: Map<string, number>; // userId → display index
}

// ── State ────────────────────────────────────────────────────────────

const tracked = new Map<string, TrackedThread>(); // wolfThreadId → tracking info

// ── Express ──────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

function isAuthorized(req: express.Request): boolean {
  if (!SERVICE_TOKEN) return true;
  const raw = req.headers.authorization ?? "";
  return raw === `Bearer ${SERVICE_TOKEN}`;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    trackedThreads: tracked.size,
    ready: client.isReady(),
  });
});

app.post("/track-thread", (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { wolfThreadId, spyThreadId, wolves } = req.body as {
    wolfThreadId: string;
    spyThreadId: string;
    wolves: WolfInfo[];
  };

  if (!wolfThreadId || !spyThreadId || !Array.isArray(wolves)) {
    res.status(400).json({ ok: false, error: "wolfThreadId, spyThreadId, and wolves[] are required" });
    return;
  }

  const wolfMap = new Map<string, number>();
  for (const w of wolves) {
    wolfMap.set(w.id, w.index);
  }

  tracked.set(wolfThreadId, { spyThreadId, wolves: wolfMap });
  console.log(`[gateway] Tracking wolf thread ${wolfThreadId} → spy thread ${spyThreadId} (${wolves.length} wolves)`);

  res.json({ ok: true });
});

app.post("/untrack-thread", (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const { wolfThreadId } = req.body as { wolfThreadId: string };
  if (!wolfThreadId) {
    res.status(400).json({ ok: false, error: "wolfThreadId is required" });
    return;
  }

  const removed = tracked.delete(wolfThreadId);
  console.log(`[gateway] Untracked wolf thread ${wolfThreadId} (was tracked: ${removed})`);

  res.json({ ok: true, removed });
});

// ── Discord Client ───────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on(Events.MessageCreate, async (message) => {
  const entry = tracked.get(message.channelId);
  if (!entry) return;

  // Skip embeds-only messages (vote UI, system embeds)
  if (!message.content && message.embeds.length > 0) return;
  if (!message.content) return;

  // Determine display identity
  let mirrorText: string;
  const wolfIndex = entry.wolves.get(message.author.id);
  if (wolfIndex !== undefined) {
    // Human wolf
    mirrorText = `👀 **Loup #${wolfIndex}**: ${message.content}`;
  } else if (message.webhookId) {
    // Webhook message (bot wolf) — anonymous identity
    const botWolfNum = entry.wolves.size + 1; // Bots get numbers after human wolves
    mirrorText = `👀 **🐺 Loup #${botWolfNum}**: ${message.content}`;
  } else if (message.author.bot && message.content) {
    // Regular bot message (fallback sendMessage) — anonymous
    mirrorText = `👀 **🐺 Loup**: ${message.content}`;
  } else {
    return;
  }

  try {
    const spyChannel = await client.channels.fetch(entry.spyThreadId) as TextChannel | null;
    if (!spyChannel) {
      console.error(`[gateway] Spy thread ${entry.spyThreadId} not found, untracking`);
      tracked.delete(message.channelId);
      return;
    }

    await spyChannel.send(mirrorText);
  } catch (error) {
    console.error(`[gateway] Failed to mirror message to spy thread ${entry.spyThreadId}:`, error);
  }
});

client.once(Events.ClientReady, () => {
  console.log(`[gateway] Connected as ${client.user?.tag}`);
});

client.on(Events.Error, (error) => {
  console.error("[gateway] Discord client error:", error);
});

// ── Start ────────────────────────────────────────────────────────────

client.login(DISCORD_BOT_TOKEN).then(() => {
  app.listen(PORT, () => {
    console.log(`[gateway] Listening on http://127.0.0.1:${PORT}`);
  });
});
