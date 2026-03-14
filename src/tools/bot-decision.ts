import { Autonomous, z } from "@botpress/runtime";

export default new Autonomous.Tool({
  name: "botDecision",
  description:
    "Prend une décision de jeu pour un bot IA dans une partie de Loup-Garou. " +
    "Reçoit le contexte du bot (personnalité, rôle, phase de jeu, joueurs vivants, historique) " +
    "et retourne un vote/cible + un message en français familier.",
  input: z.object({
    botName: z.string().describe("Nom du bot (ex: Marcel, Sophie)"),
    botTraits: z.array(z.string()).describe("Traits de personnalité du bot"),
    botRole: z.string().describe("Rôle secret du bot: 'loup' ou 'villageois'"),
    phase: z
      .enum(["night_vote", "day_discussion", "day_vote"])
      .describe("Phase de jeu en cours"),
    alivePlayers: z
      .array(z.string())
      .describe("Noms des joueurs vivants"),
    gameHistory: z
      .array(z.string())
      .describe("Historique des événements de la partie"),
    knownInfo: z
      .string()
      .optional()
      .describe("Information secrète liée au rôle du bot"),
  }),
  output: z.object({
    action: z
      .string()
      .describe("Nom du joueur ciblé, ou 'skip'"),
    message: z
      .string()
      .describe("Message du bot en français (1-2 phrases)"),
  }),
  handler: async (input, { execute }) => {
    const phaseLabels: Record<string, string> = {
      night_vote: "VOTE DE NUIT (tu es loup-garou, choisis une victime)",
      day_discussion: "DISCUSSION DE JOUR (argumente, accuse, défends)",
      day_vote: "VOTE DE JOUR (vote pour éliminer quelqu'un)",
    };

    let strategyRules: string;
    if (input.botRole === "loup") {
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

    const instructions = [
      `Tu es ${input.botName}, un joueur de Loup-Garou.`,
      `Personnalité: ${input.botTraits.join(", ")}.`,
      `Ton rôle SECRET: ${input.botRole === "loup" ? "Loup-Garou" : "Villageois"}.`,
      "",
      `PHASE: ${phaseLabels[input.phase] ?? input.phase}`,
      `Joueurs vivants: ${input.alivePlayers.join(", ")}`,
      "",
      input.gameHistory.length > 0
        ? `HISTORIQUE:\n${input.gameHistory.join("\n")}`
        : "HISTORIQUE: Début de partie, aucun événement encore.",
      "",
      input.knownInfo ? `INFO SECRÈTE: ${input.knownInfo}` : "",
      "",
      "RÈGLES DE COMPORTEMENT:",
      strategyRules,
      "- Ton message fait 1-2 phrases MAX. Français familier, pas formel.",
      "- Ne révèle JAMAIS ton rôle directement.",
      "- Ne dis pas que tu es un bot ou une IA.",
      "",
      input.phase === "day_discussion"
        ? 'Réponds avec UNIQUEMENT ton argument/accusation/défense. Pas de vote.'
        : 'Réponds en JSON: { "target": "<nom du joueur ciblé>", "message": "<ton argument>" }',
    ]
      .filter(Boolean)
      .join("\n");

    const result = await execute({
      instructions,
      input: `Fais ton choix pour cette phase: ${phaseLabels[input.phase] ?? input.phase}`,
    });

    if (input.phase === "day_discussion") {
      return {
        action: "skip",
        message: (result.output ?? "Hmm...").slice(0, 200),
      };
    }

    try {
      const jsonMatch = (result.output ?? "").match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          action: parsed.target ?? input.alivePlayers[0] ?? "skip",
          message: (parsed.message ?? "Je vote.").slice(0, 200),
        };
      }
    } catch {}

    return {
      action: input.alivePlayers[0] ?? "skip",
      message: "Hmm... je vote.",
    };
  },
});
