import {
  type GameState,
  encodeState,
  decodeState,
  EMBED_COLOR,
  EMBED_COLOR_GREEN,
  EMBED_COLOR_ORANGE,
  EMBED_COLOR_NIGHT,
  EMBED_COLOR_PURPLE,
  SCENE_IMAGES,
  MIN_PLAYERS,
  getRoleImage,
  progressBar,
  getRoleName,
} from "./game-logic";
import { t, type Locale } from "./i18n";
import { type BotPlayer } from "./bot-personalities";

export type { GameState, WinResult, Role } from "./game-logic";

// ─── VoteState (Wolf Night Vote) ────────────────────────────────────────────

export interface VoteState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  wolfChannelId: string;
  lobbyMessageId: string;
  wolves: string[];
  targets: { id: string; name: string }[];
  votes: Record<string, string>;
  deadline: number;
  petiteFilleThreadId?: string;
  couple?: [string, string];
  allRoles?: Record<string, string>;
  allPlayers?: string[];
  wolfNames?: Record<string, string>;
  lang?: Locale;
}

export function encodeVoteState(vote: VoteState): string {
  const o: Record<string, unknown> = {
    g: vote.gameNumber, gi: vote.guildId, gc: vote.gameChannelId,
    wc: vote.wolfChannelId, lm: vote.lobbyMessageId,
    w: vote.wolves,
    t: vote.targets.map((t) => [t.id, t.name]),
    v: vote.votes, dl: vote.deadline,
  };
  if (vote.petiteFilleThreadId) o.pf = vote.petiteFilleThreadId;
  if (vote.couple) o.cp = vote.couple;
  if (vote.allRoles) o.ar = vote.allRoles;
  if (vote.allPlayers) o.ap = vote.allPlayers;
  if (vote.wolfNames && Object.keys(vote.wolfNames).length) o.wn = vote.wolfNames;
  if (vote.lang) o.ln = vote.lang;
  return btoa(JSON.stringify(o));
}

export function decodeVoteState(url: string): VoteState | null {
  try {
    const b64 = url.split("/v/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc,
      wolfChannelId: c.wc, lobbyMessageId: c.lm,
      wolves: c.w,
      targets: (c.t as [string, string][]).map(([id, name]) => ({ id, name })),
      votes: c.v ?? {}, deadline: c.dl,
      petiteFilleThreadId: c.pf,
      couple: c.cp,
      allRoles: c.ar,
      allPlayers: c.ap,
      wolfNames: c.wn,
      lang: c.ln ?? "fr",
    };
  } catch { return null; }
}

export function parseVoteFromEmbed(message: any): VoteState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/v/")) return null;
  return decodeVoteState(embed.url);
}

export function buildVoteEmbed(vote: VoteState) {
  const i18n = t(vote.lang ?? "fr");
  const stateUrl = `https://garou.bot/v/${encodeVoteState(vote)}`;

  const voteLines = vote.wolves.map((wId) => {
    const targetId = vote.votes[wId];
    const target = targetId ? vote.targets.find((t) => t.id === targetId) : null;
    const wolfLabel = wId.startsWith("bot_")
      ? `🤖 **${vote.wolfNames?.[wId] ?? wId}**`
      : `🐺 <@${wId}>`;
    return `${wolfLabel} → ${target ? `**${target.name}**` : i18n.game.wolfVoteWaiting}`;
  });

  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const target of vote.targets) {
    const voteCount = Object.values(vote.votes).filter((v) => v === target.id).length;
    currentRow.push({
      type: 2,
      style: voteCount > 0 ? 4 : 2,
      label: `${voteCount > 0 ? "🎯 " : ""}${target.name}`,
      custom_id: `vote_kill_${vote.gameNumber}_${target.id}`,
    });
    if (currentRow.length === 5) {
      buttonRows.push({ type: 1, components: currentRow });
      currentRow = [];
    }
  }
  if (currentRow.length > 0) {
    buttonRows.push({ type: 1, components: currentRow });
  }

  return {
    embeds: [{
      title: i18n.game.wolfVoteTitle(vote.gameNumber),
      url: stateUrl,
      description: [
        i18n.game.wolfVoteQuestion,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...voteLines,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        i18n.game.wolfVoteDeadline(vote.deadline),
        "",
        i18n.game.wolfVoteUnanimous,
      ].join("\n"),
      color: EMBED_COLOR_NIGHT,
      image: { url: SCENE_IMAGES.night_falls },
    }],
    components: buttonRows,
  };
}

// ─── VoyanteState (Seer) ───────────────────────────────────────────────────

export interface VoyanteState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  voyanteThreadId: string;
  lobbyMessageId: string;
  voyanteId: string;
  targets: { id: string; name: string }[];
  deadline: number;
  allRoles: Record<string, string>;
  resolved?: boolean;
  lang?: Locale;
}

export function encodeVoyanteState(vy: VoyanteState): string {
  const o: Record<string, unknown> = {
    g: vy.gameNumber, gi: vy.guildId, gc: vy.gameChannelId,
    vt: vy.voyanteThreadId, lm: vy.lobbyMessageId, vi: vy.voyanteId,
    t: vy.targets.map((t) => [t.id, t.name]),
    dl: vy.deadline, ar: vy.allRoles, rs: vy.resolved,
  };
  if (vy.lang) o.ln = vy.lang;
  return btoa(JSON.stringify(o));
}

export function decodeVoyanteState(url: string): VoyanteState | null {
  try {
    const b64 = url.split("/vy/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc,
      voyanteThreadId: c.vt, lobbyMessageId: c.lm, voyanteId: c.vi,
      targets: (c.t as [string, string][]).map(([id, name]) => ({ id, name })),
      deadline: c.dl, allRoles: c.ar, resolved: c.rs,
      lang: c.ln ?? "fr",
    };
  } catch { return null; }
}

export function parseVoyanteFromEmbed(message: any): VoyanteState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/vy/")) return null;
  return decodeVoyanteState(embed.url);
}

export function buildVoyanteEmbed(vy: VoyanteState) {
  const i18n = t(vy.lang ?? "fr");
  const stateUrl = `https://garou.bot/vy/${encodeVoyanteState(vy)}`;

  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const target of vy.targets) {
    currentRow.push({
      type: 2,
      style: 1,
      label: `🔍 ${target.name}`,
      custom_id: `voyante_see_${vy.gameNumber}_${target.id}`,
    });
    if (currentRow.length === 5) {
      buttonRows.push({ type: 1, components: currentRow });
      currentRow = [];
    }
  }
  if (currentRow.length > 0) {
    buttonRows.push({ type: 1, components: currentRow });
  }

  return {
    embeds: [{
      title: i18n.game.voyanteTitle(vy.gameNumber),
      url: stateUrl,
      description: [
        i18n.game.voyanteQuestion,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        i18n.game.voyanteChoose,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        i18n.game.voyanteDeadline(vy.deadline),
      ].join("\n"),
      color: EMBED_COLOR_PURPLE,
      thumbnail: { url: getRoleImage("voyante") },
    }],
    components: buttonRows,
  };
}

// ─── SorciereState (Witch) ──────────────────────────────────────────────────

export interface SorciereState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  sorciereThreadId: string;
  lobbyMessageId: string;
  sorciereId: string;
  wolfVictimId: string;
  wolfVictimName: string;
  potions: { life: boolean; death: boolean };
  targets: { id: string; name: string }[];
  deadline: number;
  resolved?: boolean;
  witchSaved?: boolean;
  witchKillTargetId?: string;
  lang?: Locale;
}

export function encodeSorciereState(so: SorciereState): string {
  const o: Record<string, unknown> = {
    g: so.gameNumber, gi: so.guildId, gc: so.gameChannelId,
    st: so.sorciereThreadId, lm: so.lobbyMessageId, si: so.sorciereId,
    wv: so.wolfVictimId, wn: so.wolfVictimName,
    po: so.potions,
    t: so.targets.map((t) => [t.id, t.name]),
    dl: so.deadline, rs: so.resolved,
    ws: so.witchSaved, wk: so.witchKillTargetId,
  };
  if (so.lang) o.ln = so.lang;
  return btoa(JSON.stringify(o));
}

export function decodeSorciereState(url: string): SorciereState | null {
  try {
    const b64 = url.split("/so/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc,
      sorciereThreadId: c.st, lobbyMessageId: c.lm, sorciereId: c.si,
      wolfVictimId: c.wv, wolfVictimName: c.wn,
      potions: c.po,
      targets: (c.t as [string, string][]).map(([id, name]) => ({ id, name })),
      deadline: c.dl, resolved: c.rs,
      witchSaved: c.ws, witchKillTargetId: c.wk,
      lang: c.ln ?? "fr",
    };
  } catch { return null; }
}

export function parseSorciereFromEmbed(message: any): SorciereState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/so/")) return null;
  return decodeSorciereState(embed.url);
}

export function buildSorciereEmbed(so: SorciereState) {
  const i18n = t(so.lang ?? "fr");
  const stateUrl = `https://garou.bot/so/${encodeSorciereState(so)}`;

  const buttons: any[] = [];
  if (so.potions.life) {
    buttons.push({
      type: 2, style: 3,
      label: i18n.game.sorciereLifeBtn,
      custom_id: `sorciere_life_${so.gameNumber}`,
    });
  }
  if (so.potions.death) {
    buttons.push({
      type: 2, style: 4,
      label: i18n.game.sorciereDeathBtn,
      custom_id: `sorciere_death_${so.gameNumber}`,
    });
  }
  buttons.push({
    type: 2, style: 2,
    label: i18n.game.sorciereSkipBtn,
    custom_id: `sorciere_skip_${so.gameNumber}`,
  });

  return {
    embeds: [{
      title: i18n.game.sorciereTitle(so.gameNumber),
      url: stateUrl,
      description: [
        i18n.game.sorciereVictim(so.wolfVictimName),
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        so.potions.life ? i18n.game.sorciereLifePotion : i18n.game.sorciereLifeUsed,
        so.potions.death ? i18n.game.sorciereDeathPotion : i18n.game.sorciereDeathUsed,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        i18n.game.voyanteDeadline(so.deadline),
      ].join("\n"),
      color: EMBED_COLOR_PURPLE,
      thumbnail: { url: getRoleImage("sorciere") },
    }],
    components: [{ type: 1, components: buttons }],
  };
}

export function buildSorciereTargetEmbed(so: SorciereState) {
  const i18n = t(so.lang ?? "fr");
  const stateUrl = `https://garou.bot/so/${encodeSorciereState(so)}`;

  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const target of so.targets) {
    if (target.id === so.sorciereId) continue;
    currentRow.push({
      type: 2, style: 4,
      label: `☠️ ${target.name}`,
      custom_id: `sorciere_target_${so.gameNumber}_${target.id}`,
    });
    if (currentRow.length === 5) {
      buttonRows.push({ type: 1, components: currentRow });
      currentRow = [];
    }
  }
  if (currentRow.length > 0) {
    buttonRows.push({ type: 1, components: currentRow });
  }

  return {
    embeds: [{
      title: i18n.game.sorciereDeathTitle(so.gameNumber),
      url: stateUrl,
      description: [
        i18n.game.sorciereDeathQuestion,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        i18n.game.voyanteDeadline(so.deadline),
      ].join("\n"),
      color: EMBED_COLOR,
      thumbnail: { url: getRoleImage("sorciere") },
    }],
    components: buttonRows,
  };
}

// ─── CupidonState ───────────────────────────────────────────────────────────

export interface CupidonState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  lobbyMessageId: string;
  cupidonId: string;
  players: { id: string; name: string }[];
  picks: string[];
  deadline: number;
  roles: Record<string, string>;
  allPlayers: string[];
  lang?: Locale;
}

export function encodeCupidonState(s: CupidonState): string {
  const o: Record<string, unknown> = {
    g: s.gameNumber, gi: s.guildId, gc: s.gameChannelId, lm: s.lobbyMessageId,
    cu: s.cupidonId, pl: s.players.map(p => [p.id, p.name]),
    pk: s.picks, dl: s.deadline, r: s.roles, ap: s.allPlayers,
  };
  if (s.lang) o.ln = s.lang;
  return btoa(JSON.stringify(o));
}

export function decodeCupidonState(url: string): CupidonState | null {
  try {
    const b64 = url.split("/cu/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc, lobbyMessageId: c.lm,
      cupidonId: c.cu,
      players: (c.pl as [string, string][]).map(([id, name]) => ({ id, name })),
      picks: c.pk ?? [], deadline: c.dl, roles: c.r, allPlayers: c.ap,
      lang: c.ln ?? "fr",
    };
  } catch { return null; }
}

export function parseCupidonFromEmbed(message: any): CupidonState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/cu/")) return null;
  return decodeCupidonState(embed.url);
}

export function buildCupidonEmbed(s: CupidonState) {
  const i18n = t(s.lang ?? "fr");
  const stateUrl = `https://garou.bot/cu/${encodeCupidonState(s)}`;
  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const p of s.players) {
    const selected = s.picks.includes(p.id);
    currentRow.push({
      type: 2, style: selected ? 3 : 2,
      label: `${selected ? "💘 " : ""}${p.name}`,
      custom_id: `cupidon_pick_${s.gameNumber}_${p.id}`,
    });
    if (currentRow.length === 5) {
      buttonRows.push({ type: 1, components: currentRow });
      currentRow = [];
    }
  }
  if (currentRow.length > 0) buttonRows.push({ type: 1, components: currentRow });

  if (s.picks.length === 2) {
    const names = s.picks.map(id => s.players.find(p => p.id === id)?.name ?? "?");
    buttonRows.push({ type: 1, components: [{
      type: 2, style: 1,
      label: i18n.game.cupidonConfirm(names[0], names[1]),
      custom_id: `cupidon_confirm_${s.gameNumber}`,
    }] });
  }

  return {
    embeds: [{
      title: i18n.game.cupidonTitle(s.gameNumber),
      url: stateUrl,
      description: [
        i18n.game.cupidonQuestion,
        i18n.game.cupidonWarning,
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        s.picks.length === 0 ? i18n.game.cupidonPick2
          : s.picks.length === 1 ? `💘 <@${s.picks[0]}> + *...?*`
          : `💘 <@${s.picks[0]}> & <@${s.picks[1]}>`,
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        i18n.game.cupidonDeadline(s.deadline),
      ].join("\n"),
      color: 0xe91e63,
      thumbnail: { url: getRoleImage("cupidon") },
    }],
    components: buttonRows,
  };
}

// ─── ChasseurState (Hunter) ─────────────────────────────────────────────────

export interface ChasseurState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  lobbyMessageId: string;
  chasseurId: string;
  targets: { id: string; name: string }[];
  deadline: number;
  roles: Record<string, string>;
  allPlayers: string[];
  couple?: [string, string];
  dead: string[];
  lang?: Locale;
}

export function encodeChasseurState(s: ChasseurState): string {
  const o: Record<string, unknown> = {
    g: s.gameNumber, gi: s.guildId, gc: s.gameChannelId, lm: s.lobbyMessageId,
    ch: s.chasseurId, t: s.targets.map(t => [t.id, t.name]),
    dl: s.deadline, r: s.roles, ap: s.allPlayers, cp: s.couple, d: s.dead,
  };
  if (s.lang) o.ln = s.lang;
  return btoa(JSON.stringify(o));
}

export function decodeChasseurState(url: string): ChasseurState | null {
  try {
    const b64 = url.split("/hs/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc, lobbyMessageId: c.lm,
      chasseurId: c.ch,
      targets: (c.t as [string, string][]).map(([id, name]) => ({ id, name })),
      deadline: c.dl, roles: c.r, allPlayers: c.ap, couple: c.cp, dead: c.d ?? [],
      lang: c.ln ?? "fr",
    };
  } catch { return null; }
}

export function parseChasseurFromEmbed(message: any): ChasseurState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/hs/")) return null;
  return decodeChasseurState(embed.url);
}

export function buildChasseurEmbed(s: ChasseurState) {
  const i18n = t(s.lang ?? "fr");
  const stateUrl = `https://garou.bot/hs/${encodeChasseurState(s)}`;
  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const tgt of s.targets) {
    currentRow.push({
      type: 2, style: 4,
      label: `🎯 ${tgt.name}`,
      custom_id: `chasseur_shoot_${s.gameNumber}_${tgt.id}`,
    });
    if (currentRow.length === 5) {
      buttonRows.push({ type: 1, components: currentRow });
      currentRow = [];
    }
  }
  if (currentRow.length > 0) buttonRows.push({ type: 1, components: currentRow });

  return {
    embeds: [{
      title: i18n.game.chasseurTitle(s.gameNumber),
      url: stateUrl,
      description: [
        i18n.game.chasseurQuestion,
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        i18n.game.chasseurChoose,
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        i18n.game.cupidonDeadline(s.deadline),
      ].join("\n"),
      color: 0xe67e22, thumbnail: { url: getRoleImage("chasseur") },
    }],
    components: buttonRows,
  };
}

// ─── DayVoteState ───────────────────────────────────────────────────────────

export interface DayVoteState {
  gameNumber: number;
  guildId: string;
  gameChannelId: string;
  lobbyMessageId: string;
  targets: { id: string; name: string }[];
  votes: Record<string, string>;
  voters: string[];
  deadline: number;
  voteMessageId?: string;
  allRoles?: Record<string, string>;
  couple?: [string, string];
  discussionTime?: number;
  voteTime?: number;
  lang?: Locale;
}

export function encodeDayVoteState(dv: DayVoteState): string {
  const o: Record<string, unknown> = {
    g: dv.gameNumber, gi: dv.guildId, gc: dv.gameChannelId,
    lm: dv.lobbyMessageId,
    t: dv.targets.map((t) => [t.id, t.name]),
    v: dv.votes, vt: dv.voters, dl: dv.deadline,
  };
  if (dv.voteMessageId) o.vm = dv.voteMessageId;
  if (dv.allRoles) o.ar = dv.allRoles;
  if (dv.couple) o.cp = dv.couple;
  if (dv.discussionTime) o.dst = dv.discussionTime;
  if (dv.voteTime) o.vtt = dv.voteTime;
  if (dv.lang) o.ln = dv.lang;
  return btoa(JSON.stringify(o));
}

export function decodeDayVoteState(url: string): DayVoteState | null {
  try {
    const b64 = url.split("/dv/")[1];
    if (!b64) return null;
    const c = JSON.parse(atob(b64));
    return {
      gameNumber: c.g, guildId: c.gi, gameChannelId: c.gc,
      lobbyMessageId: c.lm,
      targets: (c.t as [string, string][]).map(([id, name]) => ({ id, name })),
      votes: c.v ?? {}, voters: c.vt ?? [], deadline: c.dl,
      voteMessageId: c.vm,
      allRoles: c.ar,
      couple: c.cp,
      discussionTime: c.dst,
      voteTime: c.vtt,
      lang: c.ln ?? "fr",
    };
  } catch { return null; }
}

export function parseDayVoteFromEmbed(message: any): DayVoteState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/dv/")) return null;
  return decodeDayVoteState(embed.url);
}

// ─── Game Embeds (Lobby, Announce, Role Check) ─────────────────────────────

export function buildRoleCheckEmbed(game: GameState, bots: BotPlayer[] = []) {
  const i18n = t(game.lang ?? "fr");
  const seen = game.seen ?? [];
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  // Human players
  const playerLines = game.players.map((id) => {
    const checked = seen.includes(id);
    return `${checked ? "✅" : "⬜"} <@${id}>`;
  });

  // Bot players (always checked)
  const botLines = bots.map((b) => `✅ 🤖 ${b.name}`);

  const totalPlayers = game.players.length + bots.length;
  const humansSeen = seen.filter(id => !id.startsWith("bot_")).length;
  const totalSeen = humansSeen + bots.length;

  return {
    embeds: [{
      title: i18n.game.roleCheckTitle(game.gameNumber),
      url: stateUrl,
      description: [
        i18n.game.roleCheckDesc,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...playerLines,
        ...botLines,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        i18n.game.roleCheckProgress(totalSeen, totalPlayers),
      ].join("\n"),
      color: EMBED_COLOR_PURPLE,
      image: { url: SCENE_IMAGES.game_start },
      footer: { text: i18n.game.dontRevealRole },
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 1,
        label: i18n.game.seeMyRole,
        custom_id: `reveal_role_${game.gameNumber}`,
      }],
    }],
  };
}

export function buildAnnounceEmbed(game: GameState, bots: BotPlayer[] = []) {
  const i18n = t(game.lang ?? "fr");
  const totalCount = game.players.length + (game.botCount ?? bots.length);
  const isFull = totalCount >= game.maxPlayers;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  const lines = [
    progressBar(totalCount, game.maxPlayers),
    i18n.game.nPlayers(totalCount, game.maxPlayers),
    "",
  ];

  if (game.players.length > 0) {
    lines.push(game.players.map((id) => `> <@${id}>`).join("\n"));
  }
  if ((game.botCount ?? bots.length) > 0) {
    lines.push(`> 🤖 **${game.botCount ?? bots.length} ${i18n.misc.bots}**`);
  }
  if (game.players.length > 0 || (game.botCount ?? bots.length) > 0) {
    lines.push("");
  }

  lines.push(
    isFull ? `**${i18n.game.gameFull}**` : i18n.game.joinCTA
  );

  return {
    embeds: [
      {
        title: i18n.game.announceTitle(game.gameNumber),
        url: stateUrl,
        description: lines.join("\n"),
        color: isFull ? EMBED_COLOR_GREEN : EMBED_COLOR,
        image: { url: SCENE_IMAGES.game_start },
        footer: { text: i18n.game.createdBy(game.creatorName) },
        timestamp: new Date().toISOString(),
      },
    ],
    components: isFull
      ? []
      : [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 3,
                label: i18n.game.joinButton,
                custom_id: `join_game_${game.gameNumber}`,
              },
            ],
          },
        ],
  };
}

export function buildLobbyEmbed(game: GameState, bots: BotPlayer[] = [], lastEvent?: string) {
  const i18n = t(game.lang ?? "fr");
  const totalCount = game.players.length + bots.length;
  const isFull = totalCount >= game.maxPlayers;
  const canStart = totalCount >= MIN_PLAYERS;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  const playerLines = game.players.map((id) => {
    const icon = id === game.creatorId ? "👑" : "🐺";
    return `${icon} <@${id}>`;
  });
  for (const bot of bots) {
    playerLines.push(`🤖 ${bot.emoji} ${bot.name} (${i18n.misc.bot})`);
  }
  for (let i = totalCount; i < game.maxPlayers; i++) {
    playerLines.push(`⬜ *${i18n.game.waiting}*`);
  }

  const statusEmoji = isFull ? "🟢" : canStart ? "🟡" : "🔴";
  const statusText = isFull
    ? i18n.game.statusFull
    : canStart
      ? i18n.game.statusReady
      : i18n.game.statusWaiting(MIN_PLAYERS);

  const lines = [
    progressBar(totalCount, game.maxPlayers),
    `${statusEmoji} **${totalCount}/${game.maxPlayers}** — ${statusText}`,
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    ...playerLines,
  ];

  if (lastEvent) {
    lines.push("", "━━━━━━━━━━━━━━━━━━━━", "", `📋 *${lastEvent}*`);
  }

  const buttons: any[] = [];
  if (canStart) {
    buttons.push({
      type: 2,
      style: 3,
      label: i18n.game.startButton,
      custom_id: `start_game_${game.gameNumber}`,
    });
  }
  buttons.push({
    type: 2,
    style: 4,
    label: i18n.game.quitButton,
    custom_id: `quit_game_${game.gameNumber}`,
  });

  return {
    embeds: [
      {
        title: i18n.game.lobbyTitle(game.gameNumber),
        url: stateUrl,
        description: lines.join("\n"),
        color: canStart ? (isFull ? EMBED_COLOR_GREEN : EMBED_COLOR_ORANGE) : EMBED_COLOR,
        image: { url: SCENE_IMAGES.game_start },
        footer: { text: i18n.game.createdBy(game.creatorName) },
        timestamp: new Date().toISOString(),
      },
    ],
    components: [{ type: 1, components: buttons }],
  };
}

export function parseGameFromEmbed(message: any): GameState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url) return null;
  return decodeState(embed.url);
}
