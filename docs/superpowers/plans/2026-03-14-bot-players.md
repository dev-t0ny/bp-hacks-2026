# Bot Players IA — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI bot players to Loup-Garou games that play autonomously with personality traits, role-aware strategy, and natural timing.

**Architecture:** Hybrid approach — the Cloudflare Worker orchestrates game flow and calls the Botpress ADK (via converse API) when a bot needs to make a decision. Bot data is stored in Cloudflare KV (not in the embed URL). The Worker formats bot decisions as Discord messages posted by the main Garou bot.

**Tech Stack:** TypeScript (Cloudflare Workers), Botpress ADK (`execute()` + tools), Cloudflare KV, Discord REST API.

**Spec:** `docs/superpowers/specs/2026-03-14-bot-players-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `worker/bot-personalities.ts` | Static pool of ~15 bot personalities (name, traits, emoji). Pure data, no logic. |
| `worker/bot-orchestrator.ts` | Core bot logic: scheduling decisions with random delays, calling the ADK or direct LLM fallback, formatting Discord messages, managing gameHistory in KV. |
| `src/tools/bot-decision.ts` | Botpress ADK tool — receives bot context, builds role-aware prompt, calls `execute()`, returns structured decision. |

### Modified files

| File | What changes |
|------|-------------|
| `worker/index.ts` | Add `botCount` to GameState + encode/decode. Modify `assignRoles()` signature. Integrate bot-orchestrator into `startNightPhase()` and `resolveNightVote()`. Add auto-fill logic in `handleStart()`. Add bots to lobby embed display. |
| `worker/config-embed.ts` | Add `botCount` to ConfigState + encode/decode. Add "Nombre de bots" select menu in step 1. |

---

## Chunk 1: Data Layer & Personalities

### Task 1: Bot Personalities Pool

**Files:**
- Create: `worker/bot-personalities.ts`

- [ ] **Step 1: Create bot-personalities.ts with the BotPersonality type and pool**

```typescript
// worker/bot-personalities.ts

export interface BotPersonality {
  name: string;
  traits: string[];
  emoji: string;
}

export const BOT_POOL: BotPersonality[] = [
  { name: "Marcel", traits: ["méfiant", "direct"], emoji: "🧔" },
  { name: "Sophie", traits: ["diplomatique", "observatrice"], emoji: "👩‍🦰" },
  { name: "René", traits: ["impulsif", "drôle"], emoji: "🤡" },
  { name: "Colette", traits: ["prudente", "analytique"], emoji: "🧓" },
  { name: "Jacques", traits: ["confiant", "bavard"], emoji: "👨‍🦳" },
  { name: "Marie", traits: ["silencieuse", "perspicace"], emoji: "👩" },
  { name: "François", traits: ["agressif", "soupçonneux"], emoji: "😤" },
  { name: "Isabelle", traits: ["calme", "stratège"], emoji: "🤔" },
  { name: "Pierre", traits: ["naïf", "enthousiaste"], emoji: "😊" },
  { name: "Hélène", traits: ["sarcastique", "intelligente"], emoji: "😏" },
  { name: "Antoine", traits: ["nerveux", "honnête"], emoji: "😰" },
  { name: "Thérèse", traits: ["autoritaire", "protectrice"], emoji: "💪" },
  { name: "Lucien", traits: ["discret", "calculateur"], emoji: "🤫" },
  { name: "Camille", traits: ["curieuse", "intuitive"], emoji: "🔍" },
  { name: "Gustave", traits: ["têtu", "loyal"], emoji: "🫡" },
];

/** Pick `count` unique random personalities from the pool */
export function pickBots(count: number): BotPersonality[] {
  const shuffled = [...BOT_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, BOT_POOL.length));
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/bot-personalities.ts
git commit -m "feat(bots): add bot personality pool with 15 characters"
```

---

### Task 2: Add botCount to GameState & ConfigState

**Files:**
- Modify: `worker/index.ts` (GameState interface, encodeState, decodeState, buildLobbyEmbed)
- Modify: `worker/config-embed.ts` (ConfigState interface, encodeConfigState, decodeConfigState)

- [ ] **Step 1: Add botCount to ConfigState in config-embed.ts**

In `worker/config-embed.ts`, add `botCount: number` to the `ConfigState` interface (after `voteTime`):

```typescript
export interface ConfigState {
  step: number;
  creatorId: string;
  guildId: string;
  channelId: string;
  presetName: string;
  anonymousVotes: boolean;
  discussionTime: number;
  voteTime: number;
  selectedRoles: number[];
  botCount: number; // NEW
}
```

Update `encodeConfigState` to include `bc: config.botCount` in the compact object.

Update `decodeConfigState` to include `botCount: compact.bc ?? 0` in the returned object.

- [ ] **Step 2: Add botCount to GameState in index.ts**

In `worker/index.ts`, add `botCount?: number` to the `GameState` interface (after `selectedRoleIds`).

Update `encodeState` to include `if (game.botCount) compact.bc = game.botCount;`

Update `decodeState` to include `botCount: compact.bc ?? 0` in the returned object.

- [ ] **Step 3: Add "Nombre de bots" select menu to config wizard step 1**

**Discord limit:** Max 5 action rows per message. Both step 1 (preset, votes, disc_time, vote_time, buttons) and step 2 (v1, v2, loups, solo, buttons) already use all 5 rows.

**Solution:** In `buildStep1Embed()`, **replace** the vote type selector row (`cfg_votes`) with the bot count selector. Move the vote type toggle into the `cfg_preset` select menu as combined options (e.g., "Classique (Public)" / "Classique (Anonyme)"), or move it to step 2 by merging it into the buttons row as two toggle buttons instead of a select menu.

**Simplest approach:** Replace the `cfg_votes` row in step 1 with `cfg_bots`. Add two buttons ("Public" / "Anonyme") to the existing buttons row in step 1 (max 5 buttons per row, currently only 2). This keeps all 5 rows and adds bot selection.

```typescript
// Replace the cfg_votes row with:
{
  type: 1,
  components: [
    {
      type: 3,
      custom_id: "cfg_bots",
      placeholder: "🤖 Nombre de bots IA",
      min_values: 1,
      max_values: 1,
      options: [
        { label: "Aucun bot", value: "0", default: config.botCount === 0 },
        { label: "1 bot", value: "1", default: config.botCount === 1 },
        { label: "2 bots", value: "2", default: config.botCount === 2 },
        { label: "3 bots", value: "3", default: config.botCount === 3 },
        { label: "4 bots", value: "4", default: config.botCount === 4 },
        { label: "5 bots", value: "5", default: config.botCount === 5 },
      ],
    },
  ],
},

// Add vote toggle buttons to the existing buttons row:
{
  type: 2,
  style: config.anonymousVotes ? 2 : 1,
  label: "👁️ Public",
  custom_id: "cfg_votes_public",
},
{
  type: 2,
  style: config.anonymousVotes ? 1 : 2,
  label: "🔒 Anonyme",
  custom_id: "cfg_votes_anonyme",
},
```

Handle `cfg_votes_public` and `cfg_votes_anonyme` in `handleConfigButton` — set `config.anonymousVotes` accordingly.

- [ ] **Step 4: Handle cfg_bots select in handleConfigSelect**

In `worker/index.ts` `handleConfigSelect()`, add handling for `cfg_bots`:

```typescript
if (customId === "cfg_bots") {
  config.botCount = parseInt(values[0] || "0", 10);
}
```

- [ ] **Step 5: Pass botCount from config to GameState in handleCreateGame**

In `worker/index.ts` `handleCreateGame()`, when creating the gameState object (~line 950-960), add:

```typescript
botCount: config.botCount,
```

Also update `maxPlayers` calculation to account for bots:

```typescript
const maxPlayers = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, config.selectedRoles.length));
```

This stays the same — `maxPlayers` is the total including bots. The bot slots are reserved, so human join slots = `maxPlayers - botCount`.

- [ ] **Step 6: Initialize default botCount in handleSlashCommand**

In `worker/index.ts` `handleSlashCommand()` (~line 1020), add `botCount: 0` to the initial config object.

- [ ] **Step 7: Verify the worker builds**

Run: `cd worker && npx wrangler deploy --dry-run 2>&1 | tail -20`

- [ ] **Step 8: Commit**

```bash
git add worker/index.ts worker/config-embed.ts
git commit -m "feat(bots): add botCount to GameState and ConfigState with config UI"
```

---

### Task 3: Bot KV Storage & Lobby Integration

**Files:**
- Modify: `worker/index.ts` (handleCreateGame, buildLobbyEmbed, handleJoin, handleStart)
- Depends on: `worker/bot-personalities.ts`

- [ ] **Step 1: Import bot-personalities in index.ts**

Add at top of `worker/index.ts`:

```typescript
import { pickBots, type BotPersonality } from "./bot-personalities";
```

- [ ] **Step 2: Define BotPlayer interface and KV helpers**

Add after the `GameState` interface in `worker/index.ts`:

```typescript
interface BotPlayer {
  id: string;       // "bot_1", "bot_2", etc.
  name: string;
  traits: string[];
  emoji: string;
  alive: boolean;
}

async function saveBots(kv: KVNamespace, gameNumber: number, bots: BotPlayer[]) {
  await kv.put(`game:${gameNumber}:bots`, JSON.stringify(bots), { expirationTtl: PLAYER_TTL });
}

async function loadBots(kv: KVNamespace, gameNumber: number): Promise<BotPlayer[]> {
  const val = await kv.get(`game:${gameNumber}:bots`);
  if (!val) return [];
  try { return JSON.parse(val); } catch { return []; }
}
```

- [ ] **Step 3: Create bots when game is created (handleCreateGame)**

In `handleCreateGame()`, after the gameState is created (~line 960) and before sending the lobby embed, add bot creation:

```typescript
// Create bot players if configured
if (gameState.botCount && gameState.botCount > 0) {
  const personalities = pickBots(gameState.botCount);
  const bots: BotPlayer[] = personalities.map((p, i) => ({
    id: `bot_${i + 1}`,
    name: p.name,
    traits: p.traits,
    emoji: p.emoji,
    alive: true,
  }));
  await saveBots(env.ACTIVE_PLAYERS, gameNumber, bots);
}
```

- [ ] **Step 4: Show bots in lobby embed**

Find `buildLobbyEmbed()` in `worker/index.ts`. It currently builds the player list from `game.players`. Modify it to accept an optional `bots` parameter and display them:

Change the signature to: `function buildLobbyEmbed(game: GameState, bots: BotPlayer[] = [], lastEvent?: string)`

In the player list section, after the human players, add:

```typescript
// Add bot players
for (const bot of bots) {
  playerLines.push(`🤖 ${bot.emoji} ${bot.name} (Bot)`);
}
```

Update the player count to include bots: `${game.players.length + bots.length}/${game.maxPlayers}`

Update all call sites of `buildLobbyEmbed` — in `handleCreateGame`, load bots and pass them:

```typescript
const bots = await loadBots(env.ACTIVE_PLAYERS, gameNumber);
const lobbyMsg: any = await sendMessage(token, gameChannel.id, buildLobbyEmbed(gameState, bots));
```

In `updateAllEmbeds`, also load and pass bots. This function needs access to KV — add `env` parameter if not already present.

- [ ] **Step 5: Block joins when human slots are full**

In `handleJoin()`, the current check is:
```typescript
if (game.players.length >= game.maxPlayers) return ...
```

Change to account for bot-reserved slots:
```typescript
const humanSlots = game.maxPlayers - (game.botCount ?? 0);
if (game.players.length >= humanSlots) return json({ type: 4, data: { content: "❌ La partie est pleine!", flags: 64 } });
```

Also update the "game is full" auto-countdown trigger to fire when `game.players.length >= humanSlots`.

- [ ] **Step 6: Enforce min 2 humans in handleStart**

In `handleStart()`, add validation:

```typescript
if (game.players.length < 2) {
  return json({ type: 4, data: { content: "❌ Il faut au minimum 2 joueurs humains pour lancer.", flags: 64 } });
}
```

- [ ] **Step 7: Add auto-fill logic in handleStart**

In `handleStart()`, before the existing min players check, add auto-fill:

```typescript
const totalPlayers = game.players.length + (game.botCount ?? 0);
if (totalPlayers < MIN_PLAYERS && game.players.length >= 2) {
  // Auto-fill: need at least MIN_PLAYERS total
  const needed = MIN_PLAYERS - totalPlayers;
  const personalities = pickBots(needed + (game.botCount ?? 0));
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
```

Note: The spec calls for an interactive "Add bots to fill?" prompt. For the MVP, auto-fill silently when the creator clicks "Lancer" and there aren't enough players. The interactive prompt can be added later.

- [ ] **Step 8: Update the min players check to include bots**

Change the existing check in `handleStart()`:
```typescript
// Old: if (game.players.length < MIN_PLAYERS)
// New:
const totalWithBots = game.players.length + (game.botCount ?? 0);
if (totalWithBots < MIN_PLAYERS) {
  return json({ type: 4, data: { content: `❌ Il faut au minimum ${MIN_PLAYERS} joueurs (humains + bots) pour lancer.`, flags: 64 } });
}
```

- [ ] **Step 9: Verify the worker builds**

Run: `cd worker && npx wrangler deploy --dry-run 2>&1 | tail -20`

- [ ] **Step 10: Commit**

```bash
git add worker/index.ts worker/bot-personalities.ts
git commit -m "feat(bots): KV storage, lobby display, auto-fill, and join slot management"
```

---

## Chunk 2: Role Assignment & Night Phase Integration

### Task 4: Modify assignRoles for Human Priority

**Files:**
- Modify: `worker/index.ts` (assignRoles function, startGame call site)

- [ ] **Step 1: Change assignRoles signature and logic**

Replace the `assignRoles` function in `worker/index.ts` (lines 350-378):

```typescript
function assignRoles(
  humanIds: string[],
  botIds: string[],
  selectedRoleIds?: number[],
): Record<string, string> {
  const totalCount = humanIds.length + botIds.length;
  let roleKeys: string[];

  if (selectedRoleIds?.length) {
    roleKeys = selectedRoleIds.map(roleIdToKey);
    while (roleKeys.length < totalCount) roleKeys.push("villageois");
    while (roleKeys.length > totalCount) {
      const lastVillageois = roleKeys.lastIndexOf("villageois");
      if (lastVillageois !== -1) roleKeys.splice(lastVillageois, 1);
      else break;
    }
    roleKeys.length = totalCount;
  } else {
    roleKeys = ["loup", "loup", "sorciere", "cupidon"];
    for (let i = roleKeys.length; i < totalCount; i++) roleKeys.push("villageois");
  }

  // Separate special roles (not loup, not villageois) — these go to humans
  const specialRoles: string[] = [];
  const simpleRoles: string[] = [];
  for (const r of roleKeys) {
    if (r !== "loup" && r !== "villageois") specialRoles.push(r);
    else simpleRoles.push(r);
  }

  // Shuffle both pools
  const shuffle = (arr: string[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(secureRandom() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
  };
  shuffle(specialRoles);
  shuffle(simpleRoles);

  // Assign special roles to humans first
  const roles: Record<string, string> = {};
  let humanIdx = 0;

  for (const role of specialRoles) {
    if (humanIdx < humanIds.length) {
      roles[humanIds[humanIdx]!] = role;
      humanIdx++;
    }
    // If more special roles than humans (unlikely), they spill to bots
  }

  // Remaining humans + all bots get simple roles (loup/villageois)
  const remaining = [
    ...humanIds.filter((id) => !roles[id]),
    ...botIds,
  ];
  shuffle(remaining);

  for (let i = 0; i < remaining.length; i++) {
    roles[remaining[i]!] = simpleRoles[i] ?? "villageois";
  }

  return roles;
}
```

- [ ] **Step 2: Update the call site in startGame**

In `startGame()` (~line 1258), change:

```typescript
// Old:
// const roleKeys = assignRoles(game.players.length, game.selectedRoleIds);
// const rolesMap: Record<string, string> = {};
// game.players.forEach((id, i) => { rolesMap[id] = roleKeys[i]!; });
// game.roles = rolesMap;

// New:
const bots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
const botIds = bots.map((b) => b.id);
game.roles = assignRoles(game.players, botIds, game.selectedRoleIds);
```

Also update the role check embed and role count display to include bot count:

```typescript
// In the "distributing roles" embed description:
`**${game.players.length + botIds.length} cartes** sont distribuées face cachée...`,
```

- [ ] **Step 3: Skip role reveal for bots — auto-mark as "seen"**

In `startGame()`, after assigning roles, auto-mark all bots as having seen their role:

```typescript
game.seen = [...botIds]; // Bots "see" their role instantly
```

This way the role check embed only waits for humans to click "Voir mon rôle".

- [ ] **Step 4: Verify the worker builds**

Run: `cd worker && npx wrangler deploy --dry-run 2>&1 | tail -20`

- [ ] **Step 5: Commit**

```bash
git add worker/index.ts
git commit -m "feat(bots): role assignment with human priority for special roles"
```

---

### Task 5: Bot Orchestrator — Core Decision Engine

**Files:**
- Create: `worker/bot-orchestrator.ts`

- [ ] **Step 1: Create bot-orchestrator.ts**

```typescript
// worker/bot-orchestrator.ts

import type { BotPlayer } from "./index"; // We'll export BotPlayer from index

export interface BotDecisionRequest {
  bot: BotPlayer;
  role: string;
  phase: "night_vote" | "day_discussion" | "day_vote";
  alivePlayers: { id: string; name: string }[];
  aliveHumans: { id: string; name: string }[];
  aliveBots: BotPlayer[];
  gameHistory: string[];
  knownInfo: string; // role-specific info (wolf teammates, etc.)
}

export interface BotDecisionResult {
  action: string; // target player/bot id, or "skip"
  message: string; // French message to post
}

/** Build the LLM prompt for a bot decision */
export function buildBotPrompt(req: BotDecisionRequest): string {
  const phaseLabels: Record<string, string> = {
    night_vote: "VOTE DE NUIT (tu es loup-garou, choisis une victime)",
    day_discussion: "DISCUSSION DE JOUR (argumente, accuse, défends)",
    day_vote: "VOTE DE JOUR (vote pour éliminer quelqu'un)",
  };

  const allAlive = [
    ...req.aliveHumans.map((p) => p.name),
    ...req.aliveBots.filter((b) => b.id !== req.bot.id).map((b) => `${b.name} (Bot)`),
  ];

  let strategyRules: string;
  if (req.role === "loup") {
    strategyRules = [
      "- Tu es un LOUP-GAROU. Ton objectif: éliminer les villageois sans te faire repérer.",
      "- De jour, ne vote JAMAIS contre un autre loup. Accuse des innocents.",
      "- Si on t'accuse, défends-toi calmement. Ne surréagis pas.",
      "- De nuit, choisis stratégiquement la cible la plus dangereuse pour les loups.",
    ].join("\n");
  } else {
    strategyRules = [
      "- Tu es un VILLAGEOIS. Ton objectif: identifier et éliminer les loups-garous.",
      "- Analyse les patterns de vote: qui protège qui? Qui vote toujours ensemble?",
      "- Relève les contradictions dans les arguments des autres.",
      "- Si tu n'as pas de conviction forte, suis la majorité.",
    ].join("\n");
  }

  return [
    `Tu es ${req.bot.name}, un joueur de Loup-Garou.`,
    `Personnalité: ${req.bot.traits.join(", ")}.`,
    `Ton rôle SECRET: ${req.role === "loup" ? "Loup-Garou 🐺" : "Villageois 🏘️"}.`,
    "",
    `PHASE: ${phaseLabels[req.phase] ?? req.phase}`,
    `Joueurs vivants: ${allAlive.join(", ")}`,
    "",
    req.gameHistory.length > 0
      ? `HISTORIQUE:\n${req.gameHistory.join("\n")}`
      : "HISTORIQUE: Début de partie, aucun événement encore.",
    "",
    req.knownInfo ? `INFO SECRÈTE: ${req.knownInfo}` : "",
    "",
    "RÈGLES DE COMPORTEMENT:",
    strategyRules,
    "- Ton message fait 1-2 phrases MAX. Français familier, pas formel.",
    "- Ne révèle JAMAIS ton rôle directement.",
    "- Ne dis pas que tu es un bot ou une IA.",
    "",
    req.phase === "day_discussion"
      ? "Réponds avec UNIQUEMENT ton argument/accusation/défense. Pas de vote."
      : `Réponds en JSON: { "target": "<nom du joueur ciblé>", "message": "<ton argument>" }`,
  ].filter(Boolean).join("\n");
}

/** Calculate random delay within a phase (10-70% of duration) */
export function botDelay(phaseDurationSeconds: number): number {
  const minPct = 0.10;
  const maxPct = 0.70;
  const pct = minPct + Math.random() * (maxPct - minPct);
  return Math.floor(pct * phaseDurationSeconds * 1000); // ms
}

/** Determine if a bot speaks during discussion (60-80% chance) */
export function botSpeaks(): boolean {
  return Math.random() < 0.7; // 70% average
}

/** Fallback decision when LLM call fails */
export function fallbackDecision(
  alivePlayers: { id: string; name: string }[],
  botId: string,
): BotDecisionResult {
  const targets = alivePlayers.filter((p) => p.id !== botId);
  const target = targets[Math.floor(Math.random() * targets.length)];
  return {
    action: target?.id ?? "skip",
    message: `Hmm... je vote pour ${target?.name ?? "personne"}.`,
  };
}

// ── Game History KV helpers ──

export async function loadHistory(kv: KVNamespace, gameNumber: number): Promise<string[]> {
  const val = await kv.get(`game:${gameNumber}:history`);
  if (!val) return [];
  try { return JSON.parse(val); } catch { return []; }
}

export async function appendHistory(kv: KVNamespace, gameNumber: number, event: string) {
  const history = await loadHistory(kv, gameNumber);
  history.push(event);
  await kv.put(`game:${gameNumber}:history`, JSON.stringify(history), { expirationTtl: 86400 });
}
```

- [ ] **Step 2: Move BotPlayer interface to bot-personalities.ts to avoid circular imports**

The orchestrator needs `BotPlayer`, and `index.ts` imports from the orchestrator. To avoid circular imports, define `BotPlayer` in `bot-personalities.ts` and import it in both files.

Add to `worker/bot-personalities.ts`:

```typescript
export interface BotPlayer {
  id: string;
  name: string;
  traits: string[];
  emoji: string;
  alive: boolean;
}
```

In `worker/index.ts`, change to: `import { type BotPlayer, pickBots } from "./bot-personalities";` and remove the local `BotPlayer` interface.

In `worker/bot-orchestrator.ts`, change to: `import type { BotPlayer } from "./bot-personalities";`

- [ ] **Step 3: Commit**

```bash
git add worker/bot-orchestrator.ts worker/index.ts
git commit -m "feat(bots): bot orchestrator with prompt builder, delay logic, and KV history"
```

---

### Task 6: Integrate Bots into Night Phase

**Files:**
- Modify: `worker/index.ts` (startNightPhase, buildVoteEmbed, resolveNightVote)

This is the core integration — bots that are wolves vote during the night phase.

- [ ] **Step 0: Add `env` parameter to `resolveNightVote` and all call sites**

`resolveNightVote` currently has no access to `env` (for KV). We need it for bot death tracking and game history. Update:

1. Change signature: `async function resolveNightVote(token: string, vote: VoteState, voteMessageId: string, env: Env)`
2. Update call in `phaseVoteTimer` (line 1646): add `env` parameter. `phaseVoteTimer` already receives `env`.
3. Update call in `handleVoteKill` (line 1767): add `env`. `handleVoteKill` already has `env`.
4. Update call in the new `executeBotWolfVote` (Step 3 below): pass `env`.

- [ ] **Step 1: Import bot-orchestrator in index.ts**

```typescript
import {
  buildBotPrompt,
  botDelay,
  fallbackDecision,
  loadHistory,
  appendHistory,
  type BotDecisionRequest,
  type BotDecisionResult,
} from "./bot-orchestrator";
```

- [ ] **Step 2: Add a generic LLM call function**

Since the ADK converse API integration is complex and latency-sensitive, start with the **direct LLM fallback** as the primary method for MVP. The ADK integration can be layered on later.

Add to `worker/index.ts`:

```typescript
async function callLLM(prompt: string, env: Env): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout
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
```

Add `ANTHROPIC_API_KEY: string` to the `Env` interface. The function should use `env.ANTHROPIC_API_KEY`.

**Note:** Make `callLLM` accept `env` as parameter to access the key.

- [ ] **Step 3: Add bot vote execution function**

```typescript
async function executeBotWolfVote(
  token: string,
  env: Env,
  bot: BotPlayer,
  allBots: BotPlayer[],
  wolfChannelId: string,
  voteMessageId: string,
  gameNumber: number,
): Promise<void> {
  // IMPORTANT: Re-read VoteState from embed to avoid race conditions
  // (multiple bot votes + human votes all modify the same embed)
  const currentMsg: any = await getMessage(token, wolfChannelId, voteMessageId);
  if (!currentMsg.components?.length) return; // Already resolved
  const voteState = parseVoteFromEmbed(currentMsg);
  if (!voteState) return;

  const gameHistory = await loadHistory(env.ACTIVE_PLAYERS, gameNumber);

  // Build known info for wolf: list wolf teammates
  const wolfBots = allBots.filter((b) => b.alive && voteState.wolves.includes(b.id));
  const knownInfo = wolfBots.length > 0
    ? `Tes alliés loups: ${wolfBots.filter((b) => b.id !== bot.id).map((b) => b.name).join(", ")}`
    : "";

  const req: BotDecisionRequest = {
    bot,
    role: "loup",
    phase: "night_vote",
    alivePlayers: voteState.targets,
    aliveHumans: voteState.targets.filter((t) => !t.id.startsWith("bot_")),
    aliveBots: allBots.filter((b) => b.alive),
    gameHistory,
    knownInfo,
  };

  let decision: BotDecisionResult;
  try {
    const prompt = buildBotPrompt(req);
    const llmResponse = await callLLM(prompt, env);
    const parsed = JSON.parse(llmResponse.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    const targetName = parsed.target ?? "";
    const target = voteState.targets.find((t) =>
      t.name.toLowerCase().includes(targetName.toLowerCase())
    );
    decision = {
      action: target?.id ?? voteState.targets[0]?.id ?? "skip",
      message: parsed.message ?? `Je vote pour ${target?.name ?? "quelqu'un"}.`,
    };
  } catch {
    decision = fallbackDecision(voteState.targets, bot.id);
  }

  // Apply vote to the freshly-read VoteState
  voteState.votes[bot.id] = decision.action;

  // Post bot message in wolf thread
  await sendMessage(token, wolfChannelId, {
    content: `🤖 **${bot.name}** : "${decision.message}"`,
  });

  // Update vote embed with new state
  await editMessage(token, wolfChannelId, voteMessageId, buildVoteEmbed(voteState));

  // Check unanimous
  const allVoted = voteState.wolves.every((wId) => voteState.votes[wId]);
  const allSameTarget = allVoted && new Set(Object.values(voteState.votes)).size === 1;
  if (allSameTarget) {
    await resolveNightVote(token, voteState, voteMessageId, env);
  }
}
```

- [ ] **Step 4: Modify startNightPhase to include bot wolves**

In `startNightPhase()`, after computing `wolfIds` from human players, also include bot wolves:

```typescript
const bots = await loadBots(env.ACTIVE_PLAYERS, game.gameNumber);
const botWolfIds = bots
  .filter((b) => b.alive && game.roles?.[b.id] === "loup")
  .map((b) => b.id);
const allWolfIds = [...wolfIds, ...botWolfIds];
```

Use `allWolfIds` instead of `wolfIds` when building VoteState:

```typescript
const voteState: VoteState = {
  // ...
  wolves: allWolfIds,
  // ...
};
```

Only add **human** wolves to the Discord thread (bots don't need thread access):

```typescript
for (const wolfId of wolfIds) { // human wolves only
  await addThreadMember(token, wolfThread.id, wolfId);
}
```

After sending the vote embed, schedule bot wolf votes with delays:

```typescript
// Schedule bot wolf votes (each re-reads VoteState from embed to avoid races)
for (const botWolf of bots.filter((b) => b.alive && botWolfIds.includes(b.id))) {
  const delay = botDelay(NIGHT_VOTE_SECONDS);
  ctx.waitUntil(
    sleep(delay).then(() =>
      executeBotWolfVote(token, env, botWolf, bots, wolfThread.id, voteMsg.id, game.gameNumber)
    )
  );
}
```

- [ ] **Step 5: Update buildVoteEmbed to show bot wolves**

In `buildVoteEmbed()`, the vote lines show `<@${wId}>` for each wolf. For bot wolves (IDs starting with `bot_`), display the bot name instead:

```typescript
const voteLines = vote.wolves.map((wId) => {
  const targetId = vote.votes[wId];
  const target = targetId ? vote.targets.find((t) => t.id === targetId) : null;
  const wolfLabel = wId.startsWith("bot_") ? `🤖 **${wId}**` : `🐺 <@${wId}>`;
  return `${wolfLabel} → ${target ? `**${target.name}**` : "*(en attente...)*"}`;
});
```

Note: The bot name isn't available in VoteState. Either add a `botNames` map to VoteState, or use the bot ID for now and resolve names from KV. Simplest: add `wolfNames: Record<string, string>` to VoteState.

Add `wolfNames?: Record<string, string>` to VoteState interface and populate it in `startNightPhase`:

```typescript
const wolfNames: Record<string, string> = {};
for (const b of bots.filter((b) => botWolfIds.includes(b.id))) {
  wolfNames[b.id] = b.name;
}
```

Update buildVoteEmbed to use wolfNames:

```typescript
const wolfLabel = wId.startsWith("bot_")
  ? `🤖 **${vote.wolfNames?.[wId] ?? wId}**`
  : `🐺 <@${wId}>`;
```

- [ ] **Step 6: Update resolveNightVote to handle bot targets**

In `resolveNightVote()`, when a bot is the victim (if bots can be night targets — currently targets are non-wolves only, so bots that are villageois could be targets):

Check if the victim is a bot:

```typescript
const isBot = victimId.startsWith("bot_");
```

If bot: don't use `<@${victimId}>` (not a Discord user). Use the bot name from targets array:

```typescript
const victimDisplay = isBot ? `🤖 **${victim.name}**` : `**${victim.name}** (<@${victim.id}>)`;
```

Also mark the bot as dead in KV:

```typescript
if (isBot) {
  const bots = await loadBots(env.ACTIVE_PLAYERS, vote.gameNumber);
  const bot = bots.find((b) => b.id === victimId);
  if (bot) {
    bot.alive = false;
    await saveBots(env.ACTIVE_PLAYERS, vote.gameNumber, bots);
  }
}
```

- [ ] **Step 7: Include bots as potential night targets**

In `startNightPhase()`, currently targets are only human non-wolves. Add bot non-wolves:

```typescript
// Human non-wolf targets
const humanTargetIds = game.players.filter((id) => !allWolfIds.includes(id));
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
```

- [ ] **Step 8: Add ANTHROPIC_API_KEY to Env and wrangler config**

Add `ANTHROPIC_API_KEY: string` to the `Env` interface in `worker/index.ts`.

For deployment, the key will be set as a Cloudflare Worker secret:
```bash
wrangler secret put ANTHROPIC_API_KEY
```

- [ ] **Step 9: Append night result to game history**

In `resolveNightVote()`, after announcing the victim, append to history:

```typescript
await appendHistory(
  env.ACTIVE_PLAYERS, // Need to pass env to resolveNightVote
  vote.gameNumber,
  `Nuit: ${victim.name} a été dévoré(e) par les loups-garous`,
);
```

Note: `resolveNightVote` currently doesn't receive `env`. Add it as a parameter and update all call sites.

- [ ] **Step 10: Verify the worker builds**

Run: `cd worker && npx wrangler deploy --dry-run 2>&1 | tail -20`

- [ ] **Step 11: Commit**

```bash
git add worker/index.ts worker/bot-orchestrator.ts
git commit -m "feat(bots): integrate bot wolves into night vote phase with LLM decisions"
```

---

## Chunk 3: ADK Tool & Testing

### Task 7: Botpress ADK Tool (bot-decision)

**Files:**
- Create: `src/tools/bot-decision.ts`
- Create: `src/tools/index.ts`

This is the ADK-side tool for future integration via the converse API. For MVP, the Worker calls the LLM directly (Task 6), but this tool prepares the ADK path.

- [ ] **Step 1: Create src/tools/index.ts**

```typescript
// src/tools/index.ts
export { default as botDecision } from "./bot-decision";
```

- [ ] **Step 2: Create src/tools/bot-decision.ts**

```typescript
// src/tools/bot-decision.ts
import { Tool } from "@botpress/runtime";
import { z } from "zod";

export default new Tool({
  name: "botDecision",
  description: "Generates an AI bot player decision for a Loup-Garou game phase",
  input: z.object({
    botName: z.string().describe("Name of the bot player"),
    botTraits: z.array(z.string()).describe("Personality traits"),
    botRole: z.string().describe("Game role key (loup or villageois)"),
    phase: z.enum(["night_vote", "day_discussion", "day_vote"]),
    alivePlayers: z.array(z.string()).describe("Names of alive players"),
    gameHistory: z.array(z.string()).describe("Game events so far"),
    knownInfo: z.string().optional().describe("Role-specific secret info"),
  }),
  output: z.object({
    action: z.string().describe("Target player name or 'skip'"),
    message: z.string().describe("Bot's message in French"),
  }),
  handler: async ({ input, execute }) => {
    const phaseLabel =
      input.phase === "night_vote" ? "vote de nuit (loup-garou)"
      : input.phase === "day_discussion" ? "discussion de jour"
      : "vote de jour";

    const result = await execute({
      instructions: [
        `Tu es ${input.botName}, un joueur de Loup-Garou.`,
        `Personnalité: ${input.botTraits.join(", ")}.`,
        `Ton rôle: ${input.botRole === "loup" ? "Loup-Garou" : "Villageois"}.`,
        `Phase: ${phaseLabel}.`,
        `Joueurs vivants: ${input.alivePlayers.join(", ")}.`,
        input.gameHistory.length > 0
          ? `Historique: ${input.gameHistory.join(" | ")}`
          : "",
        input.knownInfo ?? "",
        "",
        "Réponds en 1-2 phrases. Français familier. Ne révèle pas ton rôle.",
        input.phase !== "day_discussion"
          ? `Choisis un joueur à cibler parmi: ${input.alivePlayers.join(", ")}`
          : "Donne ton opinion/accusation/défense.",
      ].filter(Boolean).join("\n"),
    });

    // Parse the LLM response
    const text = typeof result === "string" ? result : String(result);
    const targetMatch = input.alivePlayers.find((name) =>
      text.toLowerCase().includes(name.toLowerCase())
    );

    return {
      action: targetMatch ?? "skip",
      message: text.slice(0, 200), // Cap length
    };
  },
});
```

- [ ] **Step 3: Verify ADK builds**

Run: `cd /Users/tonyboudreau/Documents/Dev/bp-hacks-2026 && pnpm run build 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add src/tools/bot-decision.ts src/tools/index.ts
git commit -m "feat(bots): add botDecision ADK tool for future converse API integration"
```

---

### Task 8: Manual Testing & Polish

**Files:**
- Modify: `worker/index.ts` (minor fixes from testing)

- [ ] **Step 1: Deploy worker for testing**

```bash
cd worker && wrangler deploy
wrangler secret put ANTHROPIC_API_KEY
```

- [ ] **Step 2: Test game creation with bots**

1. Run `/loupgarou` in Discord
2. In step 2, select "2 bots" from the bot selector
3. Click "Créer la partie"
4. Verify lobby shows bots with 🤖 emoji
5. Verify human join slots are correctly limited

- [ ] **Step 3: Test game start with bots**

1. Have 2 humans join
2. Click "Lancer"
3. Verify role distribution includes bot IDs
4. Verify bots are auto-marked as "seen" in role check
5. Verify night phase starts after humans see their roles

- [ ] **Step 4: Test bot wolf voting**

1. Start a game where at least 1 bot is a wolf
2. Verify bot wolf posts a vote message in the wolf thread after a random delay
3. Verify the vote embed updates with the bot's vote
4. Verify unanimous resolution works with bot + human wolves

- [ ] **Step 5: Test auto-fill**

1. Create a game with 0 bots configured
2. Have only 2 humans join
3. Click "Lancer" — verify bots are auto-added to reach 4 players
4. Verify the game proceeds normally

- [ ] **Step 6: Fix any issues found during testing**

Address bugs and edge cases. Common issues to watch for:
- Bot IDs in Discord mentions (`<@bot_1>` won't resolve — use name instead)
- VoteState URL size with many bots
- Race conditions between bot vote scheduling and timer resolution
- `callLLM` timeout handling (add AbortController with 10s timeout)

- [ ] **Step 7: Commit all fixes**

```bash
git add -A
git commit -m "fix(bots): testing fixes and polish for bot player integration"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| **1: Data Layer** | Tasks 1-3 | Bot personalities, GameState/ConfigState changes, KV storage, lobby display, auto-fill |
| **2: Game Integration** | Tasks 4-6 | Role assignment with human priority, bot orchestrator, night phase bot voting |
| **3: ADK & Testing** | Tasks 7-8 | ADK tool for future converse API, manual testing and polish |

**Total new files:** 3 (`bot-personalities.ts`, `bot-orchestrator.ts`, `src/tools/bot-decision.ts` + `index.ts`)
**Total modified files:** 2 (`worker/index.ts`, `worker/config-embed.ts`)
**Estimated commits:** 7
