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
} from "./game-logic";
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
    };
  } catch { return null; }
}

export function parseVoteFromEmbed(message: any): VoteState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/v/")) return null;
  return decodeVoteState(embed.url);
}

export function buildVoteEmbed(vote: VoteState) {
  const stateUrl = `https://garou.bot/v/${encodeVoteState(vote)}`;

  const voteLines = vote.wolves.map((wId) => {
    const targetId = vote.votes[wId];
    const target = targetId ? vote.targets.find((t) => t.id === targetId) : null;
    const wolfLabel = wId.startsWith("bot_")
      ? `🤖 **${vote.wolfNames?.[wId] ?? wId}**`
      : `🐺 <@${wId}>`;
    return `${wolfLabel} → ${target ? `**${target.name}**` : "*(en attente...)*"}`;
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
      title: `🐺 Vote de la Nuit — Partie #${vote.gameNumber}`,
      url: stateUrl,
      description: [
        "**Qui les loups veulent-ils dévorer cette nuit?**",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...voteLines,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `⏰ Fin du vote <t:${vote.deadline}:R>`,
        "",
        "*Vote unanime = résolution immédiate*",
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
}

export function encodeVoyanteState(vy: VoyanteState): string {
  return btoa(JSON.stringify({
    g: vy.gameNumber, gi: vy.guildId, gc: vy.gameChannelId,
    vt: vy.voyanteThreadId, lm: vy.lobbyMessageId, vi: vy.voyanteId,
    t: vy.targets.map((t) => [t.id, t.name]),
    dl: vy.deadline, ar: vy.allRoles, rs: vy.resolved,
  }));
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
    };
  } catch { return null; }
}

export function parseVoyanteFromEmbed(message: any): VoyanteState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/vy/")) return null;
  return decodeVoyanteState(embed.url);
}

export function buildVoyanteEmbed(vy: VoyanteState) {
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
      title: `🔮 Vision de la Voyante — Partie #${vy.gameNumber}`,
      url: stateUrl,
      description: [
        "**Qui veux-tu espionner cette nuit?**",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "Choisis un joueur pour découvrir son rôle.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `⏰ Fin <t:${vy.deadline}:R>`,
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
}

export function encodeSorciereState(so: SorciereState): string {
  return btoa(JSON.stringify({
    g: so.gameNumber, gi: so.guildId, gc: so.gameChannelId,
    st: so.sorciereThreadId, lm: so.lobbyMessageId, si: so.sorciereId,
    wv: so.wolfVictimId, wn: so.wolfVictimName,
    po: so.potions,
    t: so.targets.map((t) => [t.id, t.name]),
    dl: so.deadline, rs: so.resolved,
    ws: so.witchSaved, wk: so.witchKillTargetId,
  }));
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
    };
  } catch { return null; }
}

export function parseSorciereFromEmbed(message: any): SorciereState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/so/")) return null;
  return decodeSorciereState(embed.url);
}

export function buildSorciereEmbed(so: SorciereState) {
  const stateUrl = `https://garou.bot/so/${encodeSorciereState(so)}`;

  const buttons: any[] = [];
  if (so.potions.life) {
    buttons.push({
      type: 2, style: 3,
      label: "💚 Potion de Vie",
      custom_id: `sorciere_life_${so.gameNumber}`,
    });
  }
  if (so.potions.death) {
    buttons.push({
      type: 2, style: 4,
      label: "💀 Potion de Mort",
      custom_id: `sorciere_death_${so.gameNumber}`,
    });
  }
  buttons.push({
    type: 2, style: 2,
    label: "⏭️ Passer",
    custom_id: `sorciere_skip_${so.gameNumber}`,
  });

  return {
    embeds: [{
      title: `🧪 Sorcière — Partie #${so.gameNumber}`,
      url: stateUrl,
      description: [
        `Les loups-garous ont choisi de dévorer **${so.wolfVictimName}** cette nuit.`,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        so.potions.life ? "💚 **Potion de Vie** — Sauvez la victime" : "~~💚 Potion de Vie~~ *(utilisée)*",
        so.potions.death ? "💀 **Potion de Mort** — Éliminez quelqu'un" : "~~💀 Potion de Mort~~ *(utilisée)*",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `⏰ Fin <t:${so.deadline}:R>`,
      ].join("\n"),
      color: EMBED_COLOR_PURPLE,
      thumbnail: { url: getRoleImage("sorciere") },
    }],
    components: [{ type: 1, components: buttons }],
  };
}

export function buildSorciereTargetEmbed(so: SorciereState) {
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
      title: `🧪 Potion de Mort — Partie #${so.gameNumber}`,
      url: stateUrl,
      description: [
        "**Qui veux-tu empoisonner cette nuit?**",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `⏰ Fin <t:${so.deadline}:R>`,
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
}

export function encodeCupidonState(s: CupidonState): string {
  return btoa(JSON.stringify({
    g: s.gameNumber, gi: s.guildId, gc: s.gameChannelId, lm: s.lobbyMessageId,
    cu: s.cupidonId, pl: s.players.map(p => [p.id, p.name]),
    pk: s.picks, dl: s.deadline, r: s.roles, ap: s.allPlayers,
  }));
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
    };
  } catch { return null; }
}

export function parseCupidonFromEmbed(message: any): CupidonState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/cu/")) return null;
  return decodeCupidonState(embed.url);
}

export function buildCupidonEmbed(s: CupidonState) {
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
      label: `✅ Confirmer: ${names[0]} & ${names[1]}`,
      custom_id: `cupidon_confirm_${s.gameNumber}`,
    }] });
  }

  return {
    embeds: [{
      title: `💘 Cupidon — Choisis le couple — Partie #${s.gameNumber}`,
      url: stateUrl,
      description: [
        "**Lie deux joueurs par l'amour.**",
        "Si l'un meurt, l'autre meurt aussi.",
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        s.picks.length === 0 ? "*Choisis 2 joueurs...*"
          : s.picks.length === 1 ? `💘 <@${s.picks[0]}> + *...?*`
          : `💘 <@${s.picks[0]}> & <@${s.picks[1]}>`,
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        `⏰ Temps restant <t:${s.deadline}:R>`,
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
}

export function encodeChasseurState(s: ChasseurState): string {
  return btoa(JSON.stringify({
    g: s.gameNumber, gi: s.guildId, gc: s.gameChannelId, lm: s.lobbyMessageId,
    ch: s.chasseurId, t: s.targets.map(t => [t.id, t.name]),
    dl: s.deadline, r: s.roles, ap: s.allPlayers, cp: s.couple, d: s.dead,
  }));
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
    };
  } catch { return null; }
}

export function parseChasseurFromEmbed(message: any): ChasseurState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/hs/")) return null;
  return decodeChasseurState(embed.url);
}

export function buildChasseurEmbed(s: ChasseurState) {
  const stateUrl = `https://garou.bot/hs/${encodeChasseurState(s)}`;
  const buttonRows: any[] = [];
  let currentRow: any[] = [];
  for (const t of s.targets) {
    currentRow.push({
      type: 2, style: 4,
      label: `🎯 ${t.name}`,
      custom_id: `chasseur_shoot_${s.gameNumber}_${t.id}`,
    });
    if (currentRow.length === 5) {
      buttonRows.push({ type: 1, components: currentRow });
      currentRow = [];
    }
  }
  if (currentRow.length > 0) buttonRows.push({ type: 1, components: currentRow });

  return {
    embeds: [{
      title: `🏹 Chasseur — Dernier tir! — Partie #${s.gameNumber}`,
      url: stateUrl,
      description: [
        "**Tu meurs... mais tu emportes quelqu'un avec toi!**",
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        "Choisis ta dernière cible.",
        "", "━━━━━━━━━━━━━━━━━━━━", "",
        `⏰ Temps restant <t:${s.deadline}:R>`,
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
    };
  } catch { return null; }
}

export function parseDayVoteFromEmbed(message: any): DayVoteState | null {
  const embed = message.embeds?.[0];
  if (!embed?.url?.includes("/dv/")) return null;
  return decodeDayVoteState(embed.url);
}

// ─── Game Embeds (Lobby, Announce, Role Check) ─────────────────────────────

export function buildRoleCheckEmbed(game: GameState) {
  const seen = game.seen ?? [];
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  const playerLines = game.players.map((id) => {
    const checked = seen.includes(id);
    return `${checked ? "✅" : "⬜"} <@${id}>`;
  });

  return {
    embeds: [{
      title: `🔮 Découvrez vos rôles — Partie #${game.gameNumber}`,
      url: stateUrl,
      description: [
        "Cliquez sur le bouton pour découvrir votre rôle en **secret**.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        ...playerLines,
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `✅ **${seen.filter(id => !id.startsWith("bot_")).length}/${game.players.length}** ont vu leur rôle`,
      ].join("\n"),
      color: EMBED_COLOR_PURPLE,
      image: { url: SCENE_IMAGES.game_start },
      footer: { text: "🤫 Ne révèle ton rôle à personne!" },
    }],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 1,
        label: "🔮 Voir mon rôle",
        custom_id: `reveal_role_${game.gameNumber}`,
      }],
    }],
  };
}

export function buildAnnounceEmbed(game: GameState, bots: BotPlayer[] = []) {
  const totalCount = game.players.length + (game.botCount ?? bots.length);
  const isFull = totalCount >= game.maxPlayers;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  const lines = [
    progressBar(totalCount, game.maxPlayers),
    `**${totalCount}/${game.maxPlayers}** joueurs`,
    "",
  ];

  if (game.players.length > 0) {
    lines.push(game.players.map((id) => `> <@${id}>`).join("\n"));
  }
  if ((game.botCount ?? bots.length) > 0) {
    lines.push(`> 🤖 **${game.botCount ?? bots.length} bot(s)**`);
  }
  if (game.players.length > 0 || (game.botCount ?? bots.length) > 0) {
    lines.push("");
  }

  lines.push(
    isFull ? "**La partie est pleine!**" : "Cliquez sur le bouton ci-dessous pour rejoindre!"
  );

  return {
    embeds: [
      {
        title: `🐺 Partie de Loup-Garou #${game.gameNumber}`,
        url: stateUrl,
        description: lines.join("\n"),
        color: isFull ? EMBED_COLOR_GREEN : EMBED_COLOR,
        image: { url: SCENE_IMAGES.game_start },
        footer: { text: `Créée par ${game.creatorName}` },
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
                label: "🐺 Rejoindre la partie",
                custom_id: `join_game_${game.gameNumber}`,
              },
            ],
          },
        ],
  };
}

export function buildLobbyEmbed(game: GameState, bots: BotPlayer[] = [], lastEvent?: string) {
  const totalCount = game.players.length + bots.length;
  const isFull = totalCount >= game.maxPlayers;
  const canStart = totalCount >= MIN_PLAYERS;
  const stateUrl = `https://garou.bot/s/${encodeState(game)}`;

  const playerLines = game.players.map((id) => {
    const icon = id === game.creatorId ? "👑" : "🐺";
    return `${icon} <@${id}>`;
  });
  for (const bot of bots) {
    playerLines.push(`🤖 ${bot.emoji} ${bot.name} (Bot)`);
  }
  for (let i = totalCount; i < game.maxPlayers; i++) {
    playerLines.push("⬜ *En attente...*");
  }

  const statusEmoji = isFull ? "🟢" : canStart ? "🟡" : "🔴";
  const statusText = isFull
    ? "La partie est pleine! Prêt à lancer."
    : canStart
      ? "Prêt à lancer ou en attente de joueurs..."
      : `En attente de joueurs (min. ${MIN_PLAYERS})`;

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
      label: "▶️ Lancer la partie",
      custom_id: `start_game_${game.gameNumber}`,
    });
  }
  buttons.push({
    type: 2,
    style: 4,
    label: "🚪 Quitter la partie",
    custom_id: `quit_game_${game.gameNumber}`,
  });

  return {
    embeds: [
      {
        title: `🐺 Salle d'attente — Partie #${game.gameNumber}`,
        url: stateUrl,
        description: lines.join("\n"),
        color: canStart ? (isFull ? EMBED_COLOR_GREEN : EMBED_COLOR_ORANGE) : EMBED_COLOR,
        image: { url: SCENE_IMAGES.game_start },
        footer: { text: `Créée par ${game.creatorName}` },
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
