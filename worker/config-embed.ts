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
import { t, type Locale } from "./i18n";

const MIN_PLAYERS = 4;
const WOLF_IDS = new Set([47, 48, 49, 50, 51, 52, 53]);
function configIsValid(roles: number[]): boolean {
  return roles.length >= MIN_PLAYERS && roles.some((id) => WOLF_IDS.has(id));
}

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
  botCount: number;
  maxPlayers: number; // total players (humans + bots)
  lang: Locale;
}

export function encodeConfigState(config: ConfigState): string {
  const compact: Record<string, unknown> = {
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
  if (config.botCount) compact.bc = config.botCount;
  if (config.maxPlayers) compact.mp = config.maxPlayers;
  if (config.lang && config.lang !== "fr") compact.ln = config.lang;
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
      botCount: compact.bc ?? 0,
      maxPlayers: compact.mp ?? 6,
      lang: compact.ln ?? "fr",
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
  const i18n = t(config.lang);
  const c = i18n.config;
  const stateUrl = `https://garou.bot/c/${encodeConfigState({ ...config, step: 1 })}`;

  const rolesCount = config.selectedRoles.length;
  const villCount = config.selectedRoles.filter((id) => id <= 46).length;
  const loupsCount = config.selectedRoles.filter((id) => id >= 47 && id <= 53).length;
  const soloCount = config.selectedRoles.filter((id) => id >= 54).length;

  const presetNames: Record<string, string> = {
    Classique: i18n.presets.classique,
    "Étendu": i18n.presets.etendu,
    Chaos: i18n.presets.chaos,
    "Loups+": i18n.presets.loupsPlus,
  };
  const displayPreset = config.presetName ? (presetNames[config.presetName] ?? config.presetName) : c.noPreset;

  const description = [
    `> **${c.preset}:** ${displayPreset}`,
    `> **${c.votes}:** ${config.anonymousVotes ? c.anonVote : c.publicVote} • **${c.discussion}:** ${formatTime(config.discussionTime)} • **${c.vote}:** ${formatTime(config.voteTime)}`,
    `> **${c.players}:** ${config.maxPlayers} ${c.total} (👥 ${config.maxPlayers - config.botCount} ${c.humans}${config.botCount > 0 ? ` + 🤖 ${config.botCount} ${c.bots}` : ""})`,
    "",
    `🎭 **${c.rolesSelected}:** ${rolesCount} ${c.selected}`,
    rolesCount > 0
      ? `> 🏘️ ${villCount} ${c.villagers} • 🐺 ${loupsCount} ${c.wolves} • 🎭 ${soloCount} ${c.solo}`
      : `> _${c.selectRolesHint}_`,
  ].join("\n");

  // Build preset options
  const presetOptions: any[] = [
    {
      label: c.noPreset,
      value: "none",
      description: c.manualConfig,
      default: !config.presetName,
    },
    ...DEFAULT_PRESETS.map((p) => ({
      label: presetNames[p.name] ?? p.name,
      value: p.name,
      description: c.presetRoles(p.roles.length, p.anonymousVotes),
      default: config.presetName === p.name,
    })),
    ...customPresets.map((p) => ({
      label: `📌 ${p.name}`,
      value: `custom:${p.name}`,
      description: c.serverPreset(p.roles.length),
      default: config.presetName === p.name,
    })),
  ];

  return {
    embeds: [
      {
        title: c.title,
        url: stateUrl,
        description,
        color: 0x8b0000,
        image: { url: "https://raw.githubusercontent.com/dev-t0ny/bp-hacks-2026/main/garou/assets/scenes/game_start.png" },
        footer: { text: c.step1Footer },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "cfg_lang",
            placeholder: c.langLabel,
            min_values: 1,
            max_values: 1,
            options: [
              { label: c.langFr, value: "fr", default: config.lang === "fr" },
              { label: c.langEn, value: "en", default: config.lang === "en" },
            ],
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "cfg_preset",
            placeholder: c.selectPreset,
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
            custom_id: "cfg_max_players",
            placeholder: c.playerCount,
            min_values: 1,
            max_values: 1,
            options: [4, 5, 6, 7, 8, 10, 12].map((n) => ({
              label: c.nPlayers(n),
              value: String(n),
              default: config.maxPlayers === n,
            })),
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "cfg_bots",
            placeholder: c.botCount,
            min_values: 1,
            max_values: 1,
            options: [0, 1, 2, 3, 4, 5].map((n) => ({
              label: c.nBots(n),
              value: String(n),
              default: config.botCount === n,
            })),
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: config.anonymousVotes ? 2 : 1,
            label: c.publicVote,
            custom_id: "cfg_votes_public",
          },
          {
            type: 2,
            style: config.anonymousVotes ? 1 : 2,
            label: c.anonVote,
            custom_id: "cfg_votes_anonyme",
          },
          {
            type: 2,
            style: 1,
            label: c.configureRoles,
            custom_id: "cfg_next",
          },
          {
            type: 2,
            style: 3,
            label: c.createWithPreset,
            custom_id: "cfg_create",
            disabled: !configIsValid(config.selectedRoles),
          },
        ],
      },
    ],
  };
}

// ── Step 2 Embed — Roles ────────────────────────────────────────────

export function buildStep2Embed(config: ConfigState) {
  const i18n = t(config.lang);
  const c = i18n.config;
  const stateUrl = `https://garou.bot/c/${encodeConfigState({ ...config, step: 2 })}`;

  const villCount = config.selectedRoles.filter((id) => id <= 46).length;
  const loupsCount = config.selectedRoles.filter((id) => id >= 47 && id <= 53).length;
  const soloCount = config.selectedRoles.filter((id) => id >= 54).length;
  const total = config.selectedRoles.length;

  const presetNames: Record<string, string> = {
    Classique: i18n.presets.classique,
    "Étendu": i18n.presets.etendu,
    Chaos: i18n.presets.chaos,
    "Loups+": i18n.presets.loupsPlus,
  };
  const displayPreset = config.presetName ? (presetNames[config.presetName] ?? config.presetName) : c.manual;

  const description = [
    `> **${c.preset}:** ${displayPreset}`,
    `> **${c.votes}:** ${config.anonymousVotes ? c.anonVote : c.publicVote} • **${c.discussion}:** ${formatTime(config.discussionTime)} • **${c.vote}:** ${formatTime(config.voteTime)}`,
    "",
    `🎭 **${c.rolesSelected} ${c.selected}:** ${total}`,
    `> 🏘️ ${villCount} ${c.villagers} • 🐺 ${loupsCount} ${c.wolves} • 🎭 ${soloCount} ${c.solo}`,
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
            label: i18n.allRoleNames[r.id] ?? r.name,
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
        title: c.step2Title,
        url: stateUrl,
        description,
        color: 0x8b0000,
        image: { url: "https://raw.githubusercontent.com/dev-t0ny/bp-hacks-2026/main/garou/assets/scenes/game_start.png" },
        footer: { text: c.step2Footer },
      },
    ],
    components: [
      buildRoleMenu("cfg_roles_v1", c.villageoisGroup1, VILLAGEOIS_GROUP_1),
      buildRoleMenu("cfg_roles_v2", c.villageoisGroup2, VILLAGEOIS_GROUP_2),
      buildRoleMenu("cfg_roles_loups", c.loupsGroup, LOUPS_ROLES),
      buildRoleMenu("cfg_roles_solo", c.soloGroup, SOLITAIRE_ROLES),
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: c.back,
            custom_id: "cfg_back",
          },
          {
            type: 2,
            style: 3,
            label: c.createGame,
            custom_id: "cfg_create",
            disabled: !configIsValid(config.selectedRoles),
          },
          {
            type: 2,
            style: 1,
            label: c.savePreset,
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
