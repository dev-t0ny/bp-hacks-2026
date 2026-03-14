# Botpress ADK Agent

> This project is built with the **Botpress Agent Development Kit (ADK)** — a TypeScript-first framework for building AI agents.

## Key Files

- `agent.config.ts` — Agent configuration, models, state schemas, and dependencies
- `src/conversations/` — Message handlers (primary user interaction)
- `src/workflows/` — Long-running background processes
- `src/tools/` — AI-callable functions
- `src/actions/` — Reusable business logic
- `src/knowledge/` — RAG knowledge base sources
- `src/tables/` — Database table definitions
- `src/triggers/` — Event-based triggers

## Development

```bash
adk dev      # Start dev server with hot reload
adk build    # Build and generate types
adk deploy   # Deploy to Botpress Cloud
adk chat     # Chat with your agent in the terminal
```

## AI Coding Assistant Skills

This project uses the Botpress ADK. Before making changes, use the relevant skill:

| Skill              | Use for                                          |
| ------------------ | ------------------------------------------------ |
| `/adk`             | ADK concepts, patterns, and API reference        |
| `/adk-integration` | Finding and using Botpress integrations           |
| `/adk-debugger`    | Debugging with traces and test conversations      |
| `/adk-frontend`    | Building frontends that connect to ADK bots       |

If these skills are not installed, install them:

```
npx skills add botpress/skills --skill adk
```

## Project Overview

**Garou** est un bot Discord de jeu de Loup-Garou (Werewolf). Les joueurs interagissent via des commandes Discord pour créer et rejoindre des parties.

### Fonctionnalités principales
- `/loupgarou <nb_joueurs>` — Crée une nouvelle partie avec un nombre max de joueurs
- Système de lobby avec bouton "Rejoindre" et embed visuel
- Salle d'attente dans un channel Discord dédié par partie
- (À venir) Gestion des rôles, phases jour/nuit, votes, etc.

## Architecture & Conventions

### Architecture à 2 process

Le bot utilise **deux process** :

1. **ADK Bot** (`pnpm run dev`) — Tourne dans Botpress Cloud via `adk dev`
   - Détecte `/loupgarou N` dans les messages Discord
   - Crée l'embed avec bouton + le channel de partie via Discord REST API
   - Gère le compteur de parties via `bot.state.gameCounter`

2. **Interaction Server** (`pnpm run dev:interactions`) — Bun HTTP local
   - Reçoit les clics de boutons Discord (interactions)
   - Gère les joins (permissions channel, mise à jour embed, messages)
   - Nécessite ngrok pour être accessible depuis Discord

### Embed = Base de données

L'état du jeu est stocké **dans les champs cachés de l'embed Discord** (`__players`, `__gameChannelId`, `__guildId`, etc.). Quand un bouton est cliqué, le serveur d'interactions parse l'embed pour récupérer tout le contexte. Zéro base de données partagée nécessaire.

### Fichiers clés

| Fichier | Rôle |
|---------|------|
| `src/actions/discord-api.ts` | Wrapper Discord REST API (`fetch`) |
| `src/actions/embed-builder.ts` | Construction/parsing des embeds avec état du jeu |
| `src/conversations/index.ts` | Handler `/loupgarou N` — crée game + channel + embed |
| `interactions-server.ts` | Serveur Bun pour les boutons Discord (hors `src/` pour éviter le bundling ADK) |
| `agent.config.ts` | Config ADK, state bot (`gameCounter`), intégrations |

### IDs & Config
- **Bot ID:** `7e9cfd22-4bdf-46bb-9347-2617e74bf9e3`
- **Workspace ID:** `wkspace_01KK21ZY8ACFBNM354KXXW7N43`
- **API URL:** `https://api.botpress.cloud`

### Intégrations
- **Discord** (`shell/discord@0.1.0`) — Canal principal. **Limité** : pas d'embeds, pas de boutons, pas de création de channels. On utilise l'API Discord REST directement pour tout ça.
- **Chat** (`chat@0.7.6`) — Activé
- **Webchat** (`webchat@0.3.0`) — Activé

### Discord — Tags importants
- `discord:id` (conversation) — ID du channel Discord
- `discord:guildId` (conversation) — ID du serveur
- `discord:userId` (message) — ID Discord de l'auteur du message

### Variables d'environnement
- `DISCORD_BOT_TOKEN` — Token du bot Discord (dans `.env`)
- `DISCORD_PUBLIC_KEY` — Clé publique de l'application Discord (pour le serveur d'interactions)

### Conventions
- Langage du code: **TypeScript** (ES2022, strict mode)
- Package manager: **pnpm**
- Module system: **ESM** (`"type": "module"`)
- Langue de l'interface utilisateur: **Français**
- Les fichiers hors `src/` (comme `interactions-server.ts`) ne sont PAS bundlés par ADK

## Développement

```bash
# Terminal 1 — Bot ADK
pnpm run dev

# Terminal 2 — Serveur d'interactions (boutons Discord)
DISCORD_PUBLIC_KEY=<clé> pnpm run dev:interactions

# Terminal 3 — Exposer le serveur d'interactions
ngrok http 3847
```

Configurer l'URL ngrok comme "Interactions Endpoint URL" dans le Discord Developer Portal.

## Notes

- Le token Discord est dans `.env` (pas dans le code)
- L'interaction server (`interactions-server.ts`) est à la racine du projet, pas dans `src/`, pour éviter le bundling ADK
- Min 4 joueurs, max 20 par partie
- Le channel de partie est sous la catégorie "Loup-Garou" (créée auto)
