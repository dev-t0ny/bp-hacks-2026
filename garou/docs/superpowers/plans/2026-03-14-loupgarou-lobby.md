# Loup-Garou Lobby Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `/loupgarou <max>` command that creates a game lobby with a Discord embed + interactive button, auto-created game channels, and start logic.

**Architecture:** Two-process architecture:
1. **ADK bot** (runs in Botpress Cloud via `adk dev`) — detects `/loupgarou N` in conversations, sends embed with "Rejoindre" button via Discord REST API, creates game channels, stores game state in embed fields.
2. **Interaction server** (runs locally with Bun) — receives Discord button interactions via HTTP, processes joins (updates embed, manages channel permissions, sends messages).

Game state is stored **in the Discord embed itself** (hidden fields for player IDs, channel ID, guild ID, etc). Both processes read/write game state through the Discord REST API. No shared database or cross-process communication needed.

**Tech Stack:** Botpress ADK (TypeScript), Discord REST API v10 (via `fetch`), Bun HTTP server, tweetnacl (Discord interaction signature verification).

**Key design note:** The Botpress Discord integration does NOT support embeds, buttons, or channel creation. We use the Discord REST API directly for all of these. Button interactions are received by a separate Bun HTTP server since Botpress doesn't forward `INTERACTION_CREATE` events.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/actions/discord-api.ts` | Discord REST API wrapper (`fetch`). Shared by ADK bot and interaction server. |
| `src/actions/embed-builder.ts` | Builds embed + button payloads. Parses game state from embed fields. Shared. |
| `src/actions/index.ts` | ADK actions export (empty — our helpers are plain modules, not ADK Actions). |
| `src/conversations/index.ts` | Detects `/loupgarou N`, creates game (embed + channel). |
| `src/triggers/index.ts` | Stays empty (we use the interaction server for buttons, not triggers). |
| `src/interactions-server.ts` | Bun HTTP server — receives Discord button clicks, processes joins. |
| `agent.config.ts` | Add bot state for game counter. |

---

## Chunk 1: Discord API + Embed Builder

### Task 1: Create the Discord REST API wrapper

**Files:**
- Create: `src/actions/discord-api.ts`

- [ ] **Step 1: Create `src/actions/discord-api.ts`**

```typescript
const DISCORD_API = "https://discord.com/api/v10";
const BOT_TOKEN = "MTQ4MjM4MDIzNjUyMjc4NzAwOA.G06kVH.6D2_kWssTPYvsLDUaMK_vhOH8726fxgWbaSICo";

const headers = {
  Authorization: `Bot ${BOT_TOKEN}`,
  "Content-Type": "application/json",
};

async function discordFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function sendMessage(channelId: string, body: Record<string, unknown>) {
  return discordFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function editMessage(channelId: string, messageId: string, body: Record<string, unknown>) {
  return discordFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function createChannel(guildId: string, body: Record<string, unknown>) {
  return discordFetch(`/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function setChannelPermission(
  channelId: string,
  targetId: string,
  body: { allow?: string; deny?: string; type: 0 | 1 }
) {
  return discordFetch(`/channels/${channelId}/permissions/${targetId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function getGuildChannels(guildId: string) {
  return discordFetch(`/guilds/${guildId}/channels`);
}

export async function getGuildMember(guildId: string, userId: string) {
  return discordFetch(`/guilds/${guildId}/members/${userId}`);
}

export async function getBotUser() {
  return discordFetch("/users/@me");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/discord-api.ts
git commit -m "feat: add Discord REST API wrapper"
```

### Task 2: Create the embed builder + parser

**Files:**
- Create: `src/actions/embed-builder.ts`

The embed stores game state in hidden fields at the bottom. When the interaction server receives a button click, it parses these fields to get the full game context. This is the shared "database" between both processes.

- [ ] **Step 1: Create `src/actions/embed-builder.ts`**

```typescript
const EMBED_COLOR = 0x8b0000;
const WEREWOLF_IMAGE = "https://i.imgur.com/JfOLPcY.png";
const MIN_PLAYERS = 4;

export interface GameState {
  gameNumber: number;
  creatorId: string;
  creatorName: string;
  guildId: string;
  gameChannelId: string;
  maxPlayers: number;
  players: string[]; // Discord user IDs
}

export function buildGameEmbed(game: GameState) {
  const playerCount = game.players.length;
  const isFull = playerCount >= game.maxPlayers;

  return {
    embeds: [
      {
        title: `🐺 Partie de Loup-Garou #${game.gameNumber}`,
        description: [
          `Créée par **${game.creatorName}**`,
          "",
          `**Joueurs:** ${playerCount}/${game.maxPlayers}`,
          "",
          isFull
            ? "**La partie est pleine!**"
            : "Cliquez sur le bouton pour rejoindre!",
        ].join("\n"),
        color: EMBED_COLOR,
        image: { url: WEREWOLF_IMAGE },
        footer: {
          text: isFull
            ? "La partie va commencer!"
            : `Minimum ${MIN_PLAYERS} joueurs pour lancer`,
        },
        fields: [
          { name: "__gameNumber", value: String(game.gameNumber), inline: true },
          { name: "__creatorId", value: game.creatorId, inline: true },
          { name: "__creatorName", value: game.creatorName, inline: true },
          { name: "__guildId", value: game.guildId, inline: true },
          { name: "__gameChannelId", value: game.gameChannelId, inline: true },
          { name: "__maxPlayers", value: String(game.maxPlayers), inline: true },
          { name: "__players", value: game.players.join(",") || "none", inline: false },
        ],
      },
    ],
    components: isFull
      ? []
      : [
          {
            type: 1, // ACTION_ROW
            components: [
              {
                type: 2, // BUTTON
                style: 3, // SUCCESS (green)
                label: "🐺 Rejoindre la partie",
                custom_id: `join_game_${game.gameNumber}`,
              },
            ],
          },
        ],
  };
}

export function parseGameFromEmbed(message: any): GameState | null {
  const embed = message.embeds?.[0];
  if (!embed?.fields) return null;

  const field = (name: string): string | undefined =>
    embed.fields.find((f: any) => f.name === name)?.value;

  const gameNumber = Number(field("__gameNumber"));
  const creatorId = field("__creatorId");
  const creatorName = field("__creatorName");
  const guildId = field("__guildId");
  const gameChannelId = field("__gameChannelId");
  const maxPlayers = Number(field("__maxPlayers"));
  const playersRaw = field("__players");

  if (!creatorId || !guildId || !gameChannelId || !creatorName) return null;

  const players =
    playersRaw && playersRaw !== "none" ? playersRaw.split(",") : [];

  return {
    gameNumber,
    creatorId,
    creatorName,
    guildId,
    gameChannelId,
    maxPlayers,
    players,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/embed-builder.ts
git commit -m "feat: add embed builder and game state parser"
```

---

## Chunk 2: Game Creation — The /loupgarou Command

### Task 3: Add bot state for game counter

**Files:**
- Modify: `agent.config.ts`

- [ ] **Step 1: Add `gameCounter` to bot state**

Change `bot.state` from `z.object({})` to:
```typescript
bot: {
  state: z.object({
    gameCounter: z.number().optional().describe("Auto-incrementing game number counter"),
  }),
},
```

- [ ] **Step 2: Run `adk build`**

Run: `cd /Users/gabrielgingras/Personnel/bp-hacks-2026/garou && pnpm run build`

- [ ] **Step 3: Commit**

```bash
git add agent.config.ts
git commit -m "feat: add gameCounter to bot state"
```

### Task 4: Implement the /loupgarou conversation handler

**Files:**
- Modify: `src/conversations/index.ts`

When a Discord message matches `/loupgarou N`:
1. Parse max players, validate (4-20)
2. Increment game counter via bot state
3. Find or create a "Loup-Garou" category in the guild
4. Create a private `#partie-N` channel
5. Send embed with "Rejoindre" button to the lobby channel (via Discord REST API)
6. Send a welcome message in the game channel

- [ ] **Step 1: Rewrite `src/conversations/index.ts`**

```typescript
import { Conversation, bot } from "@botpress/runtime";
import * as discord from "../actions/discord-api";
import { buildGameEmbed, type GameState } from "../actions/embed-builder";

const MIN_PLAYERS = 4;
const MAX_PLAYERS_LIMIT = 20;
const EMBED_COLOR = 0x8b0000;

async function findOrCreateCategory(guildId: string): Promise<string> {
  const channels = await discord.getGuildChannels(guildId);
  const existing = channels.find(
    (c: any) => c.type === 4 && c.name.toLowerCase() === "loup-garou"
  );
  if (existing) return existing.id;

  const created = await discord.createChannel(guildId, {
    name: "Loup-Garou",
    type: 4,
  });
  return created.id;
}

async function createGameChannel(
  guildId: string,
  categoryId: string,
  gameNumber: number,
  botUserId: string
): Promise<string> {
  const channel = await discord.createChannel(guildId, {
    name: `partie-${gameNumber}`,
    type: 0,
    parent_id: categoryId,
    permission_overwrites: [
      {
        id: guildId,
        type: 0,
        deny: String(1 << 10),
      },
      {
        id: botUserId,
        type: 1,
        allow: String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 15)),
      },
    ],
  });
  return channel.id;
}

export default new Conversation({
  channel: "*",
  handler: async ({ message, conversation, execute }) => {
    if (!message || message.type !== "text") return;

    const text = message.payload.text.trim();
    const match = text.match(/^\/loupgarou\s+(\d+)$/i);

    if (!match) {
      await execute({
        instructions:
          "Tu es Garou, un bot de jeu de Loup-Garou. Dis aux utilisateurs de taper /loupgarou <nombre> pour créer une partie.",
      });
      return;
    }

    const maxPlayers = parseInt(match[1]!, 10);
    if (maxPlayers < MIN_PLAYERS) {
      await conversation.send({
        type: "text",
        payload: { text: `❌ Il faut au minimum ${MIN_PLAYERS} joueurs.` },
      });
      return;
    }
    if (maxPlayers > MAX_PLAYERS_LIMIT) {
      await conversation.send({
        type: "text",
        payload: { text: `❌ Maximum ${MAX_PLAYERS_LIMIT} joueurs.` },
      });
      return;
    }

    const guildId = conversation.tags["discord:guildId"];
    const channelId = conversation.tags["discord:id"];
    const creatorDiscordId = message.tags["discord:userId"];

    if (!guildId || !channelId || !creatorDiscordId) {
      await conversation.send({
        type: "text",
        payload: { text: "❌ Cette commande ne fonctionne que dans un serveur Discord." },
      });
      return;
    }

    // Get creator info
    const member = await discord.getGuildMember(guildId, creatorDiscordId);
    const creatorName = member.nick || member.user.global_name || member.user.username;

    // Increment game counter
    const currentState = await bot.getState();
    const gameNumber = (currentState?.gameCounter ?? 0) + 1;
    await bot.setState({ gameCounter: gameNumber });

    // Get bot user for channel permissions
    const botUser = await discord.getBotUser();

    // Create category + game channel
    const categoryId = await findOrCreateCategory(guildId);
    const gameChannelId = await createGameChannel(guildId, categoryId, gameNumber, botUser.id);

    // Build and send embed with button
    const gameState: GameState = {
      gameNumber,
      creatorId: creatorDiscordId,
      creatorName,
      guildId,
      gameChannelId,
      maxPlayers,
      players: [],
    };
    const embedPayload = buildGameEmbed(gameState);
    await discord.sendMessage(channelId, embedPayload);

    // Send welcome message in game channel
    await discord.sendMessage(gameChannelId, {
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
  },
});
```

- [ ] **Step 2: Update `src/actions/index.ts`** to stay as empty export (it's already `export default {}` — no change needed if it's already that).

- [ ] **Step 3: Run `adk build`**

Run: `cd /Users/gabrielgingras/Personnel/bp-hacks-2026/garou && pnpm run build`

- [ ] **Step 4: Commit**

```bash
git add src/conversations/index.ts src/actions/index.ts
git commit -m "feat: implement /loupgarou command with embed, button, and game channel"
```

---

## Chunk 3: Interaction Server — Button Joins

### Task 5: Install tweetnacl for Discord signature verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install tweetnacl**

Run: `cd /Users/gabrielgingras/Personnel/bp-hacks-2026/garou && pnpm add tweetnacl`

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add tweetnacl for Discord interaction verification"
```

### Task 6: Create the interaction server

**Files:**
- Create: `src/interactions-server.ts`

This is a standalone Bun HTTP server. It:
1. Listens on port 3847
2. Verifies Discord interaction signatures (required by Discord)
3. Handles PING (Discord verification handshake)
4. Handles button clicks: parses game state from the embed, processes the join

When "Rejoindre" is clicked:
1. Parse game state from the interaction's `message.embeds[0].fields`
2. Check if user already joined / game full
3. Add user to players list
4. Update embed (new count + updated `__players` field)
5. Set channel permissions (user can view, not send)
6. Send join notification in game channel
7. Respond to Discord with ephemeral "Tu as rejoint!" message
8. If full: announce start. If 4+ players: notify creator can start.

- [ ] **Step 1: Create `src/interactions-server.ts`**

```typescript
import nacl from "tweetnacl";
import * as discord from "./actions/discord-api";
import { parseGameFromEmbed, buildGameEmbed } from "./actions/embed-builder";

// Discord application's public key — get from Discord Developer Portal
// TODO: Replace with your app's actual public key
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || "YOUR_PUBLIC_KEY_HERE";
const PORT = 3847;
const MIN_PLAYERS = 4;

function verifyDiscordSignature(
  body: string,
  signature: string,
  timestamp: string
): boolean {
  const message = Buffer.from(timestamp + body);
  const sig = Buffer.from(signature, "hex");
  const key = Buffer.from(DISCORD_PUBLIC_KEY, "hex");
  return nacl.sign.detached.verify(message, sig, key);
}

async function handleJoin(interaction: any): Promise<Response> {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) {
    return jsonResponse({ type: 4, data: { content: "❌ Erreur: utilisateur introuvable.", flags: 64 } });
  }

  // Parse game state from the embed fields in the message
  const game = parseGameFromEmbed(interaction.message);
  if (!game) {
    return jsonResponse({ type: 4, data: { content: "❌ Erreur: partie introuvable.", flags: 64 } });
  }

  // Validation
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
    allow: String(1 << 10),  // VIEW_CHANNEL
    deny: String(1 << 11),   // SEND_MESSAGES
    type: 1,                  // member
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
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: {
      content: `✅ Tu as rejoint la Partie #${game.gameNumber}! Regarde le salon <#${game.gameChannelId}>`,
      flags: 64, // EPHEMERAL
    },
  });
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const signature = req.headers.get("x-signature-ed25519");
    const timestamp = req.headers.get("x-signature-timestamp");
    const body = await req.text();

    if (!signature || !timestamp || !verifyDiscordSignature(body, signature, timestamp)) {
      return new Response("Invalid signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    // PING — Discord verification handshake
    if (interaction.type === 1) {
      return jsonResponse({ type: 1 });
    }

    // BUTTON click (type 3 = MESSAGE_COMPONENT)
    if (interaction.type === 3) {
      const customId: string = interaction.data?.custom_id || "";
      if (customId.startsWith("join_game_")) {
        return await handleJoin(interaction);
      }
    }

    return jsonResponse({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
  },
});

console.log(`🐺 Interaction server running on http://localhost:${PORT}`);
```

- [ ] **Step 2: Add a `dev:interactions` script to `package.json`**

Add to the scripts section:
```json
"dev:interactions": "bun run src/interactions-server.ts"
```

- [ ] **Step 3: Commit**

```bash
git add src/interactions-server.ts package.json
git commit -m "feat: add Bun interaction server for Discord button clicks"
```

---

## Chunk 4: Setup + Testing

### Task 7: Set up Discord application for interactions

This is a manual step — document it for the developer.

- [ ] **Step 1: Get the Discord Application Public Key**

1. Go to https://discord.com/developers/applications
2. Select the bot application
3. Copy the "Public Key" from the General Information page
4. Set it as `DISCORD_PUBLIC_KEY` environment variable

- [ ] **Step 2: Expose the interaction server with ngrok**

Run: `ngrok http 3847`
Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

- [ ] **Step 3: Set the Interactions Endpoint URL**

1. Go to Discord Developer Portal → General Information
2. Set "Interactions Endpoint URL" to `https://abc123.ngrok.io`
3. Discord will send a PING to verify — the server must be running
4. Save

### Task 8: Full integration test

- [ ] **Step 1: Start both servers**

Terminal 1: `cd /Users/gabrielgingras/Personnel/bp-hacks-2026/garou && pnpm run dev`
Terminal 2: `cd /Users/gabrielgingras/Personnel/bp-hacks-2026/garou && DISCORD_PUBLIC_KEY=<key> bun run src/interactions-server.ts`
Terminal 3: `ngrok http 3847`

- [ ] **Step 2: Test the full flow in Discord**

1. Type `/loupgarou 5` in a text channel
2. Verify: embed appears with image, 0/5 count, green "Rejoindre" button
3. Verify: `#partie-N` channel created under "Loup-Garou" category (hidden to others)
4. Click the "Rejoindre" button
5. Verify: ephemeral message "Tu as rejoint la Partie #N!"
6. Verify: embed updates to 1/5
7. Verify: join message in game channel
8. Verify: you can see `#partie-N` but can't type

- [ ] **Step 3: Fix any issues found during testing**

### Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md** with the final architecture:
- Two-process model (ADK bot + Bun interaction server)
- Discord API wrapper pattern
- Embed-as-database approach
- How to run in dev (both servers + ngrok)

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "feat: complete loup-garou lobby — /loupgarou command, button join, game channels"
```
