# Garou — Bot Discord Loup-Garou

Bot de jeu de Loup-Garou pour Discord, construit avec le Botpress ADK et Cloudflare Workers. Les parties se jouent avec des humains et des bots IA qui discutent, accusent, mentent et votent comme de vrais joueurs.

## Setup

### 1. Installer les dependances

```bash
pnpm install
cd gateway && pnpm install
```

### 2. Variables d'environnement

#### Racine `.env`

```env
DISCORD_BOT_TOKEN=<token du bot Discord>
```

#### Worker `worker/wrangler.toml` (section `[vars]`)

| Variable | Description |
|----------|-------------|
| `DISCORD_PUBLIC_KEY` | Cle publique de l'application Discord (verification des interactions) |
| `DISCORD_BOT_TOKEN` | Token du bot Discord |
| `BOTPRESS_PAT` | Personal Access Token Botpress (pour les appels LLM via ADK) |
| `BOTPRESS_BOT_ID` | ID du bot Botpress |
| `ANTHROPIC_API_KEY` | (optionnel) Cle API Anthropic, utilisee en fallback si Botpress echoue |
| `GATEWAY_URL` | (optionnel) URL du gateway pour la Petite Fille |
| `GATEWAY_TOKEN` | (optionnel) Token d'authentification pour le gateway |

Le worker utilise aussi des KV namespaces et une Queue Cloudflare configures dans `wrangler.toml` :

- `ACTIVE_PLAYERS` (KV) : tracking des joueurs actifs et personnalites des bots
- `PRESETS_KV` (KV) : presets de roles custom
- `PHASE_QUEUE` (Queue) : timers pour les phases de jeu

#### Gateway `gateway/.env`

```env
DISCORD_BOT_TOKEN=<token du bot Discord>
GATEWAY_PORT=3002
GATEWAY_TOKEN=<token optionnel pour securiser les appels>
```

### 3. Enregistrer la commande Discord

```bash
DISCORD_BOT_TOKEN=<token> bun run worker/register-command.ts
```

Ceci enregistre la slash command `/loupgarou` dans Discord.

### 4. Lancer le projet

```bash
# Terminal 1 — Bot ADK (Botpress Cloud, hot-reload)
pnpm run dev

# Terminal 2 — Deployer le worker Cloudflare (ou redeploy apres changements)
cd worker && wrangler deploy

# Terminal 3 — Gateway (optionnel, pour la Petite Fille)
cd gateway && pnpm run dev
```

## Utilisation

Dans un channel Discord ou le bot est present :

```
/loupgarou
```

Le bot affiche un panneau de configuration ou le createur peut :
- Choisir un preset de roles (Classique, Etendu, Chaos, Loups+)
- Selectionner les roles manuellement
- Definir le nombre de bots IA
- Ajuster les timers de discussion et de vote
- Activer/desactiver les votes anonymes

Les joueurs cliquent le bouton **Rejoindre** pour entrer dans la partie. Un channel `#partie-N` est cree sous la categorie "Loup-Garou". A 4+ joueurs, le createur peut lancer la partie.

## Roles

### Roles fonctionnels (avec mecaniques de nuit)

| Role | Camp | Mecanique |
|------|------|-----------|
| Villageois | Village | Vote de jour pour eliminer les loups |
| Voyante | Village | Espionne un joueur chaque nuit pour decouvrir son role |
| Sorciere | Village | Possede une potion de vie (sauver la victime des loups) et une potion de mort (empoisonner un joueur) |
| Chasseur | Village | Quand il meurt, il tire sur un joueur de son choix |
| Cupidon | Village | Lie deux joueurs au debut : si l'un meurt, l'autre aussi |
| Petite Fille | Village | Espionne le thread des loups en temps reel (messages anonymises en "Loup #1", "Loup #2") |
| Loup-Garou | Loups | Vote chaque nuit avec la meute pour devorer un villageois |
| Loup-Garou Blanc | Solo | Joue avec les loups mais veut gagner seul. Peut tuer un loup une nuit sur deux |

### Roles additionnels (assignables mais sans mecanique de nuit dediee)

64 roles sont definis au total (47 villageois, 7 loups, 10 solitaires). Les roles sans mecanique specifique fonctionnent comme des villageois/loups de base mais ajoutent de la variete dans les attributions. Exemples : Salvateur, Ancien, Corbeau, Renard, Enfant Sauvage, Grand Mechant Loup, Joueur de Flute, Ange, etc.

### Presets

| Preset | Roles inclus | Votes anonymes | Discussion | Vote |
|--------|-------------|----------------|------------|------|
| Classique | Villageois, Voyante, Sorciere, Chasseur, Cupidon, Loup | Non | 120s | 60s |
| Etendu | + Petite Fille, Salvateur, Ancien, Voleur, Grand Mechant Loup | Non | 120s | 60s |
| Chaos | Beaucoup de roles speciaux + loups + solitaires | Oui | 150s | 90s |
| Loups+ | Plusieurs types de loups (Noir, Bavard, Louveteau...) | Non | 120s | 60s |

## Bots IA

Les parties sont completees avec des bots IA qui ont chacun une personnalite unique :

Marcel (mefiant, direct), Sophie (diplomatique, observatrice), Rene (impulsif, drole), Colette (prudente, analytique), Jacques (confiant, bavard), Marie (silencieuse, perspicace), Francois (agressif, soupconneux), Isabelle (calme, stratege), Pierre (naif, enthousiaste), Helene (sarcastique, intelligente), Antoine (nerveux, honnete), Therese (autoritaire, protectrice), Lucien (discret, calculateur), Camille (curieuse, intuitive), Gustave (tetu, loyal).

Chaque bot a un avatar genere via DiceBear et poste dans le thread des loups via des webhooks Discord avec son propre nom et avatar.

### Comment les bots decidentt

Les bots utilisent le LLM (via Botpress ADK en primaire, Claude Haiku en fallback) pour prendre des decisions a chaque phase :

- **Vote de nuit** : choisissent une victime en JSON
- **Voyante** : choisissent qui espionner
- **Sorciere** : decident de sauver, empoisonner, ou passer
- **Cupidon** : choisissent deux joueurs a lier
- **Chasseur** : tirent sur quelqu'un a leur mort
- **Loup Blanc** : decident de tuer un loup ou passer
- **Discussion de jour** : argumentent en texte libre
- **Vote de jour** : votent pour eliminer

Chaque bot recoit un prompt avec son role secret, sa strategie, l'historique de la partie, ses connaissances secretes (resultats de voyante, messages interceptes, etc.) et les messages recents du chat.

### Orchestrateur de discussion

Pendant la phase de discussion, un orchestrateur LLM gere les interventions des bots :

- Un seul appel decide quel bot parle et ce qu'il dit
- Les bots qui ont moins parle sont priorises
- Si un humain pose une question, un bot doit repondre
- Si un bot est accuse, il se defend
- Les loups ne se denoncent jamais, les villageois analysent les patterns
- Les messages font 1-2 phrases max en francais familier

### Memoire des bots

Les bots maintiennent une memoire persistante entre les phases (stockee dans Cloudflare KV, TTL 24h) :

- Loups connus / innocents confirmes
- Resultats de voyante
- Partenaire de couple (Cupidon)
- Messages des loups interceptes (Petite Fille)
- Notes de discussion

## Architecture

```
garou/
├── src/                            # Bot ADK (Botpress Cloud)
│   ├── conversations/index.ts      # Detection @bot loupgarou N, creation du channel
│   ├── actions/
│   │   ├── discord-api.ts          # Wrapper Discord REST API
│   │   ├── embed-builder.ts        # Construction/parsing des embeds
│   │   ├── bot-ai-response.ts      # Action LLM via ADK
│   │   └── generateSceneImage.ts   # Generation d'images DALL-E (optionnel)
│   └── tools/
│       └── bot-decision.ts         # Outil de decision IA pour les bots
│
├── worker/                         # Cloudflare Worker (game engine)
│   ├── index.ts                    # Handler principal : slash command, boutons, 19 phases de jeu
│   ├── game-logic.ts               # Fonctions pures : assignation des roles, win conditions, etat
│   ├── roles.ts                    # 64 definitions de roles + bitmask + presets
│   ├── bot-orchestrator.ts         # Prompts LLM, strategies par role, orchestrateur de discussion
│   ├── bot-personalities.ts        # 15 personnalites de bots
│   ├── embed-builders.ts           # Embeds pour chaque phase du jeu
│   ├── config-embed.ts             # UI de configuration de partie
│   ├── register-command.ts         # Enregistrement de la slash command Discord
│   ├── i18n/                       # Traductions francais/anglais
│   └── wrangler.toml               # Config Cloudflare (KV, Queue, vars)
│
├── gateway/                        # Gateway Discord.js (Petite Fille)
│   └── src/index.ts                # Express + Discord.js : mirror les messages des loups
│
├── interactions-server.ts          # Serveur local Bun (dev, alternative au Worker)
├── agent.config.ts                 # Config ADK
└── .env                            # Variables d'environnement
```

### 3 composants

1. **Bot ADK** (`pnpm run dev`) : tourne dans Botpress Cloud. Detecte les mentions `@bot loupgarou N`, cree le channel de partie et l'embed avec bouton.

2. **Cloudflare Worker** (`wrangler deploy`) : le game engine. Gere la slash command `/loupgarou`, les clics de boutons, les 19 phases de jeu (nuit, jour, votes, roles speciaux), les decisions des bots via LLM, et l'orchestration des discussions.

3. **Gateway** (`cd gateway && pnpm run dev`) : serveur Express + Discord.js. Ecoute les messages dans le thread des loups et les mirror anonymement dans le thread de la Petite Fille ("Loup #1", "Loup #2"). Utilise les intents Discord `GuildMessages` et `MessageContent` pour capter les messages en temps reel.

### Etat du jeu dans les embeds

L'etat du jeu est encode en base64 dans l'URL de l'embed Discord. Quand un bouton est clique, le worker decode l'embed pour recuperer tout le contexte (joueurs, roles, channel, etc.). Zero base de donnees partagee entre les composants.

### LLM

Le worker appelle le LLM via deux chemins :

1. **Botpress ADK** (primaire) : `POST https://api.botpress.cloud/v1/chat/actions` avec l'action `botAiResponse`
2. **Claude Haiku** (fallback) : appel direct a l'API Anthropic si Botpress echoue

### Phases de jeu

Le game engine gere 19 phases via Cloudflare Queue (chaque phase est un message en queue qui declenche un fresh worker invocation) :

`start_game` → `night_start` → `voyante_phase` → `wolf_phase` → `sorciere_phase` → `loup_blanc_vote` → `dawn_phase` → `day_discussion` → `day_vote` → (boucle)

Chaque phase a son timer configurable. Les conditions de victoire sont verifiees apres chaque elimination.

## Conditions de victoire

- **Village gagne** : tous les loups sont elimines
- **Loups gagnent** : les loups sont au moins aussi nombreux que les villageois
- **Loup Blanc gagne** : il est le dernier survivant

## Dev

```bash
# Bot ADK
pnpm run dev

# Deployer le worker
cd worker && wrangler deploy

# Gateway (optionnel)
cd gateway && pnpm run dev

# Build sans deployer
pnpm run build
```
