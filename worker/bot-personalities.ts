import { t, type Locale } from "./i18n";

export interface BotPersonality {
  name: string;
  traits: string[];
  emoji: string;
}

export interface BotPlayer {
  id: string;
  name: string;
  traits: string[];
  emoji: string;
  alive: boolean;
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

/** Pick `count` unique random bot personalities, localized */
export function pickBots(count: number, lang: Locale = "fr"): BotPersonality[] {
  const i18n = t(lang);
  const pool = BOT_POOL.map((bot, idx) => {
    const localName = i18n.botNames[idx] ?? bot.name;
    const localTraits = i18n.botTraits[localName] ?? bot.traits;
    return { name: localName, traits: localTraits, emoji: bot.emoji };
  });
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, pool.length));
}
