// Run this script to register the /loupgarou slash command with Discord.
// Usage: bun run worker/register-command.ts
// Or: npx tsx worker/register-command.ts

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const APP_ID = "1482380236522787008";

if (!BOT_TOKEN) {
  console.error("❌ Set DISCORD_BOT_TOKEN environment variable");
  process.exit(1);
}

const DISCORD_API = "https://discord.com/api/v10";

async function registerCommands() {
  const commands = [
    {
      name: "loupgarou",
      description: "Créer une nouvelle partie de Loup-Garou",
      type: 1,
    },
  ];

  const res = await fetch(`${DISCORD_API}/applications/${APP_ID}/commands`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ Failed to register commands: ${res.status}`, text);
    process.exit(1);
  }

  const data = await res.json();
  console.log("✅ Commands registered successfully!");
  console.log(JSON.stringify(data, null, 2));
}

registerCommands();
