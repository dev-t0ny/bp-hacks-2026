const DISCORD_API = "https://discord.com/api/v10";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

const headers = {
  Authorization: `Bot ${BOT_TOKEN}`,
  "Content-Type": "application/json",
};

async function discordFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function sendMessage(channelId: string, body: Record<string, unknown>) {
  return discordFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function editMessage(channelId: string, messageId: string, body: Record<string, unknown>) {
  return discordFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function createChannel(guildId: string, body: Record<string, unknown>) {
  return discordFetch(`/guilds/${guildId}/channels`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function setChannelPermission(
  channelId: string,
  targetId: string,
  body: { allow?: string; deny?: string; type: 0 | 1 }
) {
  return discordFetch(`/channels/${channelId}/permissions/${targetId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function getGuildChannels(guildId: string) {
  return discordFetch(`/guilds/${guildId}/channels`);
}

export async function getGuildMember(guildId: string, userId: string) {
  return discordFetch(`/guilds/${guildId}/members/${userId}`);
}

export async function getBotUser() {
  return discordFetch("/users/@me");
}
