import type { BotPlayer } from "./bot-personalities";

// ── Bot Memory ──────────────────────────────────────────────────────

export interface BotMemory {
  role: string;
  knownWolves: string[];
  knownInnocents: string[];
  couplePartner?: string;
  voyanteResults: { name: string; role: string }[];
  wolfVictimLastNight?: string;
  discussionNotes: string[];
  wolfChatMessages: string[];
  roleSpecific: Record<string, unknown>;
}

const BOT_MEM_TTL = 86400;

export async function loadBotMemory(kv: KVNamespace, gameNumber: number, botId: string): Promise<BotMemory> {
  const val = await kv.get(`game:${gameNumber}:botmem:${botId}`);
  if (!val) return emptyMemory("villageois");
  try { return JSON.parse(val); } catch { return emptyMemory("villageois"); }
}

export async function saveBotMemory(kv: KVNamespace, gameNumber: number, botId: string, mem: BotMemory) {
  await kv.put(`game:${gameNumber}:botmem:${botId}`, JSON.stringify(mem), { expirationTtl: BOT_MEM_TTL });
}

export function initBotMemory(role: string): BotMemory {
  return emptyMemory(role);
}

function emptyMemory(role: string): BotMemory {
  return {
    role,
    knownWolves: [],
    knownInnocents: [],
    voyanteResults: [],
    discussionNotes: [],
    wolfChatMessages: [],
    roleSpecific: {},
  };
}

// ── Role Strategy Registry (data-driven, extensible) ────────────────

export interface RoleStrategy {
  team: "village" | "loups" | "solo";
  roleName: string;
  dayStrategy: string;
  specialPhases?: string[];
  phaseInstructions?: Record<string, string>;
}

export const ROLE_STRATEGIES: Record<string, RoleStrategy> = {
  loup: {
    team: "loups",
    roleName: "Loup-Garou 🐺",
    dayStrategy: [
      "- Tu es un LOUP-GAROU. Ton objectif: éliminer les villageois sans te faire repérer.",
      "- De jour, ne vote JAMAIS contre un autre loup. Accuse des innocents.",
      "- Si on t'accuse, défends-toi calmement. Ne surréagis pas.",
      "- De nuit, choisis stratégiquement la cible la plus dangereuse pour les loups (voyante, chasseur...).",
    ].join("\n"),
    specialPhases: ["night_vote"],
    phaseInstructions: {
      night_vote: "Choisis la victime la plus dangereuse pour les loups. La voyante ou le chasseur sont prioritaires si tu les suspectes. Coordonne-toi avec les autres loups.",
    },
  },
  villageois: {
    team: "village",
    roleName: "Villageois 🏘️",
    dayStrategy: [
      "- Tu es un VILLAGEOIS. Ton objectif: identifier et éliminer les loups-garous.",
      "- Analyse les patterns de vote: qui protège qui? Qui vote toujours ensemble?",
      "- Relève les contradictions dans les arguments des autres.",
      "- Si tu n'as pas de conviction forte, suis la majorité.",
    ].join("\n"),
  },
  voyante: {
    team: "village",
    roleName: "Voyante 🔮",
    dayStrategy: [
      "- Tu es la VOYANTE. Tu peux espionner un joueur chaque nuit.",
      "- Si tu as vu un loup → accuse-le avec conviction mais sans révéler ton rôle directement!",
      "- Si tu as vu un innocent → défends-le subtilement.",
      "- Ne dis JAMAIS que tu es voyante directement, ça te mettrait en danger.",
      "- Utilise tes infos pour orienter les votes sans te griller.",
    ].join("\n"),
    specialPhases: ["voyante_spy"],
    phaseInstructions: {
      voyante_spy: "Choisis qui espionner. Priorise les joueurs inconnus ou ceux que tu suspectes. Évite de re-espionner quelqu'un déjà vérifié.",
    },
  },
  sorciere: {
    team: "village",
    roleName: "Sorcière 🧪",
    dayStrategy: [
      "- Tu es la SORCIÈRE. Tu connais la victime des loups et tu as des potions.",
      "- En discussion, joue comme un villageois informé mais discret.",
      "- Si tu as sauvé quelqu'un, tu sais qu'il est innocent — utilise cette info subtilement.",
      "- Garde tes potions pour les moments critiques.",
    ].join("\n"),
    specialPhases: ["sorciere_potion"],
    phaseInstructions: {
      sorciere_potion: "Décide: sauver la victime (potion de vie), empoisonner un suspect (potion de mort), ou ne rien faire. Sauve si la victime est précieuse (voyante, chasseur). Empoisonne si tu es quasi-sûr(e) qu'un joueur est loup.",
    },
  },
  cupidon: {
    team: "village",
    roleName: "Cupidon 💘",
    dayStrategy: [
      "- Tu es CUPIDON. Tu as lié deux joueurs par l'amour.",
      "- Protège ton partenaire subtilement, ne le vote JAMAIS.",
      "- Si ton partenaire est accusé, défends-le sans trop en faire.",
      "- Attention: si ton partenaire meurt, tu meurs aussi!",
    ].join("\n"),
    specialPhases: ["cupidon_pick"],
    phaseInstructions: {
      cupidon_pick: "Choisis deux joueurs à lier. Stratégies possibles: te choisir toi-même + un allié pour te protéger, ou créer du drama (un loup + un villageois), ou lier deux joueurs forts.",
    },
  },
  chasseur: {
    team: "village",
    roleName: "Chasseur 🏹",
    dayStrategy: [
      "- Tu es le CHASSEUR. Quand tu meurs, tu tires sur quelqu'un.",
      "- Analyse les patterns, note tes suspects. À ta mort, tu vises ton #1 suspect.",
      "- Sois actif dans les discussions pour récolter un max d'infos.",
      "- Tu es précieux — évite de te faire éliminer trop tôt.",
    ].join("\n"),
    specialPhases: ["chasseur_shoot"],
    phaseInstructions: {
      chasseur_shoot: "Tu meurs! Tire ta dernière flèche. Utilise toute ta mémoire (votes suspects, contradictions, infos voyante) pour viser le joueur le plus probablement loup.",
    },
  },
  loup_blanc: {
    team: "solo",
    roleName: "Loup-Garou Blanc ⚪🐺",
    dayStrategy: [
      "- Tu es le LOUP-GAROU BLANC. Tu joues avec les loups MAIS tu veux gagner seul.",
      "- De jour, blend in comme un villageois. Manipule les deux camps.",
      "- Ne vote pas contre les loups trop tôt — tu as besoin d'eux pour éliminer les villageois.",
      "- La nuit, tu peux éliminer un loup. Fais-le quand il y a peu de villageois restants.",
    ].join("\n"),
    specialPhases: ["night_vote", "loup_blanc_kill"],
    phaseInstructions: {
      night_vote: "Comme les loups, choisis une victime villageoise. Joue le jeu pour l'instant.",
      loup_blanc_kill: "Choisis: tuer un loup ou passer. Tue si tu peux gagner bientôt (peu de joueurs restants). Skip si tu as encore besoin de la meute.",
    },
  },
  petite_fille: {
    team: "village",
    roleName: "Petite Fille 👧",
    dayStrategy: [
      "- Tu es la PETITE FILLE. Tu espionnes les loups la nuit!",
      "- Tu as entendu ce que les loups ont dit — utilise ces infos SUBTILEMENT.",
      "- Ne dis JAMAIS que tu es la petite fille, sinon les loups te tueront!",
      "- Oriente les soupçons vers les loups que tu as identifiés, sans révéler ta source.",
      "- Dis des choses comme 'j'ai un feeling' ou 'quelque chose me dit que...'",
    ].join("\n"),
  },
};

// ── Expanded BotDecisionRequest ─────────────────────────────────────

export type BotPhase =
  | "night_vote" | "day_discussion" | "day_vote"
  | "voyante_spy" | "sorciere_potion" | "cupidon_pick"
  | "chasseur_shoot" | "loup_blanc_kill";

export interface BotDecisionRequest {
  bot: BotPlayer;
  role: string;
  phase: BotPhase;
  alivePlayers: { id: string; name: string }[];
  aliveHumans: { id: string; name: string }[];
  aliveBots: BotPlayer[];
  gameHistory: string[];
  knownInfo: string;
  botMemory?: BotMemory;
  extraContext?: string;
  targetOptions?: { id: string; name: string }[];
  recentMessages?: string[];
}

export interface BotDecisionResult {
  action: string;
  message: string;
}

// ── Prompt Builder ──────────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  night_vote: "VOTE DE NUIT (choisis une victime à dévorer)",
  day_discussion: "DISCUSSION DE JOUR (argumente, accuse, défends)",
  day_vote: "VOTE DE JOUR (vote pour éliminer quelqu'un)",
  voyante_spy: "VOYANTE — Choisis qui espionner cette nuit",
  sorciere_potion: "SORCIÈRE — Utilise tes potions ou passe",
  cupidon_pick: "CUPIDON — Choisis deux joueurs à lier par l'amour",
  chasseur_shoot: "CHASSEUR — Dernière flèche! Tire sur quelqu'un",
  loup_blanc_kill: "LOUP BLANC — Éliminer un loup ou passer?",
};

const OUTPUT_FORMATS: Record<string, string> = {
  day_discussion: "Réponds avec UNIQUEMENT ton argument/accusation/défense en 1-2 phrases. Pas de JSON.",
  night_vote: 'Réponds en JSON UNIQUEMENT: { "target": "<nom exact>", "message": "<ton commentaire>" }',
  day_vote: 'Réponds en JSON UNIQUEMENT: { "target": "<nom exact>", "message": "<ton argument>" }',
  voyante_spy: 'Réponds en JSON UNIQUEMENT: { "target": "<nom exact>" }',
  sorciere_potion: 'Réponds en JSON UNIQUEMENT: { "action": "save" | "kill" | "skip", "target": "<nom exact si action=kill>" }',
  cupidon_pick: 'Réponds en JSON UNIQUEMENT: { "target1": "<nom exact>", "target2": "<nom exact>" }',
  chasseur_shoot: 'Réponds en JSON UNIQUEMENT: { "target": "<nom exact>" }',
  loup_blanc_kill: 'Réponds en JSON UNIQUEMENT: { "action": "kill" | "skip", "target": "<nom exact si kill>" }',
};

export function buildBotPrompt(req: BotDecisionRequest): string {
  const strategy = ROLE_STRATEGIES[req.role] ?? ROLE_STRATEGIES.villageois!;

  const allAlive = req.alivePlayers
    .filter((p) => p.id !== req.bot.id)
    .map((p) => p.name);

  // Build memory section
  const memSections: string[] = [];
  const mem = req.botMemory;
  if (mem) {
    if (mem.knownWolves.length > 0) {
      memSections.push(`🐺 Loups connus: ${mem.knownWolves.join(", ")}`);
    }
    if (mem.knownInnocents.length > 0) {
      memSections.push(`✅ Innocents confirmés: ${mem.knownInnocents.join(", ")}`);
    }
    if (mem.couplePartner) {
      memSections.push(`💘 Ton partenaire de couple: ${mem.couplePartner}`);
    }
    if (mem.voyanteResults.length > 0) {
      const results = mem.voyanteResults.map((r) => `${r.name} = ${r.role}`).join(", ");
      memSections.push(`🔮 Résultats voyante: ${results}`);
    }
    if (mem.wolfVictimLastNight) {
      memSections.push(`☠️ Victime des loups cette nuit: ${mem.wolfVictimLastNight}`);
    }
    if (mem.wolfChatMessages.length > 0) {
      memSections.push(`👂 Messages des loups interceptés:\n${mem.wolfChatMessages.slice(-10).join("\n")}`);
    }
    if (mem.discussionNotes.length > 0) {
      memSections.push(`📝 Notes: ${mem.discussionNotes.slice(-5).join(" | ")}`);
    }
  }

  // Phase-specific strategy (from registry)
  const phaseInstruction = strategy.phaseInstructions?.[req.phase] ?? "";

  // Target list for structured phases
  const targetList = req.targetOptions
    ? `\nCIBLES POSSIBLES: ${req.targetOptions.map((t) => t.name).join(", ")}`
    : allAlive.length > 0
      ? `\nJoueurs vivants: ${allAlive.join(", ")}`
      : "";

  return [
    `Tu es ${req.bot.name}, un joueur de Loup-Garou.`,
    `Personnalité: ${req.bot.traits.join(", ")}.`,
    `Ton rôle SECRET: ${strategy.roleName}.`,
    "",
    `PHASE: ${PHASE_LABELS[req.phase] ?? req.phase}`,
    targetList,
    "",
    req.gameHistory.length > 0
      ? `HISTORIQUE:\n${req.gameHistory.slice(-15).join("\n")}`
      : "HISTORIQUE: Début de partie, aucun événement encore.",
    "",
    memSections.length > 0
      ? `CONNAISSANCES SECRÈTES:\n${memSections.join("\n")}`
      : "",
    req.knownInfo ? `INFO SUPPLÉMENTAIRE: ${req.knownInfo}` : "",
    req.extraContext ? `CONTEXTE: ${req.extraContext}` : "",
    "",
    // Recent chat messages — critical for bots to react to conversation
    req.recentMessages?.length
      ? `MESSAGES RÉCENTS DU CHAT:\n${req.recentMessages.slice(-15).join("\n")}`
      : "",
    "",
    "RÈGLES DE COMPORTEMENT:",
    strategy.dayStrategy,
    phaseInstruction ? `\nINSTRUCTION PHASE: ${phaseInstruction}` : "",
    "- Ton message fait 1-2 phrases MAX. Français familier, pas formel.",
    "- Ne révèle JAMAIS ton rôle directement.",
    "- Ne dis pas que tu es un bot ou une IA.",
    "- BASE tes arguments sur ce que tu OBSERVES: les MESSAGES RÉCENTS, l'HISTORIQUE, et tes CONNAISSANCES SECRÈTES.",
    "- Tu PEUX avoir des intuitions et suspecter des gens — mais base-les sur des observations concrètes:",
    "  • Qui a voté pour qui? Qui a défendu qui? Qui est resté silencieux?",
    "  • Qui a changé d'avis? Qui accuse sans argument? Qui détourne l'attention?",
    "- Dis 'je trouve ça suspect que...' ou 'ça me semble louche' — PAS 'c'est un loup' (sauf si voyante et tu l'as vu).",
    "- N'invente PAS de faits (votes qui n'ont pas eu lieu, conversations imaginaires). Tes intuitions doivent venir de la partie réelle.",
    "- Si quelqu'un te parle ou t'accuse dans les messages récents, RÉPONDS-LUI directement.",
    "- Ne répète pas ce que d'autres ont déjà dit. Apporte un argument NOUVEAU ou rebondis sur ce qui a été dit.",
    "",
    OUTPUT_FORMATS[req.phase] ?? "",
  ].filter(Boolean).join("\n");
}

// ── Response Parser ─────────────────────────────────────────────────

export interface ParsedVoteResponse {
  target: string;
  message?: string;
}

export interface ParsedSorciereResponse {
  action: "save" | "kill" | "skip";
  target?: string;
}

export interface ParsedCupidonResponse {
  target1: string;
  target2: string;
}

export interface ParsedLoupBlancResponse {
  action: "kill" | "skip";
  target?: string;
}

function extractJSON(raw: string): any | null {
  // Try direct parse
  try { return JSON.parse(raw.trim()); } catch {}
  // Try extracting from markdown code blocks
  const blockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (blockMatch?.[1]) {
    try { return JSON.parse(blockMatch[1].trim()); } catch {}
  }
  // Try extracting first {...} block
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }
  return null;
}

function fuzzyMatchTarget(name: string, validTargets: { id: string; name: string }[]): { id: string; name: string } | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  // Exact match
  const exact = validTargets.find((t) => t.name.toLowerCase() === lower);
  if (exact) return exact;
  // startsWith match
  const starts = validTargets.find((t) => t.name.toLowerCase().startsWith(lower));
  if (starts) return starts;
  // Reverse startsWith
  const reverseStarts = validTargets.find((t) => lower.startsWith(t.name.toLowerCase()));
  if (reverseStarts) return reverseStarts;
  // Includes match
  const includes = validTargets.find((t) => t.name.toLowerCase().includes(lower) || lower.includes(t.name.toLowerCase()));
  if (includes) return includes;
  return null;
}

export function parseLLMResponse(
  raw: string,
  phase: BotPhase,
  validTargets: { id: string; name: string }[],
): BotDecisionResult | ParsedSorciereResponse | ParsedCupidonResponse | ParsedLoupBlancResponse | null {
  if (!raw || !raw.trim()) return null;

  // day_discussion → just return the text
  if (phase === "day_discussion") {
    const text = raw.trim().replace(/^["']|["']$/g, "");
    if (text.length > 0 && text.length < 500) {
      return { action: "discuss", message: text };
    }
    return null;
  }

  const json = extractJSON(raw);
  if (!json) return null;

  switch (phase) {
    case "night_vote":
    case "day_vote":
    case "chasseur_shoot":
    case "voyante_spy": {
      const targetName = json.target;
      if (!targetName) return null;
      const match = fuzzyMatchTarget(targetName, validTargets);
      if (!match) return null;
      return { action: match.id, message: json.message ?? `Je choisis ${match.name}.` };
    }

    case "sorciere_potion": {
      const action = json.action;
      if (!["save", "kill", "skip"].includes(action)) return null;
      if (action === "kill") {
        const target = json.target;
        if (!target) return null;
        const match = fuzzyMatchTarget(target, validTargets);
        if (!match) return null;
        return { action: "kill", target: match.id } as ParsedSorciereResponse;
      }
      return { action, target: json.target } as ParsedSorciereResponse;
    }

    case "cupidon_pick": {
      const t1 = json.target1;
      const t2 = json.target2;
      if (!t1 || !t2) return null;
      const m1 = fuzzyMatchTarget(t1, validTargets);
      const m2 = fuzzyMatchTarget(t2, validTargets);
      if (!m1 || !m2 || m1.id === m2.id) return null;
      return { target1: m1.id, target2: m2.id } as ParsedCupidonResponse;
    }

    case "loup_blanc_kill": {
      const action = json.action;
      if (!["kill", "skip"].includes(action)) return null;
      if (action === "kill") {
        const target = json.target;
        if (!target) return null;
        const match = fuzzyMatchTarget(target, validTargets);
        if (!match) return null;
        return { action: "kill", target: match.id } as ParsedLoupBlancResponse;
      }
      return { action: "skip" } as ParsedLoupBlancResponse;
    }
  }

  return null;
}

// ── Utilities ───────────────────────────────────────────────────────

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

/** Fallback discussion phrases */
export const FALLBACK_DISCUSSION_PHRASES = {
  wolf: [
    "Hmm, y'a quelqu'un de louche ici...",
    "Moi je dis qu'on devrait surveiller certains de plus près.",
    "J'ai rien vu de suspect mais j'ai un mauvais feeling.",
    "Perso je fais confiance à personne.",
    "C'est bizarre que personne n'accuse personne...",
    "Faut regarder les votes de la dernière fois.",
  ],
  village: [
    "Je suis pas sûr(e) mais quelqu'un agit bizarre non?",
    "Moi je suis innocent(e)! Regardez plutôt du côté des silencieux.",
    "Faisons attention, les loups sont parmi nous.",
    "Quelqu'un parle pas beaucoup... c'est suspect.",
    "Les gars, faut se réveiller!",
    "Honnêtement? J'ai des vibes de loup-garou sur certains.",
  ],
};

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

export async function clearGameHistory(kv: KVNamespace, gameNumber: number) {
  await kv.delete(`game:${gameNumber}:history`);
}
