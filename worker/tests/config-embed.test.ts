import {
  encodeConfigState,
  decodeConfigState,
  buildStep1Embed,
  findPreset,
  updateRolesForGroup,
  type ConfigState,
} from "../config-embed";

// ── encodeConfigState / decodeConfigState round-trip ─────────────────

describe("encodeConfigState / decodeConfigState round-trip", () => {
  const config: ConfigState = {
    step: 1,
    creatorId: "creator1",
    guildId: "guild1",
    channelId: "channel1",
    presetName: "Classique",
    anonymousVotes: false,
    discussionTime: 120,
    voteTime: 60,
    selectedRoles: [0, 2, 3, 4, 5, 47],
    botCount: 2,
    maxPlayers: 8,
  };

  it("encodes and decodes back to the same config", () => {
    const encoded = encodeConfigState(config);
    const url = `https://garou.bot/c/${encoded}`;
    const decoded = decodeConfigState(url);

    expect(decoded).not.toBeNull();
    expect(decoded!.step).toBe(config.step);
    expect(decoded!.creatorId).toBe(config.creatorId);
    expect(decoded!.guildId).toBe(config.guildId);
    expect(decoded!.channelId).toBe(config.channelId);
    expect(decoded!.presetName).toBe(config.presetName);
    expect(decoded!.anonymousVotes).toBe(config.anonymousVotes);
    expect(decoded!.discussionTime).toBe(config.discussionTime);
    expect(decoded!.voteTime).toBe(config.voteTime);
    expect(decoded!.selectedRoles).toEqual(config.selectedRoles);
    expect(decoded!.botCount).toBe(config.botCount);
  });

  it("preserves maxPlayers in round-trip", () => {
    const encoded = encodeConfigState(config);
    const url = `https://garou.bot/c/${encoded}`;
    const decoded = decodeConfigState(url);

    expect(decoded).not.toBeNull();
    expect(decoded!.maxPlayers).toBe(8);
  });

  it("returns null for malformed URL", () => {
    expect(decodeConfigState("not-a-valid-url")).toBeNull();
  });
});

// ── buildStep1Embed ─────────────────────────────────────────────────

describe("buildStep1Embed", () => {
  const defaultConfig: ConfigState = {
    step: 1,
    creatorId: "creator1",
    guildId: "guild1",
    channelId: "channel1",
    presetName: "Classique",
    anonymousVotes: false,
    discussionTime: 120,
    voteTime: 60,
    selectedRoles: [0, 2, 3, 4, 5, 47],
    botCount: 0,
    maxPlayers: 6,
  };

  it("returns embeds array with 1 embed", () => {
    const result = buildStep1Embed(defaultConfig);
    expect(result.embeds).toBeInstanceOf(Array);
    expect(result.embeds).toHaveLength(1);
  });

  it("returns components array", () => {
    const result = buildStep1Embed(defaultConfig);
    expect(result.components).toBeInstanceOf(Array);
    expect(result.components.length).toBeGreaterThan(0);
  });

  it('cfg_timers dropdown includes "Ultra rapide — 30s / 30s" option with value "30_30"', () => {
    const result = buildStep1Embed(defaultConfig);
    const timersRow = result.components.find((row: any) =>
      row.components?.some((c: any) => c.custom_id === "cfg_timers"),
    );
    expect(timersRow).toBeTruthy();

    const timersSelect = timersRow!.components.find(
      (c: any) => c.custom_id === "cfg_timers",
    );
    expect(timersSelect).toBeTruthy();

    const ultraRapideOption = timersSelect!.options.find(
      (o: any) => o.value === "30_30",
    );
    expect(ultraRapideOption).toBeTruthy();
    expect(ultraRapideOption!.label).toContain("Ultra rapide");
  });

  it('cfg_timers dropdown includes "Rapide — 1m / 30s" option with value "60_30"', () => {
    const result = buildStep1Embed(defaultConfig);
    const timersRow = result.components.find((row: any) =>
      row.components?.some((c: any) => c.custom_id === "cfg_timers"),
    );
    const timersSelect = timersRow!.components.find(
      (c: any) => c.custom_id === "cfg_timers",
    );

    const rapideOption = timersSelect!.options.find(
      (o: any) => o.value === "60_30",
    );
    expect(rapideOption).toBeTruthy();
    expect(rapideOption!.label).toContain("Rapide");
  });
});

// ── findPreset ──────────────────────────────────────────────────────

describe("findPreset", () => {
  it("finds a default preset by name", () => {
    const preset = findPreset("Classique");
    expect(preset).toBeTruthy();
    expect(preset!.name).toBe("Classique");
  });

  it("finds a custom preset with custom: prefix", () => {
    const customPresets = [
      {
        name: "MyPreset",
        roles: [0, 47],
        anonymousVotes: false,
        discussionTime: 120,
        voteTime: 60,
      },
    ];
    const preset = findPreset("custom:MyPreset", customPresets);
    expect(preset).toBeTruthy();
    expect(preset!.name).toBe("MyPreset");
  });

  it("returns undefined for non-existent preset", () => {
    expect(findPreset("DoesNotExist")).toBeUndefined();
  });
});

// ── updateRolesForGroup ─────────────────────────────────────────────

describe("updateRolesForGroup", () => {
  it("replaces group roles correctly", () => {
    const result = updateRolesForGroup([1, 2, 3, 47], [1, 2, 3], [2, 3, 4]);
    expect(result).toEqual([2, 3, 4, 47]);
  });

  it("empty new selection removes group", () => {
    const result = updateRolesForGroup([1, 2, 47], [1, 2], []);
    expect(result).toEqual([47]);
  });
});
