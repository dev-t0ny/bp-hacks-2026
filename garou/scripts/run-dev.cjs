/**
 * Runs `adk dev` with ADK_BOT_ID set from agent.json (devId) when present.
 * This can reduce "Missing bot id header" errors when the tunnel receives
 * GET / or /favicon.ico requests (e.g. browser opening the tunnel URL).
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const agentPath = path.join(__dirname, "..", "agent.json");
if (fs.existsSync(agentPath)) {
  try {
    const data = JSON.parse(fs.readFileSync(agentPath, "utf8"));
    if (data.devId) {
      process.env.ADK_BOT_ID = data.devId;
    }
  } catch (_) {}
}

const child = spawn("adk", ["dev"], {
  stdio: "inherit",
  shell: true,
  cwd: path.join(__dirname, ".."),
});
child.on("exit", (code) => process.exit(code ?? 0));
