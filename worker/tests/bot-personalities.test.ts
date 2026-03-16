import { BOT_POOL, pickBots, type BotPersonality } from "../bot-personalities";

describe("BOT_POOL", () => {
  it("every bot has a unique name", () => {
    const names = BOT_POOL.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every bot has a non-empty avatarUrl using DiceBear", () => {
    for (const bot of BOT_POOL) {
      expect(bot.avatarUrl).toContain("api.dicebear.com");
      expect(bot.avatarUrl).toContain(encodeURIComponent(bot.name));
    }
  });

  it("avatarUrl is deterministic for a given name", () => {
    const marcel1 = BOT_POOL.find((b) => b.name === "Marcel")!;
    const marcel2 = BOT_POOL.find((b) => b.name === "Marcel")!;
    expect(marcel1.avatarUrl).toBe(marcel2.avatarUrl);
  });

  it("different bots have different avatarUrls", () => {
    const urls = BOT_POOL.map((b) => b.avatarUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("pickBots", () => {
  it("returns requested number of bots", () => {
    const bots = pickBots(3);
    expect(bots).toHaveLength(3);
  });

  it("returns at most pool size bots", () => {
    const bots = pickBots(100);
    expect(bots.length).toBeLessThanOrEqual(BOT_POOL.length);
  });

  it("all picked bots have avatarUrl", () => {
    const bots = pickBots(5);
    for (const bot of bots) {
      expect(bot.avatarUrl).toBeDefined();
      expect(bot.avatarUrl).toContain("api.dicebear.com");
    }
  });

  it("picked bots have unique names", () => {
    const bots = pickBots(10);
    const names = bots.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
