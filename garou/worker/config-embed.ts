import {
  ALL_ROLES,
  VILLAGEOIS_GROUP_1,
  VILLAGEOIS_GROUP_2,
  LOUPS_ROLES,
  SOLITAIRE_ROLES,
  DEFAULT_PRESETS,
  rolesToBitmask,
  bitmaskToRoles,
  type PresetConfig,
} from "./roles";

// ── Config State ────────────────────────────────────────────────────

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
}

export function encodeConfigState(config: ConfigState): string {
  const compact = {
    s: config.step,
    cr: config.creatorId,
    g: config.guildId,
    ch: config.channelId,
    p: config.presetName,
    av: config.anonymousVotes ? 1 : 0,
    dt: config.discussionTime,
    vt: config.voteTime,
    rb: rolesToBitmask(config.selectedRoles),
  };
  return btoa(JSON.stringify(compact));
}

export function decodeConfigState(url: string): ConfigState | null {
  try {
    const b64 = url.split("/c/")[1];
    if (!b64) return null;
    const compact = JSON.parse(atob(b64));
    return {
      step: compact.s,
      creatorId: compact.cr,
      guildId: compact.g,
      channelId: compact.ch,
      presetName: compact.p ?? "",
      anonymousVotes: compact.av === 1,
      discussionTime: compact.dt ?? 120,
      voteTime: compact.vt ?? 60,
      selectedRoles: bitmaskToRoles(compact.rb ?? "0000000000000000"),
    };
  } catch {
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (sec === 0) return `${min} min`;
  return `${min} min ${sec}`;
}

// ── Step 1 Embed — Parameters ───────────────────────────────────────

export function buildStep1Embed(config: ConfigState, customPresets: PresetConfig[] = []) {
  const stateUrl = `https://garou.bot/c/${encodeConfigState({ ...config, step: 1 })}`;

  const rolesCount = config.selectedRoles.length;
  const villCount = config.selectedRoles.filter((id) => id <= 46).length;
  const loupsCount = config.selectedRoles.filter((id) => id >= 47 && id <= 53).length;
  const soloCount = config.selectedRoles.filter((id) => id >= 54).length;

  const description = [
    `> **Preset:** ${config.presetName || "Aucun"}`,
    `> **Votes:** ${config.anonymousVotes ? "🔒 Anonyme" : "👁️ Public"}`,
    `> **Discussion:** ${formatTime(config.discussionTime)}`,
    `> **Vote:** ${formatTime(config.voteTime)}`,
    "",
    `🎭 **Rôles:** ${rolesCount} sélectionnés`,
    rolesCount > 0
      ? `> 🏘️ ${villCount} Villageois • 🐺 ${loupsCount} Loups • 🎭 ${soloCount} Solo`
      : "> _Sélectionnez un preset ou configurez les rôles manuellement_",
  ].join("\n");

  // Build preset options
  const presetOptions: any[] = [
    {
      label: "Aucun",
      value: "none",
      description: "Configuration manuelle",
      default: !config.presetName,
    },
    ...DEFAULT_PRESETS.map((p) => ({
      label: p.name,
      value: p.name,
      description: `${p.roles.length} rôles • ${p.anonymousVotes ? "Anonyme" : "Public"}`,
      default: config.presetName === p.name,
    })),
    ...customPresets.map((p) => ({
      label: `📌 ${p.name}`,
      value: `custom:${p.name}`,
      description: `${p.roles.length} rôles • Preset serveur`,
      default: config.presetName === p.name,
    })),
  ];

  return {
    embeds: [
      {
        title: "🐺 Nouvelle Partie — Configuration",
        url: stateUrl,
        description,
        color: 0x8b0000,
        thumbnail: { url: "https://i.imgur.com/JfOLPcY.png" },
        footer: { text: "Étape 1/2 — Paramètres" },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "cfg_preset",
            placeholder: "🎮 Choisir un preset...",
            min_values: 1,
            max_values: 1,
            options: presetOptions.slice(0, 25),
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "cfg_votes",
            placeholder: "🗳️ Type de votes",
            min_values: 1,
            max_values: 1,
            options: [
              {
                label: "Vote Public",
                value: "public",
                description: "Tout le monde voit les votes",
                default: !config.anonymousVotes,
              },
              {
                label: "Vote Anonyme",
                value: "anonyme",
                description: "Les votes sont cachés",
                default: config.anonymousVotes,
              },
            ],
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "cfg_disc_time",
            placeholder: "💬 Temps de discussion",
            min_values: 1,
            max_values: 1,
            options: [
              { label: "1 min 30", value: "90", default: config.discussionTime === 90 },
              { label: "2 min", value: "120", default: config.discussionTime === 120 },
              { label: "2 min 30", value: "150", default: config.discussionTime === 150 },
              { label: "3 min", value: "180", default: config.discussionTime === 180 },
              { label: "3 min 30", value: "210", default: config.discussionTime === 210 },
            ],
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "cfg_vote_time",
            placeholder: "⏱️ Temps de vote",
            min_values: 1,
            max_values: 1,
            options: [
              { label: "30 sec", value: "30", default: config.voteTime === 30 },
              { label: "1 min", value: "60", default: config.voteTime === 60 },
              { label: "1 min 30", value: "90", default: config.voteTime === 90 },
              { label: "2 min", value: "120", default: config.voteTime === 120 },
            ],
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            label: "Configurer les rôles →",
            custom_id: "cfg_next",
          },
          {
            type: 2,
            style: 3,
            label: "Créer avec preset",
            custom_id: "cfg_create",
            disabled: config.selectedRoles.length === 0,
          },
        ],
      },
    ],
  };
}

// ── Step 2 Embed — Roles ────────────────────────────────────────────

export function buildStep2Embed(config: ConfigState) {
  const stateUrl = `https://garou.bot/c/${encodeConfigState({ ...config, step: 2 })}`;

  const villCount = config.selectedRoles.filter((id) => id <= 46).length;
  const loupsCount = config.selectedRoles.filter((id) => id >= 47 && id <= 53).length;
  const soloCount = config.selectedRoles.filter((id) => id >= 54).length;
  const total = config.selectedRoles.length;

  const description = [
    `> **Preset:** ${config.presetName || "Manuel"}`,
    `> **Votes:** ${config.anonymousVotes ? "🔒 Anonyme" : "👁️ Public"} • **Discussion:** ${formatTime(config.discussionTime)} • **Vote:** ${formatTime(config.voteTime)}`,
    "",
    `🎭 **Rôles sélectionnés:** ${total}`,
    `> 🏘️ ${villCount} Villageois • 🐺 ${loupsCount} Loups • 🎭 ${soloCount} Solo`,
  ].join("\n");

  const selectedSet = new Set(config.selectedRoles);

  function buildRoleMenu(customId: string, placeholder: string, roles: { id: number; name: string }[]) {
    return {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: customId,
          placeholder,
          min_values: 0,
          max_values: roles.length,
          options: roles.map((r) => ({
            label: r.name,
            value: String(r.id),
            default: selectedSet.has(r.id),
          })),
        },
      ],
    };
  }

  return {
    embeds: [
      {
        title: "🐺 Nouvelle Partie — Rôles",
        url: stateUrl,
        description,
        color: 0x8b0000,
        thumbnail: { url: "https://i.imgur.com/JfOLPcY.png" },
        footer: { text: "Étape 2/2 — Sélection des rôles" },
      },
    ],
    components: [
      buildRoleMenu("cfg_roles_v1", "🏘️ Villageois (1/2)", VILLAGEOIS_GROUP_1),
      buildRoleMenu("cfg_roles_v2", "🏘️ Villageois (2/2)", VILLAGEOIS_GROUP_2),
      buildRoleMenu("cfg_roles_loups", "🐺 Loups-Garous", LOUPS_ROLES),
      buildRoleMenu("cfg_roles_solo", "🎭 Solitaires", SOLITAIRE_ROLES),
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: "← Retour",
            custom_id: "cfg_back",
          },
          {
            type: 2,
            style: 3,
            label: "Créer la partie",
            custom_id: "cfg_create",
            disabled: total === 0,
          },
          {
            type: 2,
            style: 1,
            label: "Sauvegarder preset",
            custom_id: "cfg_save",
            disabled: total === 0,
          },
        ],
      },
    ],
  };
}

// ── Preset Lookup ───────────────────────────────────────────────────

export function findPreset(name: string, customPresets: PresetConfig[] = []): PresetConfig | undefined {
  // Check default presets
  const defaultPreset = DEFAULT_PRESETS.find((p) => p.name === name);
  if (defaultPreset) return defaultPreset;

  // Check custom presets (stored with "custom:" prefix in select value)
  const customName = name.startsWith("custom:") ? name.slice(7) : name;
  return customPresets.find((p) => p.name === customName);
}

// ── Role Group Update Helper ────────────────────────────────────────

export function updateRolesForGroup(
  currentRoles: number[],
  groupRoleIds: number[],
  newSelection: number[],
): number[] {
  const groupSet = new Set(groupRoleIds);
  const filtered = currentRoles.filter((id) => !groupSet.has(id));
  return [...filtered, ...newSelection].sort((a, b) => a - b);
}
