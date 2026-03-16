// game-logic.ts — Pure functions and constants for the Loup-Garou game engine.
// This file has NO imports from index.ts.

import { t, type Locale } from "./i18n";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EMBED_COLOR = 0x8b0000;
export const EMBED_COLOR_GREEN = 0x2ecc71;
export const EMBED_COLOR_ORANGE = 0xe67e22;
export const EMBED_COLOR_NIGHT = 0x0d1b2a;
export const EMBED_COLOR_PURPLE = 0x6c3483;

export const ASSET_BASE =
  "https://raw.githubusercontent.com/dev-t0ny/bp-hacks-2026/main/garou/assets";

export const SCENE_IMAGES = {
  game_start: `${ASSET_BASE}/scenes/game_start.png`,
  night_falls: `${ASSET_BASE}/scenes/night_falls.png`,
  dawn_breaks: `${ASSET_BASE}/scenes/dawn_breaks.png`,
  night_kill: `${ASSET_BASE}/scenes/night_kill.png`,
  day_elimination: `${ASSET_BASE}/scenes/day_elimination.png`,
  victory_wolves: `${ASSET_BASE}/scenes/victory_wolves.png`,
  victory_village: `${ASSET_BASE}/scenes/victory_village.png`,
  snipe_reveal: `${ASSET_BASE}/scenes/snipe_reveal.png`,
} as const;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 20;

// ---------------------------------------------------------------------------
// Role image helper
// ---------------------------------------------------------------------------

export function getRoleImage(roleKey: string): string {
  const roleImageMap: Record<string, string> = {
    // Villageois
    villageois: "villageois",
    voyante: "voyante",
    sorciere: "sorciere",
    chasseur: "chasseur",
    cupidon: "cupidon",
    petite_fille: "petite_fille",
    salvateur: "salvateur",
    ancien: "ancien",
    idiot_du_village: "idiot_du_village",
    bouc_emissaire: "bouc_emissaire",
    corbeau: "corbeau",
    renard: "renard",
    loup_blanc: "loup_garou_blanc",
    deux_soeurs: "deux_soeurs",
    trois_freres: "trois_freres",
    enfant_sauvage: "enfant_sauvage",
    servante_devouee: "servante_devouee",
    montreur_ours: "montreur_ours",
    comedien: "comedien",
    chevalier_epee_rouillee: "chevalier_epee_rouillee",
    juge_begue: "juge_begue",
    chien_loup: "chien_loup",
    voleur: "voleur",
    chaperon_rouge: "chaperon_rouge",
    mentaliste: "mentaliste",
    necromancien: "necromancien",
    fossoyeur: "fossoyeur",
    dictateur: "dictateur",
    pyromancien: "pyromancien",
    heritier: "heritier",
    chaman: "chaman",
    pretre: "pretre",
    garde_du_corps: "garde_du_corps",
    porteur_amulette: "porteur_amulette",
    tireur: "tireur",
    fille_de_joie: "fille_de_joie",
    mamie_grincheuse: "mamie_grincheuse",
    lepreux: "lepreux",
    savant_fou: "savant_fou",
    gros_dur: "gros_dur",
    humain_maudit: "humain_maudit",
    mystique: "mystique",
    president: "president",
    arnacoeur: "arnacoeur",
    fils_de_la_lune: "fils_de_la_lune",
    ankou: "ankou",
    marionnettiste: "marionnettiste",
    // Loups
    loup: "loup_garou",
    grand_mechant_loup: "grand_mechant_loup",
    infect_pere_des_loups: "infect_pere_des_loups",
    loup_noir: "loup_noir",
    loup_bavard: "loup_bavard",
    louveteau: "louveteau",
    cultiste: "cultiste",
    // Solitaires
    loup_garou_blanc: "loup_garou_blanc",
    joueur_de_flute: "joueur_de_flute",
    ange: "ange",
    abominable_sectaire: "abominable_sectaire",
    mercenaire: "mercenaire",
    nain_tracassin: "nain_tracassin",
    rat_malade: "rat_malade",
    tueur_en_serie: "tueur_en_serie",
    pyromane: "pyromane",
    lapin_blanc: "lapin_blanc",
  };
  const file = roleImageMap[roleKey] ?? "villageois";
  return `${ASSET_BASE}/roles/${file}.png`;
}

// ---------------------------------------------------------------------------
// Role definitions
// ---------------------------------------------------------------------------

export interface Role {
  name: string;
  emoji: string;
  team: "village" | "loups";
  description: string;
}

export const ROLES: Record<string, Role> = {
  loup: {
    name: "Loup-Garou",
    emoji: "\uD83D\uDC3A",
    team: "loups",
    description:
      "Chaque nuit, \u00E9liminez un villageois avec votre meute. Ne vous faites pas d\u00E9masquer!",
  },
  sorciere: {
    name: "Sorci\u00E8re",
    emoji: "\uD83E\uDDEA",
    team: "village",
    description:
      "Vous avez une potion de vie et une potion de mort. Utilisez-les avec sagesse.",
  },
  voyante: {
    name: "Voyante",
    emoji: "\uD83D\uDD2E",
    team: "village",
    description:
      "Chaque nuit, vous pouvez espionner un joueur et d\u00E9couvrir son v\u00E9ritable r\u00F4le.",
  },
  cupidon: {
    name: "Cupidon",
    emoji: "\uD83D\uDC98",
    team: "village",
    description:
      "Au d\u00E9but de la partie, liez deux joueurs par l\u2019amour. Si l\u2019un meurt, l\u2019autre aussi.",
  },
  petite_fille: {
    name: "Petite Fille",
    emoji: "\uD83D\uDC67",
    team: "village",
    description:
      "Vous espionnez les loups-garous chaque nuit. Vous voyez leurs messages, mais ils ne savent pas que vous \u00EAtes l\u00E0.",
  },
  chasseur: {
    name: "Chasseur",
    emoji: "\uD83C\uDFF9",
    team: "village",
    description:
      "Quand vous mourez, vous emportez quelqu\u2019un avec vous. Choisissez bien votre derni\u00E8re cible.",
  },
  villageois: {
    name: "Villageois",
    emoji: "\uD83E\uDDD1\u200D\uD83C\uDF3E",
    team: "village",
    description:
      "Trouvez et \u00E9liminez les loups-garous lors des votes du village. Votre instinct est votre arme.",
  },
  loup_blanc: {
    name: "Loup-Garou Blanc",
    emoji: "\uD83D\uDC3A",
    team: "loups",
    description:
      "Vous \u00EAtes un loup-garou, mais vous jouez aussi en solo. Une nuit sur deux, vous pouvez \u00E9liminer un autre loup-garou en secret.",
  },
};

// ---------------------------------------------------------------------------
// i18n role helpers
// ---------------------------------------------------------------------------

export function getRoleName(key: string, lang: Locale): string {
  return t(lang).roleNames[key] ?? ROLES[key]?.name ?? key;
}

export function getRoleDescription(key: string, lang: Locale): string {
  return t(lang).roleDescriptions[key] ?? ROLES[key]?.description ?? "";
}

// ---------------------------------------------------------------------------
// Role-ID mapping (from config embed selections)
// ---------------------------------------------------------------------------

export const ROLE_ID_TO_KEY: Record<number, string> = {
  2: "voyante",
  3: "sorciere",
  4: "chasseur",
  5: "cupidon",
  6: "petite_fille",
  47: "loup",
  48: "loup",
  49: "loup",
  50: "loup",
  51: "loup",
  52: "loup",
  53: "loup",
};

export function roleIdToKey(id: number): string {
  return ROLE_ID_TO_KEY[id] ?? "villageois";
}

// ---------------------------------------------------------------------------
// Secure random helper
// ---------------------------------------------------------------------------

export function secureRandom(rng?: () => number): number {
  if (rng) return rng();
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 0x1_0000_0000;
}

// ---------------------------------------------------------------------------
// Role assignment
// ---------------------------------------------------------------------------

export function assignRoles(
  humanIds: string[],
  botIds: string[],
  selectedRoleIds?: number[],
  rng?: () => number,
): Record<string, string> {
  const totalCount = humanIds.length + botIds.length;
  let roleKeys: string[];

  if (selectedRoleIds?.length) {
    roleKeys = selectedRoleIds.map(roleIdToKey);
    if (!roleKeys.some((r) => r === "loup" || r === "loup_blanc")) {
      roleKeys.push("loup");
    }
    while (roleKeys.length < totalCount) roleKeys.push("villageois");
    while (roleKeys.length > totalCount) {
      const lastVillageois = roleKeys.lastIndexOf("villageois");
      if (lastVillageois !== -1) roleKeys.splice(lastVillageois, 1);
      else break;
    }
    roleKeys.length = totalCount;
  } else {
    const wolfCount = Math.max(1, Math.min(Math.floor(totalCount / 3), 4));
    const villageCount = totalCount - wolfCount;

    const wolves: string[] = [];
    if (wolfCount >= 2 && secureRandom(rng) < 0.4) {
      wolves.push("loup_blanc");
      for (let i = 1; i < wolfCount; i++) wolves.push("loup");
    } else {
      for (let i = 0; i < wolfCount; i++) wolves.push("loup");
    }

    const specialPool = [
      "voyante",
      "sorciere",
      "cupidon",
      "chasseur",
      "petite_fille",
    ];
    for (let i = specialPool.length - 1; i > 0; i--) {
      const j = Math.floor(secureRandom(rng) * (i + 1));
      [specialPool[i], specialPool[j]] = [specialPool[j]!, specialPool[i]!];
    }
    const specialCount = Math.min(specialPool.length, villageCount - 1);
    const village: string[] = specialPool.slice(0, specialCount);
    for (let i = village.length; i < villageCount; i++)
      village.push("villageois");

    roleKeys = [...wolves, ...village];
  }

  // Shuffle roles and players together — fully random, no human/bot bias
  const shuffle = <T>(arr: T[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(secureRandom(rng) * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
  };

  shuffle(roleKeys);
  const allPlayers = [...humanIds, ...botIds];
  shuffle(allPlayers);

  const roles: Record<string, string> = {};
  for (let i = 0; i < allPlayers.length; i++) {
    roles[allPlayers[i]!] = roleKeys[i] ?? "villageois";
  }

  return roles;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export interface GameState {
  gameNumber: number;
  creatorId: string;
  creatorName: string;
  guildId: string;
  gameChannelId: string;
  maxPlayers: number;
  players: string[];
  lobbyMessageId?: string;
  announceChannelId?: string;
  announceMessageId?: string;
  wolfChannelId?: string;
  roles?: Record<string, string>;
  seen?: string[];
  couple?: [string, string];
  petiteFilleThreadId?: string;
  nightCount?: number;
  dead?: string[];
  witchPotions?: { life: boolean; death: boolean };
  discussionTime?: number;
  voteTime?: number;
  selectedRoleIds?: number[];
  botCount?: number;
  lang?: Locale;
}

// ---------------------------------------------------------------------------
// State serialisation (base-64 compact JSON)
// ---------------------------------------------------------------------------

export function encodeState(game: GameState): string {
  const compact: Record<string, unknown> = {
    g: game.gameNumber,
    c: game.creatorId,
    n: game.creatorName,
    gi: game.guildId,
    ch: game.gameChannelId,
    m: game.maxPlayers,
    p: game.players,
    lm: game.lobbyMessageId,
    ac: game.announceChannelId,
    am: game.announceMessageId,
    wc: game.wolfChannelId,
  };
  if (game.roles) compact.r = game.roles;
  if (game.seen?.length) compact.s = game.seen;
  if (game.couple) compact.cp = game.couple;
  if (game.petiteFilleThreadId) compact.pf = game.petiteFilleThreadId;
  if (game.nightCount) compact.nc = game.nightCount;
  if (game.dead?.length) compact.d = game.dead;
  if (game.witchPotions) compact.wp = game.witchPotions;
  if (game.discussionTime) compact.dt = game.discussionTime;
  if (game.voteTime) compact.vt = game.voteTime;
  if (game.selectedRoleIds?.length) compact.sr = game.selectedRoleIds;
  if (game.botCount) compact.bc = game.botCount;
  if (game.lang) compact.l = game.lang;
  return btoa(JSON.stringify(compact));
}

export function decodeState(url: string): GameState | null {
  try {
    const b64 = url.split("/s/")[1];
    if (!b64) return null;
    const compact = JSON.parse(atob(b64));
    return {
      gameNumber: compact.g,
      creatorId: compact.c,
      creatorName: compact.n,
      guildId: compact.gi,
      gameChannelId: compact.ch,
      maxPlayers: compact.m,
      players: compact.p ?? [],
      lobbyMessageId: compact.lm,
      announceChannelId: compact.ac,
      announceMessageId: compact.am,
      wolfChannelId: compact.wc,
      roles: compact.r,
      seen: compact.s ?? [],
      couple: compact.cp,
      petiteFilleThreadId: compact.pf,
      nightCount: compact.nc ?? 0,
      dead: compact.d ?? [],
      witchPotions: compact.wp,
      discussionTime: compact.dt ?? 120,
      voteTime: compact.vt ?? 60,
      selectedRoleIds: compact.sr,
      botCount: compact.bc ?? 0,
      lang: compact.l ?? "fr",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Win condition
// ---------------------------------------------------------------------------

export interface WinResult {
  winner: "village" | "loups" | "loup_blanc";
  title: string;
  description: string;
  image: string;
}

export function checkWinCondition(game: GameState, lang?: Locale): WinResult | null {
  if (!game.roles) return null;
  const locale = lang ?? game.lang ?? "fr";
  const i = t(locale);
  const dead = game.dead ?? [];
  const allPlayerIds = Object.keys(game.roles);
  const alive = allPlayerIds.filter((id) => !dead.includes(id));

  const aliveWolves = alive.filter((id) => {
    const r = game.roles![id];
    return r === "loup" || r === "loup_blanc";
  });
  const aliveLoupBlanc = alive.filter(
    (id) => game.roles![id] === "loup_blanc",
  );
  const aliveVillagers = alive.filter((id) => {
    const r = game.roles![id];
    return r !== "loup" && r !== "loup_blanc";
  });

  if (alive.length === 1 && aliveLoupBlanc.length === 1) {
    return {
      winner: "loup_blanc",
      title: i.game.victoryTitle.loup_blanc,
      description: i.game.victoryDesc.loup_blanc,
      image: SCENE_IMAGES.victory_wolves,
    };
  }

  if (aliveWolves.length === 0) {
    return {
      winner: "village",
      title: i.game.victoryTitle.village,
      description: i.game.victoryDesc.village,
      image: SCENE_IMAGES.victory_village,
    };
  }

  if (aliveWolves.length >= aliveVillagers.length) {
    return {
      winner: "loups",
      title: i.game.victoryTitle.loups,
      description: i.game.victoryDesc.loups,
      image: SCENE_IMAGES.victory_wolves,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Progress bar helper
// ---------------------------------------------------------------------------

export function progressBar(current: number, max: number): string {
  return "\uD83C\uDF15".repeat(current) + "\uD83C\uDF11".repeat(max - current);
}
