# Garou — Bot Discord Loup-Garou

Bot de jeu de Loup-Garou pour Discord, construit avec Botpress ADK.

## Setup

### 1. Installer les dependances

```bash
pnpm install
```

### 2. Configurer les variables d'environnement

Creer un fichier `.env` a la racine du projet :

```
DISCORD_BOT_TOKEN=<ton_token_discord>
```

### 3. Lancer le bot

```bash
pnpm run dev
```

Le bot ADK tourne dans Botpress Cloud avec hot-reload.

### 4. Serveur d'interactions (boutons Discord)

Le serveur d'interactions est un Cloudflare Worker deja deploye a :

```
https://garou-interactions.gabgingras.workers.dev
```

Pour redeploy apres des changements :

```bash
cd worker && wrangler deploy
```

## Utilisation

Dans un channel Discord ou le bot est present :

```
/loupgarou 10
```

- `10` = nombre max de joueurs (min 4, max 20)
- Le bot envoie un embed avec une image de loup-garou et un bouton **Rejoindre**
- Un channel `#partie-N` est cree sous la categorie "Loup-Garou"
- Les joueurs cliquent le bouton pour rejoindre
- Quand un joueur rejoint : il voit le channel (lecture seule), l'embed se met a jour
- A 4+ joueurs : le createur peut lancer avec `/start`
- Quand le max est atteint : la partie demarre automatiquement

## Architecture

```
garou/
├── src/
│   ├── conversations/index.ts   # Handler /loupgarou — cree embed + channel
│   ├── actions/
│   │   ├── discord-api.ts       # Wrapper Discord REST API (fetch)
│   │   └── embed-builder.ts     # Construction/parsing des embeds
│   └── ...
├── worker/
│   ├── index.ts                 # Cloudflare Worker — boutons Discord
│   └── wrangler.toml            # Config du Worker
├── interactions-server.ts       # Version locale Bun (alternative au Worker)
├── agent.config.ts              # Config ADK
└── .env                         # Variables d'environnement
```

**2 process :**
1. **Bot ADK** (`pnpm run dev`) — detecte les commandes, cree les games
2. **Cloudflare Worker** — recoit les clics de boutons Discord, gere les joins

L'etat du jeu est stocke dans les champs caches de l'embed Discord (pas de base de donnees).

## Dev

```bash
# Bot ADK (terminal interactif requis)
pnpm run dev

# Redeploy le Worker apres modifications
cd worker && wrangler deploy

# Build sans deployer
pnpm run build
```
