import { t, type Locale } from "./i18n";

export interface BotPersonality {
  name: string;
  traits: string[];
  emoji: string;
  avatarUrl: string;
}

export interface BotPlayer {
  id: string;
  name: string;
  traits: string[];
  emoji: string;
  avatarUrl: string;
  alive: boolean;
}

function botAvatarUrl(name: string): string {
  return `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(name)}&size=128`;
}

export const BOT_POOL: BotPersonality[] = [
  { name: "Marcel", traits: ["méfiant", "direct"], emoji: "🧔", avatarUrl: botAvatarUrl("Marcel") },
  { name: "Sophie", traits: ["diplomatique", "observatrice"], emoji: "👩‍🦰", avatarUrl: botAvatarUrl("Sophie") },
  { name: "René", traits: ["impulsif", "drôle"], emoji: "🤡", avatarUrl: botAvatarUrl("René") },
  { name: "Colette", traits: ["prudente", "analytique"], emoji: "🧓", avatarUrl: botAvatarUrl("Colette") },
  { name: "Jacques", traits: ["confiant", "bavard"], emoji: "👨‍🦳", avatarUrl: botAvatarUrl("Jacques") },
  { name: "Marie", traits: ["silencieuse", "perspicace"], emoji: "👩", avatarUrl: botAvatarUrl("Marie") },
  { name: "François", traits: ["agressif", "soupçonneux"], emoji: "😤", avatarUrl: botAvatarUrl("François") },
  { name: "Isabelle", traits: ["calme", "stratège"], emoji: "🤔", avatarUrl: botAvatarUrl("Isabelle") },
  { name: "Pierre", traits: ["naïf", "enthousiaste"], emoji: "😊", avatarUrl: botAvatarUrl("Pierre") },
  { name: "Hélène", traits: ["sarcastique", "intelligente"], emoji: "😏", avatarUrl: botAvatarUrl("Hélène") },
  { name: "Antoine", traits: ["nerveux", "honnête"], emoji: "😰", avatarUrl: botAvatarUrl("Antoine") },
  { name: "Thérèse", traits: ["autoritaire", "protectrice"], emoji: "💪", avatarUrl: botAvatarUrl("Thérèse") },
  { name: "Lucien", traits: ["discret", "calculateur"], emoji: "🤫", avatarUrl: botAvatarUrl("Lucien") },
  { name: "Camille", traits: ["curieuse", "intuitive"], emoji: "🔍", avatarUrl: botAvatarUrl("Camille") },
  { name: "Gustave", traits: ["têtu", "loyal"], emoji: "🫡", avatarUrl: botAvatarUrl("Gustave") },
];

/** Pick `count` unique random bot personalities, localized */
export function pickBots(count: number, lang: Locale = "fr"): BotPersonality[] {
  const i18n = t(lang);
  const pool = BOT_POOL.map((bot, idx) => {
    const localName = i18n.botNames[idx] ?? bot.name;
    const localTraits = i18n.botTraits[localName] ?? bot.traits;
    return { name: localName, traits: localTraits, emoji: bot.emoji, avatarUrl: botAvatarUrl(localName) };
  });
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, pool.length));
}
