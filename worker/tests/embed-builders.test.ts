import {
  encodeVoteState,
  decodeVoteState,
  buildVoteEmbed,
  encodeVoyanteState,
  decodeVoyanteState,
  buildVoyanteEmbed,
  encodeSorciereState,
  decodeSorciereState,
  buildSorciereEmbed,
  encodeCupidonState,
  decodeCupidonState,
  buildCupidonEmbed,
  encodeChasseurState,
  decodeChasseurState,
  buildChasseurEmbed,
  encodeDayVoteState,
  decodeDayVoteState,
  buildLobbyEmbed,
  buildAnnounceEmbed,
  parseGameFromEmbed,
  buildRoleCheckEmbed,
  type VoteState,
  type VoyanteState,
  type SorciereState,
  type CupidonState,
  type ChasseurState,
  type DayVoteState,
} from "../embed-builders";
import { encodeState, type GameState } from "../game-logic";

// ─── 1. VoteState encode/decode round-trip ──────────────────────────────────

describe("VoteState encode/decode round-trip", () => {
  const vote: VoteState = {
    gameNumber: 1,
    guildId: "g1",
    gameChannelId: "gc1",
    wolfChannelId: "wc1",
    lobbyMessageId: "lm1",
    wolves: ["w1", "w2"],
    targets: [
      { id: "t1", name: "Alice" },
      { id: "t2", name: "Bob" },
    ],
    votes: { w1: "t1" },
    deadline: 1700000000,
  };

  it("round-trips correctly", () => {
    const encoded = encodeVoteState(vote);
    const url = `https://garou.bot/v/${encoded}`;
    const decoded = decodeVoteState(url);

    expect(decoded).not.toBeNull();
    expect(decoded!.gameNumber).toBe(vote.gameNumber);
    expect(decoded!.guildId).toBe(vote.guildId);
    expect(decoded!.gameChannelId).toBe(vote.gameChannelId);
    expect(decoded!.wolfChannelId).toBe(vote.wolfChannelId);
    expect(decoded!.lobbyMessageId).toBe(vote.lobbyMessageId);
    expect(decoded!.wolves).toEqual(vote.wolves);
    expect(decoded!.targets).toEqual(vote.targets);
    expect(decoded!.votes).toEqual(vote.votes);
    expect(decoded!.deadline).toBe(vote.deadline);
  });

  it("returns null for malformed input", () => {
    expect(decodeVoteState("not-a-valid-url")).toBeNull();
    expect(decodeVoteState("https://garou.bot/v/!!!invalid-base64!!!")).toBeNull();
  });
});

// ─── 2. VoyanteState encode/decode round-trip ───────────────────────────────

describe("VoyanteState encode/decode round-trip", () => {
  const vy: VoyanteState = {
    gameNumber: 1,
    guildId: "g1",
    gameChannelId: "gc1",
    voyanteThreadId: "vt1",
    lobbyMessageId: "lm1",
    voyanteId: "v1",
    targets: [{ id: "t1", name: "Alice" }],
    deadline: 1700000000,
    allRoles: { t1: "loup" },
  };

  it("round-trips correctly", () => {
    const encoded = encodeVoyanteState(vy);
    const url = `https://garou.bot/vy/${encoded}`;
    const decoded = decodeVoyanteState(url);

    expect(decoded).not.toBeNull();
    expect(decoded!.gameNumber).toBe(vy.gameNumber);
    expect(decoded!.guildId).toBe(vy.guildId);
    expect(decoded!.gameChannelId).toBe(vy.gameChannelId);
    expect(decoded!.voyanteThreadId).toBe(vy.voyanteThreadId);
    expect(decoded!.lobbyMessageId).toBe(vy.lobbyMessageId);
    expect(decoded!.voyanteId).toBe(vy.voyanteId);
    expect(decoded!.targets).toEqual(vy.targets);
    expect(decoded!.deadline).toBe(vy.deadline);
    expect(decoded!.allRoles).toEqual(vy.allRoles);
  });

  it("returns null for malformed input", () => {
    expect(decodeVoyanteState("not-a-valid-url")).toBeNull();
    expect(decodeVoyanteState("https://garou.bot/vy/!!!bad!!!")).toBeNull();
  });
});

// ─── 3. SorciereState encode/decode round-trip ──────────────────────────────

describe("SorciereState encode/decode round-trip", () => {
  const so: SorciereState = {
    gameNumber: 1,
    guildId: "g1",
    gameChannelId: "gc1",
    sorciereThreadId: "st1",
    lobbyMessageId: "lm1",
    sorciereId: "s1",
    wolfVictimId: "v1",
    wolfVictimName: "Alice",
    potions: { life: true, death: true },
    targets: [{ id: "t1", name: "Bob" }],
    deadline: 1700000000,
  };

  it("round-trips correctly", () => {
    const encoded = encodeSorciereState(so);
    const url = `https://garou.bot/so/${encoded}`;
    const decoded = decodeSorciereState(url);

    expect(decoded).not.toBeNull();
    expect(decoded!.gameNumber).toBe(so.gameNumber);
    expect(decoded!.guildId).toBe(so.guildId);
    expect(decoded!.gameChannelId).toBe(so.gameChannelId);
    expect(decoded!.sorciereThreadId).toBe(so.sorciereThreadId);
    expect(decoded!.lobbyMessageId).toBe(so.lobbyMessageId);
    expect(decoded!.sorciereId).toBe(so.sorciereId);
    expect(decoded!.wolfVictimId).toBe(so.wolfVictimId);
    expect(decoded!.wolfVictimName).toBe(so.wolfVictimName);
    expect(decoded!.potions).toEqual(so.potions);
    expect(decoded!.targets).toEqual(so.targets);
    expect(decoded!.deadline).toBe(so.deadline);
  });

  it("returns null for malformed input", () => {
    expect(decodeSorciereState("not-a-valid-url")).toBeNull();
    expect(decodeSorciereState("https://garou.bot/so/!!!bad!!!")).toBeNull();
  });
});

// ─── 4. CupidonState encode/decode round-trip ───────────────────────────────

describe("CupidonState encode/decode round-trip", () => {
  const cu: CupidonState = {
    gameNumber: 1,
    guildId: "g1",
    gameChannelId: "gc1",
    lobbyMessageId: "lm1",
    cupidonId: "c1",
    players: [
      { id: "p1", name: "Alice" },
      { id: "p2", name: "Bob" },
    ],
    picks: ["p1"],
    deadline: 1700000000,
    roles: { p1: "cupidon" },
    allPlayers: ["p1", "p2"],
  };

  it("round-trips correctly", () => {
    const encoded = encodeCupidonState(cu);
    const url = `https://garou.bot/cu/${encoded}`;
    const decoded = decodeCupidonState(url);

    expect(decoded).not.toBeNull();
    expect(decoded!.gameNumber).toBe(cu.gameNumber);
    expect(decoded!.guildId).toBe(cu.guildId);
    expect(decoded!.gameChannelId).toBe(cu.gameChannelId);
    expect(decoded!.lobbyMessageId).toBe(cu.lobbyMessageId);
    expect(decoded!.cupidonId).toBe(cu.cupidonId);
    expect(decoded!.players).toEqual(cu.players);
    expect(decoded!.picks).toEqual(cu.picks);
    expect(decoded!.deadline).toBe(cu.deadline);
    expect(decoded!.roles).toEqual(cu.roles);
    expect(decoded!.allPlayers).toEqual(cu.allPlayers);
  });

  it("returns null for malformed input", () => {
    expect(decodeCupidonState("not-a-valid-url")).toBeNull();
    expect(decodeCupidonState("https://garou.bot/cu/!!!bad!!!")).toBeNull();
  });
});

// ─── 5. ChasseurState encode/decode round-trip ──────────────────────────────

describe("ChasseurState encode/decode round-trip", () => {
  const ch: ChasseurState = {
    gameNumber: 1,
    guildId: "g1",
    gameChannelId: "gc1",
    lobbyMessageId: "lm1",
    chasseurId: "h1",
    targets: [{ id: "t1", name: "Alice" }],
    deadline: 1700000000,
    roles: { h1: "chasseur" },
    allPlayers: ["h1", "t1"],
    dead: [],
  };

  it("round-trips correctly", () => {
    const encoded = encodeChasseurState(ch);
    const url = `https://garou.bot/hs/${encoded}`;
    const decoded = decodeChasseurState(url);

    expect(decoded).not.toBeNull();
    expect(decoded!.gameNumber).toBe(ch.gameNumber);
    expect(decoded!.guildId).toBe(ch.guildId);
    expect(decoded!.gameChannelId).toBe(ch.gameChannelId);
    expect(decoded!.lobbyMessageId).toBe(ch.lobbyMessageId);
    expect(decoded!.chasseurId).toBe(ch.chasseurId);
    expect(decoded!.targets).toEqual(ch.targets);
    expect(decoded!.deadline).toBe(ch.deadline);
    expect(decoded!.roles).toEqual(ch.roles);
    expect(decoded!.allPlayers).toEqual(ch.allPlayers);
    expect(decoded!.dead).toEqual(ch.dead);
  });

  it("returns null for malformed input", () => {
    expect(decodeChasseurState("not-a-valid-url")).toBeNull();
    expect(decodeChasseurState("https://garou.bot/hs/!!!bad!!!")).toBeNull();
  });
});

// ─── 6. DayVoteState encode/decode round-trip ───────────────────────────────

describe("DayVoteState encode/decode round-trip", () => {
  const dv: DayVoteState = {
    gameNumber: 1,
    guildId: "g1",
    gameChannelId: "gc1",
    lobbyMessageId: "lm1",
    targets: [{ id: "t1", name: "Alice" }],
    votes: {},
    voters: ["v1", "v2"],
    deadline: 1700000000,
  };

  it("round-trips correctly", () => {
    const encoded = encodeDayVoteState(dv);
    const url = `https://garou.bot/dv/${encoded}`;
    const decoded = decodeDayVoteState(url);

    expect(decoded).not.toBeNull();
    expect(decoded!.gameNumber).toBe(dv.gameNumber);
    expect(decoded!.guildId).toBe(dv.guildId);
    expect(decoded!.gameChannelId).toBe(dv.gameChannelId);
    expect(decoded!.lobbyMessageId).toBe(dv.lobbyMessageId);
    expect(decoded!.targets).toEqual(dv.targets);
    expect(decoded!.votes).toEqual(dv.votes);
    expect(decoded!.voters).toEqual(dv.voters);
    expect(decoded!.deadline).toBe(dv.deadline);
  });

  it("returns null for malformed input", () => {
    expect(decodeDayVoteState("not-a-valid-url")).toBeNull();
    expect(decodeDayVoteState("https://garou.bot/dv/!!!bad!!!")).toBeNull();
  });
});

// ─── 7. buildLobbyEmbed shape ───────────────────────────────────────────────

describe("buildLobbyEmbed shape", () => {
  const game: GameState = {
    gameNumber: 42,
    creatorId: "creator1",
    creatorName: "TestCreator",
    guildId: "guild1",
    gameChannelId: "channel1",
    maxPlayers: 8,
    players: ["creator1", "player2"],
  };

  it("returns embeds array with 1 embed having title, url, description, color", () => {
    const result = buildLobbyEmbed(game, []);

    expect(result.embeds).toBeInstanceOf(Array);
    expect(result.embeds).toHaveLength(1);

    const embed = result.embeds[0];
    expect(embed).toHaveProperty("title");
    expect(embed).toHaveProperty("url");
    expect(embed).toHaveProperty("description");
    expect(embed).toHaveProperty("color");
  });

  it("has a components array", () => {
    const result = buildLobbyEmbed(game, []);
    expect(result.components).toBeInstanceOf(Array);
  });
});

// ─── 8. buildVoteEmbed shape ────────────────────────────────────────────────

describe("buildVoteEmbed shape", () => {
  const vote: VoteState = {
    gameNumber: 1,
    guildId: "g1",
    gameChannelId: "gc1",
    wolfChannelId: "wc1",
    lobbyMessageId: "lm1",
    wolves: ["w1", "w2"],
    targets: [
      { id: "t1", name: "Alice" },
      { id: "t2", name: "Bob" },
    ],
    votes: { w1: "t1" },
    deadline: 1700000000,
  };

  it("returns embeds and components", () => {
    const result = buildVoteEmbed(vote);

    expect(result.embeds).toBeInstanceOf(Array);
    expect(result.embeds.length).toBeGreaterThan(0);
    expect(result.components).toBeInstanceOf(Array);
  });
});

// ─── 9. buildChasseurEmbed shape ────────────────────────────────────────────

describe("buildChasseurEmbed shape", () => {
  const ch: ChasseurState = {
    gameNumber: 1,
    guildId: "g1",
    gameChannelId: "gc1",
    lobbyMessageId: "lm1",
    chasseurId: "h1",
    targets: [{ id: "t1", name: "Alice" }],
    deadline: 1700000000,
    roles: { h1: "chasseur" },
    allPlayers: ["h1", "t1"],
    dead: [],
  };

  it("returns embeds and components", () => {
    const result = buildChasseurEmbed(ch);

    expect(result.embeds).toBeInstanceOf(Array);
    expect(result.embeds.length).toBeGreaterThan(0);
    expect(result.components).toBeInstanceOf(Array);
  });
});

// ─── 10. parseGameFromEmbed round-trip ──────────────────────────────────────

describe("parseGameFromEmbed round-trip", () => {
  it("parses back a GameState from a fake message with encoded embed url", () => {
    const game: GameState = {
      gameNumber: 7,
      creatorId: "c1",
      creatorName: "Alice",
      guildId: "g1",
      gameChannelId: "gc1",
      maxPlayers: 10,
      players: ["c1", "p2", "p3"],
    };

    const encoded = encodeState(game);
    const fakeMessage = {
      embeds: [{ url: `https://garou.bot/s/${encoded}` }],
    };

    const parsed = parseGameFromEmbed(fakeMessage);

    expect(parsed).not.toBeNull();
    expect(parsed!.gameNumber).toBe(game.gameNumber);
    expect(parsed!.creatorId).toBe(game.creatorId);
    expect(parsed!.creatorName).toBe(game.creatorName);
    expect(parsed!.guildId).toBe(game.guildId);
    expect(parsed!.gameChannelId).toBe(game.gameChannelId);
    expect(parsed!.maxPlayers).toBe(game.maxPlayers);
    expect(parsed!.players).toEqual(game.players);
  });
});
