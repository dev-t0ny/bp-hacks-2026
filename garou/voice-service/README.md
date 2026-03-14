# Garou Voice Service

This local service makes the Discord bot join a voice channel and play a sound effect when a game starts.

## Prerequisites

- **Node.js** (v18+)
- **FFmpeg** — required for audio transcoding. Install on your system:
  - Windows: `winget install FFmpeg` or [ffmpeg.org](https://ffmpeg.org/)
  - macOS: `brew install ffmpeg`
  - Linux: `apt install ffmpeg` / `dnf install ffmpeg`

## Setup

1. Install dependencies (from repo root or `garou`):

```bash
pnpm --dir garou/voice-service install
```

2. **Audio file:** Place your start-of-game sound in `garou/voice-service/sounds/`:
   - Default filename: `partie-commence.m4a` (included in repo)
   - Supported formats: mp3, wav, ogg, m4a  
   Or set `SOUND_FILE_PATH` in `.env` to an absolute path.

3. Create `garou/voice-service/.env` from `.env.example` and set:
   - `DISCORD_BOT_TOKEN` (same token as the worker)
   - `VOICE_SERVICE_TOKEN` (optional; recommended if the service is reachable from the internet)
   - `SOUND_FILE_PATH` (optional; defaults to `sounds/partie-commence.m4a` relative to the service)

4. Start the service (from repo root):

```bash
pnpm run dev:voice
```

5. In `garou/worker`: copy `.dev.vars.example` to `.dev.vars` and set `VOICE_SERVICE_URL=http://127.0.0.1:3001` for local. For production deploy, set `VOICE_SERVICE_URL` (and optionally `VOICE_SERVICE_TOKEN`) via `wrangler secret put`.

When a game is started via the **Démarrer la partie** button, the worker calls `POST /play-start-sfx` with `guildId` and `voiceChannelId`.

---

## Checklist (reliability)

Before testing or deploying, verify:

| Check | Description |
|-------|--------------|
| **Discord bot** | Bot is invited to the server with permissions that include **Connect** and **Speak** in voice channels. |
| **Discord Developer Portal** | In the bot application, **Privileged Gateway Intents** → **Server Members** is not required; **Guild Voice States** is required for the voice-service (handled by the code). |
| **Same token** | The voice-service uses the same `DISCORD_BOT_TOKEN` as the worker so it can join the same guilds and channels. |
| **Audio file** | File exists at `SOUND_FILE_PATH` (default: `garou/voice-service/sounds/partie-commence.m4a`). Format: mp3, wav, ogg, or m4a. |
| **FFmpeg** | FFmpeg is installed and on your PATH (`ffmpeg -version` works). |
| **Network (local)** | `VOICE_SERVICE_URL` in the worker points to where the service runs (e.g. `http://127.0.0.1:3001`). |
| **Network (production)** | Worker runs on Cloudflare and cannot reach `127.0.0.1`. Deploy the voice-service to a public URL and set `VOICE_SERVICE_URL` in Worker secrets. |
| **Auth (optional)** | If `VOICE_SERVICE_TOKEN` is set in the service `.env`, the worker must send `Authorization: Bearer <token>`; set the same value in worker env/secrets. |

### Logs to watch

- **Voice-service:** `[voice-service] Connected as …`, `[voice-service] Listening on …`, then on each play: `POST /play-start-sfx guildId=… voiceChannelId=…`, `Joined voice channel …`, `Playing file: …`, `Start sound finished successfully`.
- **Worker:** `[garou] Triggering start sound: …`, then either `[garou] Start sound played successfully` or `[garou] Voice service error …` / `Voice service unreachable` / `Voice service timeout`.

### Common errors

| Symptom | Possible cause |
|--------|----------------|
| 401 Unauthorized | `VOICE_SERVICE_TOKEN` mismatch or missing header. |
| 400 guildId/voiceChannelId required | Worker sent empty or missing body params. |
| 500 "Target channel must be a guild voice channel" | Channel ID is wrong or not a voice channel. |
| 500 "Sound file not found" | `SOUND_FILE_PATH` wrong or file missing; check path and default `sounds/partie-commence.m4a`. |
| 500 or crash when playing | FFmpeg not installed or not on PATH. |
| Timeout in worker | Voice-service not reachable (wrong URL, service down, or firewall). |

---

## Testing locally

End-to-end test so the bot joins the voice channel and plays the start sound:

1. **Install FFmpeg** and ensure `partie-commence.m4a` (or your file) is in `garou/voice-service/sounds/`.
2. **Create** `garou/voice-service/.env` with `DISCORD_BOT_TOKEN` (and optionally `VOICE_SERVICE_TOKEN`, `SOUND_FILE_PATH`).
3. **Start the voice-service:** from repo root run `pnpm run dev:voice`. Confirm logs: `[voice-service] Connected as …`, `Listening on http://127.0.0.1:3001`.
4. **Configure the worker:** in `garou/worker` copy `.dev.vars.example` to `.dev.vars` and set `VOICE_SERVICE_URL=http://127.0.0.1:3001` (and `VOICE_SERVICE_TOKEN` if used).
5. **Start the worker:** from `garou/worker` run `wrangler dev`. Note the local URL (e.g. `http://localhost:8787`).
6. **Expose the worker** with ngrok (or similar): `ngrok http 8787`. Set the ngrok URL as the **Interactions Endpoint URL** in the Discord Developer Portal for your application.
7. **On Discord:** In a server where the bot is present, run `/loupgarou 5`, click **Rejoindre**, then **join the voice channel** `vocal-partie-1` (at least one user must be in the channel for the sound to play). Click **Démarrer la partie**.
8. **Verify:** The bot joins the voice channel and the start sound plays. Check voice-service and worker logs for the messages above.

### Manual test (without a full game)

To test only the voice-service join + play:

1. Start the voice-service (`pnpm run dev:voice`).
2. Get a **guild ID** and **voice channel ID** from Discord (Developer Mode on: right-click server → Copy Server ID; right-click voice channel → Copy Channel ID).
3. Call the test route (use the same auth as the worker if `VOICE_SERVICE_TOKEN` is set):
   ```bash
   curl "http://127.0.0.1:3001/test-play?guildId=YOUR_GUILD_ID&voiceChannelId=YOUR_VOICE_CHANNEL_ID"
   ```
   Or with auth:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" "http://127.0.0.1:3001/test-play?guildId=YOUR_GUILD_ID&voiceChannelId=YOUR_VOICE_CHANNEL_ID"
   ```
4. Be in that voice channel when you run the request; the bot should join and play the default sound. To test with an empty channel, add `&requireListeners=0`.
