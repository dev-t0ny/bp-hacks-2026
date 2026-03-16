import {
  encodeState,
  decodeState,
  assignRoles,
  checkWinCondition,
  roleIdToKey,
  ROLE_ID_TO_KEY,
  ROLES,
  secureRandom,
  type GameState,
} from "../game-logic";

const makeGame = (overrides: Partial<GameState> = {}): GameState => ({
  gameNumber: 1,
  creatorId: "creator1",
  creatorName: "TestCreator",
  guildId: "guild1",
  gameChannelId: "channel1",
  maxPlayers: 6,
  players: ["p1", "p2", "p3", "p4"],
  ...overrides,
});

// ---------------------------------------------------------------------------
// encodeState / decodeState
// ---------------------------------------------------------------------------

describe("encodeState / decodeState", () => {
  it("round-trip: encode a full GameState, decode it back, all fields match", () => {
    const game = makeGame({
      lobbyMessageId: "lobby1",
      announceChannelId: "announce1",
      announceMessageId: "announceMsg1",
      wolfChannelId: "wolf1",
      roles: { p1: "loup", p2: "voyante", p3: "villageois", p4: "sorciere" },
      seen: ["p2"],
      couple: ["p1", "p3"],
      petiteFilleThreadId: "thread1",
      nightCount: 3,
      dead: ["p4"],
      witchPotions: { life: true, death: false },
      discussionTime: 90,
      voteTime: 45,
      selectedRoleIds: [2, 47],
      botCount: 2,
    });

    const encoded = encodeState(game);
    const decoded = decodeState(`https://garou.bot/s/${encoded}`);

    expect(decoded).not.toBeNull();
    expect(decoded!.gameNumber).toBe(game.gameNumber);
    expect(decoded!.creatorId).toBe(game.creatorId);
    expect(decoded!.creatorName).toBe(game.creatorName);
    expect(decoded!.guildId).toBe(game.guildId);
    expect(decoded!.gameChannelId).toBe(game.gameChannelId);
    expect(decoded!.maxPlayers).toBe(game.maxPlayers);
    expect(decoded!.players).toEqual(game.players);
    expect(decoded!.lobbyMessageId).toBe(game.lobbyMessageId);
    expect(decoded!.announceChannelId).toBe(game.announceChannelId);
    expect(decoded!.announceMessageId).toBe(game.announceMessageId);
    expect(decoded!.wolfChannelId).toBe(game.wolfChannelId);
    expect(decoded!.roles).toEqual(game.roles);
    expect(decoded!.seen).toEqual(game.seen);
    expect(decoded!.couple).toEqual(game.couple);
    expect(decoded!.petiteFilleThreadId).toBe(game.petiteFilleThreadId);
    expect(decoded!.nightCount).toBe(game.nightCount);
    expect(decoded!.dead).toEqual(game.dead);
    expect(decoded!.witchPotions).toEqual(game.witchPotions);
    expect(decoded!.discussionTime).toBe(game.discussionTime);
    expect(decoded!.voteTime).toBe(game.voteTime);
    expect(decoded!.selectedRoleIds).toEqual(game.selectedRoleIds);
    expect(decoded!.botCount).toBe(game.botCount);
  });

  it("webhook fields: webhookId and webhookToken survive round-trip", () => {
    const game = makeGame({
      webhookId: "1234567890123456789",
      webhookToken: "abcdefghijklmnopqrstuvwxyz_ABCDEF.0123456789",
    });
    const encoded = encodeState(game);
    const decoded = decodeState(`https://garou.bot/s/${encoded}`);

    expect(decoded).not.toBeNull();
    expect(decoded!.webhookId).toBe("1234567890123456789");
    expect(decoded!.webhookToken).toBe("abcdefghijklmnopqrstuvwxyz_ABCDEF.0123456789");
  });

  it("webhook fields: absent webhookId/webhookToken decode as undefined", () => {
    const game = makeGame();
    const encoded = encodeState(game);
    const decoded = decodeState(`https://garou.bot/s/${encoded}`);

    expect(decoded).not.toBeNull();
    expect(decoded!.webhookId).toBeUndefined();
    expect(decoded!.webhookToken).toBeUndefined();
  });

  it("minimal state: encode with only required fields, decode, verify defaults", () => {
    const game = makeGame();
    const encoded = encodeState(game);
    const decoded = decodeState(`https://garou.bot/s/${encoded}`);

    expect(decoded).not.toBeNull();
    expect(decoded!.gameNumber).toBe(1);
    expect(decoded!.players).toEqual(["p1", "p2", "p3", "p4"]);
    // Defaults
    expect(decoded!.dead).toEqual([]);
    expect(decoded!.seen).toEqual([]);
    expect(decoded!.nightCount).toBe(0);
    expect(decoded!.discussionTime).toBe(120);
    expect(decoded!.voteTime).toBe(60);
    expect(decoded!.botCount).toBe(0);
    expect(decoded!.roles).toBeUndefined();
    expect(decoded!.couple).toBeUndefined();
  });

  it("malformed input: decodeState('garbage') returns null", () => {
    expect(decodeState("garbage")).toBeNull();
  });

  it("missing /s/ prefix: decodeState('https://garou.bot/x/...') returns null", () => {
    const game = makeGame();
    const encoded = encodeState(game);
    expect(decodeState(`https://garou.bot/x/${encoded}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// assignRoles
// ---------------------------------------------------------------------------

describe("assignRoles", () => {
  it("correct count: result has exactly humanIds.length + botIds.length entries", () => {
    const humans = ["h1", "h2", "h3", "h4"];
    const bots = ["b1", "b2"];
    const result = assignRoles(humans, bots);
    expect(Object.keys(result).length).toBe(humans.length + bots.length);
  });

  it("wolf ratio: at least 1 wolf in every assignment", () => {
    for (let i = 0; i < 20; i++) {
      const humans = ["h1", "h2", "h3", "h4", "h5"];
      const bots = ["b1"];
      const result = assignRoles(humans, bots);
      const wolves = Object.values(result).filter(
        (r) => r === "loup" || r === "loup_blanc",
      );
      expect(wolves.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("roles are fully random — bots can get special roles", () => {
    // Run many iterations; bots should eventually get a special role
    let botGotSpecial = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      const humans = ["h1"];
      const bots = ["b1", "b2", "b3", "b4"];
      const result = assignRoles(humans, bots);
      const botRoles = bots.map((id) => result[id]!);
      if (botRoles.some((r) => r !== "loup" && r !== "villageois")) {
        botGotSpecial = true;
        break;
      }
    }
    expect(botGotSpecial).toBe(true);
  });

  it("with selectedRoleIds: selected roles are preserved (e.g. [2, 47] = voyante + loup)", () => {
    const humans = ["h1", "h2", "h3", "h4"];
    const bots: string[] = [];
    const result = assignRoles(humans, bots, [2, 47]);
    const roles = Object.values(result);

    expect(roles).toContain("voyante");
    expect(roles).toContain("loup");
  });

  it("wolf fallback: if selectedRoleIds has no wolf ID, 'loup' is added", () => {
    const humans = ["h1", "h2", "h3", "h4"];
    const bots: string[] = [];
    // IDs 2 and 3 are voyante and sorciere -- no wolves
    const result = assignRoles(humans, bots, [2, 3]);
    const roles = Object.values(result);

    expect(roles).toContain("loup");
  });

  it("with deterministic rng, results are reproducible", () => {
    const humans = ["h1", "h2", "h3", "h4", "h5"];
    const bots = ["b1"];

    let i1 = 0;
    const rng1 = () => (i1++ % 10) / 10;
    const result1 = assignRoles(humans, bots, undefined, rng1);

    let i2 = 0;
    const rng2 = () => (i2++ % 10) / 10;
    const result2 = assignRoles(humans, bots, undefined, rng2);

    expect(result1).toEqual(result2);
  });
});

// ---------------------------------------------------------------------------
// checkWinCondition
// ---------------------------------------------------------------------------

describe("checkWinCondition", () => {
  it("village wins: all wolves dead, some villagers alive", () => {
    const game = makeGame({
      roles: {
        p1: "loup",
        p2: "voyante",
        p3: "villageois",
        p4: "sorciere",
      },
      dead: ["p1"],
    });
    const result = checkWinCondition(game);
    expect(result).not.toBeNull();
    expect(result!.winner).toBe("village");
  });

  it("wolves win: wolves >= villagers", () => {
    const game = makeGame({
      roles: {
        p1: "loup",
        p2: "loup",
        p3: "villageois",
        p4: "sorciere",
      },
      dead: ["p4"],
    });
    // Alive: p1(loup), p2(loup), p3(villageois) => 2 wolves >= 1 villager
    const result = checkWinCondition(game);
    expect(result).not.toBeNull();
    expect(result!.winner).toBe("loups");
  });

  it("loup blanc solo: only loup_blanc alive", () => {
    const game = makeGame({
      roles: {
        p1: "loup_blanc",
        p2: "loup",
        p3: "villageois",
        p4: "sorciere",
      },
      dead: ["p2", "p3", "p4"],
    });
    const result = checkWinCondition(game);
    expect(result).not.toBeNull();
    expect(result!.winner).toBe("loup_blanc");
  });

  it("in progress: wolves < villagers", () => {
    const game = makeGame({
      roles: {
        p1: "loup",
        p2: "voyante",
        p3: "villageois",
        p4: "sorciere",
      },
      dead: [],
    });
    // Alive: 1 wolf, 3 villagers => game continues
    const result = checkWinCondition(game);
    expect(result).toBeNull();
  });

  it("no roles: game.roles undefined returns null", () => {
    const game = makeGame({ roles: undefined });
    const result = checkWinCondition(game);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// roleIdToKey
// ---------------------------------------------------------------------------

describe("roleIdToKey", () => {
  it("known IDs: 2->voyante, 3->sorciere, 4->chasseur, 47->loup", () => {
    expect(roleIdToKey(2)).toBe("voyante");
    expect(roleIdToKey(3)).toBe("sorciere");
    expect(roleIdToKey(4)).toBe("chasseur");
    expect(roleIdToKey(47)).toBe("loup");
  });

  it("unknown ID: 0->villageois, 99->villageois", () => {
    expect(roleIdToKey(0)).toBe("villageois");
    expect(roleIdToKey(99)).toBe("villageois");
  });
});

// ---------------------------------------------------------------------------
// secureRandom
// ---------------------------------------------------------------------------

describe("secureRandom", () => {
  it("with custom rng: secureRandom(() => 0.5) returns 0.5", () => {
    expect(secureRandom(() => 0.5)).toBe(0.5);
  });

  it("without rng: returns a number between 0 and 1", () => {
    const value = secureRandom();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  });
});
