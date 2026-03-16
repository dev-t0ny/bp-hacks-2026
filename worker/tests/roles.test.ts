import {
  rolesToBitmask,
  bitmaskToRoles,
  DEFAULT_PRESETS,
  ALL_ROLES,
  LOUPS_ROLES,
} from "../roles";

// ── rolesToBitmask / bitmaskToRoles round-trip ──────────────────────

describe("rolesToBitmask / bitmaskToRoles round-trip", () => {
  it("empty array round-trips", () => {
    const bitmask = rolesToBitmask([]);
    const result = bitmaskToRoles(bitmask);
    expect(result).toEqual([]);
  });

  it("single role round-trips", () => {
    const bitmask = rolesToBitmask([0]);
    const result = bitmaskToRoles(bitmask);
    expect(result).toEqual([0]);
  });

  it("multiple roles round-trip (sorted)", () => {
    const roles = [0, 2, 3, 47];
    const bitmask = rolesToBitmask(roles);
    const result = bitmaskToRoles(bitmask);
    expect(result).toEqual([0, 2, 3, 47]);
  });

  it("full set round-trips", () => {
    const roles = [0, 1, 2, 3, 4, 5, 47, 48, 54];
    const bitmask = rolesToBitmask(roles);
    const result = bitmaskToRoles(bitmask);
    expect(result).toEqual([0, 1, 2, 3, 4, 5, 47, 48, 54]);
  });
});

// ── DEFAULT_PRESETS validation ──────────────────────────────────────

describe("DEFAULT_PRESETS validation", () => {
  it("each preset has at least one wolf (role ID >= 47 and <= 53)", () => {
    for (const preset of DEFAULT_PRESETS) {
      const hasWolf = preset.roles.some((id) => id >= 47 && id <= 53);
      expect(hasWolf).toBe(true);
    }
  });

  it("each preset has at least MIN_PLAYERS=4 roles", () => {
    for (const preset of DEFAULT_PRESETS) {
      expect(preset.roles.length >= 4).toBe(true);
    }
  });

  it("preset names are unique", () => {
    const names = DEFAULT_PRESETS.map((p) => p.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});
