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

Pour redeploy après des changements :

```bash
cd garou/worker && wrangler deploy
```

Avant le premier deploy (ou en local), copiez `garou/worker/.dev.vars.example` vers `garou/worker/.dev.vars` et renseignez les variables. En production, utilisez `wrangler secret put` pour les secrets.

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

**Son au démarrage de partie :** le worker appelle un service vocal (Node + Discord.js) qui rejoint le salon vocal et joue un fichier audio. Pour que le son fonctionne à 100 % :
- Le service canonique est dans **garou/voice-service/** — voir [garou/voice-service/README.md](garou/voice-service/README.md) pour la config, la checklist et les tests.
- **Local :** lancer `pnpm run dev:voice`, et dans `garou/worker` avoir `.dev.vars` avec `VOICE_SERVICE_URL=http://127.0.0.1:3001`.
- **Production (Cloudflare) :** le worker ne peut pas joindre localhost. Déployer le voice-service sur une URL publique (ex. tunnel Cloudflare Try, ou hébergement Node), puis définir `VOICE_SERVICE_URL` (et optionnellement `VOICE_SERVICE_TOKEN`) via `wrangler secret put` dans `garou/worker`.

## Dev

```bash
# Bot ADK (terminal interactif requis)
pnpm run dev

# Redeploy le Worker après modifications
cd garou/worker && wrangler deploy

# Build sans deployer
pnpm run build

# Service vocal (son au demarrage de partie) — voir garou/voice-service/README.md
pnpm run dev:voice
```
