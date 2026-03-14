// ── Role Definitions ────────────────────────────────────────────────

export interface Role {
  id: number;
  name: string;
  camp: "villageois" | "loups" | "solitaire";
}

export const ALL_ROLES: Role[] = [
  // ─── Camp des Villageois (0-46) ───
  { id: 0, name: "Simple Villageois", camp: "villageois" },
  { id: 1, name: "Villageois-Villageois", camp: "villageois" },
  { id: 2, name: "Voyante", camp: "villageois" },
  { id: 3, name: "Sorcière", camp: "villageois" },
  { id: 4, name: "Chasseur", camp: "villageois" },
  { id: 5, name: "Cupidon", camp: "villageois" },
  { id: 6, name: "Petite Fille", camp: "villageois" },
  { id: 7, name: "Salvateur", camp: "villageois" },
  { id: 8, name: "Ancien", camp: "villageois" },
  { id: 9, name: "Idiot du Village", camp: "villageois" },
  { id: 10, name: "Bouc Émissaire", camp: "villageois" },
  { id: 11, name: "Corbeau", camp: "villageois" },
  { id: 12, name: "Renard", camp: "villageois" },
  { id: 13, name: "Deux Sœurs", camp: "villageois" },
  { id: 14, name: "Trois Frères", camp: "villageois" },
  { id: 15, name: "Enfant Sauvage", camp: "villageois" },
  { id: 16, name: "Servante Dévouée", camp: "villageois" },
  { id: 17, name: "Montreur d'Ours", camp: "villageois" },
  { id: 18, name: "Comédien", camp: "villageois" },
  { id: 19, name: "Chevalier Épée Rouillée", camp: "villageois" },
  { id: 20, name: "Juge Bègue", camp: "villageois" },
  { id: 21, name: "Chien-Loup", camp: "villageois" },
  { id: 22, name: "Voleur", camp: "villageois" },
  { id: 23, name: "Chaperon Rouge", camp: "villageois" },
  { id: 24, name: "Mentaliste", camp: "villageois" },
  { id: 25, name: "Nécromancien", camp: "villageois" },
  { id: 26, name: "Fossoyeur", camp: "villageois" },
  { id: 27, name: "Dictateur", camp: "villageois" },
  { id: 28, name: "Pyromancien", camp: "villageois" },
  { id: 29, name: "Héritier", camp: "villageois" },
  { id: 30, name: "Chaman", camp: "villageois" },
  { id: 31, name: "Prêtre", camp: "villageois" },
  { id: 32, name: "Garde du Corps", camp: "villageois" },
  { id: 33, name: "Porteur d'Amulette", camp: "villageois" },
  { id: 34, name: "Tireur", camp: "villageois" },
  { id: 35, name: "Fille de Joie", camp: "villageois" },
  { id: 36, name: "Mamie Grincheuse", camp: "villageois" },
  { id: 37, name: "Lépreux", camp: "villageois" },
  { id: 38, name: "Savant Fou", camp: "villageois" },
  { id: 39, name: "Gros Dur", camp: "villageois" },
  { id: 40, name: "Humain Maudit", camp: "villageois" },
  { id: 41, name: "Mystique", camp: "villageois" },
  { id: 42, name: "Président", camp: "villageois" },
  { id: 43, name: "Arnacoeur", camp: "villageois" },
  { id: 44, name: "Fils de la Lune", camp: "villageois" },
  { id: 45, name: "Ankou", camp: "villageois" },
  { id: 46, name: "Marionnettiste", camp: "villageois" },

  // ─── Camp des Loups-Garous (47-53) ───
  { id: 47, name: "Loup-Garou", camp: "loups" },
  { id: 48, name: "Grand Méchant Loup", camp: "loups" },
  { id: 49, name: "Infect Père des Loups", camp: "loups" },
  { id: 50, name: "Loup Noir", camp: "loups" },
  { id: 51, name: "Loup Bavard", camp: "loups" },
  { id: 52, name: "Louveteau", camp: "loups" },
  { id: 53, name: "Cultiste", camp: "loups" },

  // ─── Camp Solitaire (54-63) ───
  { id: 54, name: "Loup-Garou Blanc", camp: "solitaire" },
  { id: 55, name: "Joueur de Flûte", camp: "solitaire" },
  { id: 56, name: "Ange", camp: "solitaire" },
  { id: 57, name: "Abominable Sectaire", camp: "solitaire" },
  { id: 58, name: "Mercenaire", camp: "solitaire" },
  { id: 59, name: "Nain Tracassin", camp: "solitaire" },
  { id: 60, name: "Rat Malade", camp: "solitaire" },
  { id: 61, name: "Tueur en Série", camp: "solitaire" },
  { id: 62, name: "Pyromane", camp: "solitaire" },
  { id: 63, name: "Lapin Blanc", camp: "solitaire" },
];

// Split villageois into 2 groups for select menus (max 25 options each)
const allVillageois = ALL_ROLES.filter((r) => r.camp === "villageois");
export const VILLAGEOIS_GROUP_1 = allVillageois.slice(0, 24); // ids 0-23
export const VILLAGEOIS_GROUP_2 = allVillageois.slice(24); // ids 24-46
export const LOUPS_ROLES = ALL_ROLES.filter((r) => r.camp === "loups");
export const SOLITAIRE_ROLES = ALL_ROLES.filter((r) => r.camp === "solitaire");

// ── Bitmask Helpers ─────────────────────────────────────────────────

export function rolesToBitmask(roles: number[]): string {
  let mask = 0n;
  for (const r of roles) mask |= 1n << BigInt(r);
  return mask.toString(16).padStart(16, "0");
}

export function bitmaskToRoles(hex: string): number[] {
  const mask = BigInt("0x" + hex);
  const roles: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (mask & (1n << BigInt(i))) roles.push(i);
  }
  return roles;
}

// ── Presets ──────────────────────────────────────────────────────────

export interface PresetConfig {
  name: string;
  roles: number[];
  anonymousVotes: boolean;
  discussionTime: number;
  voteTime: number;
}

export const DEFAULT_PRESETS: PresetConfig[] = [
  {
    name: "Classique",
    roles: [0, 2, 3, 4, 5, 47],
    anonymousVotes: false,
    discussionTime: 120,
    voteTime: 60,
  },
  {
    name: "Étendu",
    roles: [0, 1, 2, 3, 4, 5, 6, 7, 8, 22, 47, 48],
    anonymousVotes: false,
    discussionTime: 120,
    voteTime: 60,
  },
  {
    name: "Chaos",
    roles: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 15, 22, 47, 48, 49, 50, 55, 56, 58],
    anonymousVotes: true,
    discussionTime: 150,
    voteTime: 90,
  },
  {
    name: "Loups+",
    roles: [0, 2, 3, 4, 7, 47, 48, 49, 50, 51, 52],
    anonymousVotes: false,
    discussionTime: 120,
    voteTime: 60,
  },
];
