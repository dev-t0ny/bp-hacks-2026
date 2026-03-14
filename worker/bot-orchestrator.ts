import type { BotPlayer } from "./bot-personalities";

export interface BotDecisionRequest {
  bot: BotPlayer;
  role: string;
  phase: "night_vote" | "day_discussion" | "day_vote";
  alivePlayers: { id: string; name: string }[];
  aliveHumans: { id: string; name: string }[];
  aliveBots: BotPlayer[];
  gameHistory: string[];
  knownInfo: string;
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
  return Math.floor(pct * phaseDurationSeconds * 1000);
}

/** Determine if a bot speaks during discussion (60-80% chance) */
export function botSpeaks(): boolean {
  return Math.random() < 0.7;
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
