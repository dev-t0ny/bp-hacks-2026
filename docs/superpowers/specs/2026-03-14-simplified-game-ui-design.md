# Simplified Loup-Garou Game UI

## Problem

The current game creates multiple channels and messages, making it hard to follow:
- A game channel (`partie-X`) with 5+ messages
- A separate wolf channel (`taniere-X`) with welcome embed, ping, vote embed
- An announce embed in the source channel with join button

Players are overwhelmed by the number of messages and channels.

## Design

### Single Channel, Single Message

The game uses **1 channel** (`partie-X`) with **1 embed message** that evolves through all phases. No additional channels are created.

The game channel is **visible to @everyone** (read-only: `VIEW_CHANNEL` allowed, `SEND_MESSAGES` denied). This way the link from the announce embed works for prospective players. A "Rejoindre" button on the lobby embed lets players join from inside the game channel.

### Bot Permissions

The bot needs these permissions on the game channel:
- `VIEW_CHANNEL` (1 << 10)
- `SEND_MESSAGES` (1 << 11)
- `EMBED_LINKS` (1 << 14)
- `ATTACH_FILES` (1 << 15)
- `CREATE_PRIVATE_THREADS` (1 << 36)
- `MANAGE_THREADS` (1 << 34) — needed to lock/unlock threads

### Message Lifecycle

The single embed transitions through these states:

1. **Lobby** — Player list with progress bar, buttons: Rejoindre / Quitter / Start (creator only). Empty slots shown.
2. **Countdown (full)** — "La partie commence dans Xs..." with progress bar. Buttons: Skip (creator) / Quitter.
3. **Night Falls** — ASCII art, "Les villageois s'endorment..." No buttons.
4. **Role Distribution** — Card art, button: "Voir mon role" (ephemeral response shows role).
5. **Pre-game Countdown** — "La partie debute dans Xs..." after all roles seen.
6. **Village Sleeps** — "Le village s'endort..." transition.
7. **Wolves Awaken** — "Les loups-garous se reveillent..." with timer info.
8. **Day Breaks** — Edit the same message: "Le jour se leve..." with victim reveal. (future: village vote)

Each transition edits the same message ID. The day-break announcement also edits this message (no new messages sent).

### Private Threads for Roles

Instead of separate channels, **private threads** (Discord type 12) are created within the game channel.

Thread creation uses `invitable: false` to prevent members from inviting others.

**Note:** Discord generates a system message ("X added Y to the thread") when members are added via API. This is unavoidable. The vote embed is sent after all wolves are added, so system messages stack at the top and the actionable content stays at the bottom.

Threads:
- **`Taniere des Loups`** — Created when night starts (after all roles seen). All wolves added at once. Contains 1 vote embed that updates in place.
- **`Sorciere`** — Created during night phase. Contains potion choice buttons. (future)
- **`Cupidon`** — Created at game start. Contains lover selection. (future)

Threads are:
- Invisible to non-members (Discord private thread behavior)
- Created lazily (only when needed)
- Contain exactly 1 message that gets edited (the vote/action embed)

If thread creation fails (e.g., guild at max thread limit), the game falls back to DM-based voting for wolves.

### Thread Lock/Unlock

Threads use the Discord `locked` property (`PATCH /channels/{thread.id}` with `{ locked: true/false }`). When locked, only the bot (with `MANAGE_THREADS`) can send messages. This is simpler than per-user permission overwrites.

- Thread starts **locked** (wolves can see but not type)
- Night phase **unlocks** the thread (wolves can discuss + vote via buttons)
- After vote resolves: thread **locked** again

### Announce Embed

A minimal embed in the source channel (where `/loupgarou` was run):
- Shows game number, player count, and a **link button** (style 5) to the game channel
- Updated when players join/leave
- No join button here (joining happens in the game channel via the lobby embed)
- Deleted when game ends or channel is destroyed

### Wolf Vote Flow (in thread)

1. When night starts: wolf thread created (or unlocked if exists), wolves added, vote embed sent with target buttons
2. Wolves click buttons to vote (embed updates showing votes)
3. Unanimous vote = instant resolution, OR timer expires = auto-resolve
4. Vote embed updated to show result, thread locked

### What Changes from Current Code

**Removed:**
- `taniere-X` channel creation (replaced by private thread)
- Wolf welcome embed (replaced by single vote embed in thread)
- Multiple messages in game channel (all states now edit 1 message)
- Separate wolf ping message (wolves are added to thread, which notifies them)
- `buildAnnounceEmbed` join button (joining is in the game channel)

**Modified:**
- `GameState.wolfChannelId` becomes `GameState.wolfThreadId`
- Game channel permission: `@everyone` can view (read-only) instead of hidden
- `buildLobbyEmbed`, `buildRoleCheckEmbed`, countdown embeds, and day-break all edit the same `lobbyMessageId`
- `startNightPhase` creates/uses a private thread instead of a channel
- `buildAnnounceEmbed` simplified to mini embed with link button only
- Wolf channel lock/unlock uses thread `locked` property instead of per-user permission overwrites

**Added:**
- Discord thread creation: `POST /channels/{channel_id}/threads` with `type: 12, invitable: false`
- Thread member management: `PUT /channels/{thread.id}/thread-members/{user.id}`
- Thread lock/unlock: `PATCH /channels/{thread.id}` with `{ locked: true/false }`
- Bot permissions: `CREATE_PRIVATE_THREADS` and `MANAGE_THREADS` on game channel

### State Encoding

The embed-URL-as-state pattern continues. `wolfChannelId` is renamed to `wolfThreadId`. Future role threads (Sorciere, Cupidon) will each add a thread ID field. For 20 players with all roles, the base64 state stays well under Discord's embed URL limits (~2000 chars). If state grows too large in the future, we can move to KV-backed state.

### Cloudflare Workers Constraints

No change to the timing architecture:
- `handleRevealRole` triggers `runCountdownAndNight` via `ctx.waitUntil` (~25s)
- Vote timer still uses self-invocation pattern for 90s polling
- Each phase stays under 30s

### Game Cleanup

When the game ends or all players quit:
- The game channel (which contains the threads) is deleted
- Threads are automatically deleted with the channel
- Announce message in source channel is deleted
