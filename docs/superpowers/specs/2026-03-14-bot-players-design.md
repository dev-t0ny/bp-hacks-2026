# Bot Players IA — Design Spec

> Feature: Permettre aux bots IA de participer aux parties de Loup-Garou comme joueurs autonomes, avec personnalité et stratégie par rôle.

## Approche retenue: Hybride (Worker orchestre, ADK décide)

Le Cloudflare Worker reste le chef d'orchestre du jeu. Quand c'est le tour d'un bot, le Worker appelle un **tool ADK** (`botDecision`) qui utilise `execute()` pour générer la décision et le message. Le Worker reçoit la réponse et l'applique au jeu.

```
Phase de vote → Worker détecte bots → appelle ADK pour chaque bot
                                        → execute({ instructions: prompt de rôle })
                                        → retourne { vote, message }
                → Worker poste "🤖 Marcel: ..." dans Discord
                → Worker applique le vote
```

## Prérequis

- **Phase jour (discussion + vote)** — N'existe pas encore dans le Worker. Doit être implémentée avant ou en parallèle des bots, car 2/3 des phases bot en dépendent. Le MVP peut commencer avec la nuit uniquement.

## Décisions clés

| Décision | Choix | Raison |
|----------|-------|--------|
| Interaction Discord | Un seul bot poste au nom de tous | Plus simple, pas de webhooks multiples |
| Timing des actions | Délai aléatoire (10-70% de la durée de phase) | Simule la réflexion humaine |
| Ajout des bots | Manuel (config) + auto-fill si < 4 joueurs | Contrôle du créateur + fallback pratique |
| Personnalité | Traits (2-3 par bot) | Variété sans over-engineering |
| Min humains | 2 | Éviter un spectacle de bots |
| Rôles spéciaux MVP | Loup-garou et villageois uniquement | Les rôles spéciaux vont aux humains en priorité |

---

## 1. Modèle de données

### BotPlayer dans le GameState

```typescript
interface BotPlayer {
  id: string;          // "bot_1", "bot_2", etc.
  name: string;        // "Marcel", "Sophie", etc.
  traits: string[];    // ["méfiant", "direct"]
  alive: boolean;
}

interface GameState {
  // ... champs existants ...
  players: string[];              // IDs Discord (humains uniquement)
  bots?: BotPlayer[];             // Bots IA
  roles?: Record<string, string>; // playerId|botId → roleKey
}
```

Les bots sont séparés des `players` (IDs Discord) pour ne pas casser la logique existante qui utilise les player IDs pour des appels Discord API (permissions, threads, DMs).

### Stockage des bots: Cloudflare KV (pas l'embed)

Les données des bots ne vont **pas** dans l'embed URL — le GameState encodé est déjà proche de la limite de ~2000 chars Discord avec 10+ joueurs et des rôles assignés. Ajouter les bots ferait exploser la taille.

À la place, les bots sont stockés dans Cloudflare KV:

```
Clé: game:{gameNumber}:bots
Valeur: JSON array de BotPlayer
TTL: 86400s (24h)
```

Dans le GameState embed, on stocke uniquement un **nombre de bots** (`bc: number`) pour que l'UI sache combien afficher. Le Worker fetch les détails depuis KV quand nécessaire.

### Pool de personnalités

Fichier `worker/bot-personalities.ts` avec ~15 personnalités pré-définies:

```typescript
const BOT_POOL = [
  { name: "Marcel", traits: ["méfiant", "direct"], emoji: "🧔" },
  { name: "Sophie", traits: ["diplomatique", "observatrice"], emoji: "👩‍🦰" },
  { name: "René", traits: ["impulsif", "drôle"], emoji: "🤡" },
  // ~12 autres...
];
```

Piochés aléatoirement sans doublon à la création de la partie.

---

## 2. Flux d'ajout des bots

### Config wizard (ajout manuel)

Dans le step 2 du config wizard (`worker/config-embed.ts`), ajouter un **select menu** "Nombre de bots" (0 à `maxPlayers - joueurs actuels`). Stocké dans le `ConfigState`.

### Auto-fill au lancement

Quand le créateur clique "Lancer" et `players.length < 4`:

> "Il manque X joueur(s). Ajouter X bot(s) pour compléter? [Oui] [Annuler]"

Si oui → piocher X personnalités du pool, ajouter au `GameState.bots`.

### Contrainte: min 2 humains

Les bots comptent dans `maxPlayers` mais il faut au minimum **2 joueurs humains** pour lancer une partie.

### Affichage lobby

```
Joueurs (5/8):
1. 👤 Tony
2. 👤 Gabriel
3. 🤖 Marcel (Bot)
4. 🤖 Sophie (Bot)
5. 🤖 René (Bot)
```

Les bots rejoignent avec un délai échelonné (2-5s entre chaque) pour simuler des "vrais" joins.

---

## 3. Décision IA via ADK

### Tool ADK: `botDecision`

```typescript
// src/tools/bot-decision.ts
input: {
  botName: string,        // "Marcel"
  botTraits: string[],    // ["méfiant", "direct"]
  botRole: string,        // "loup" (clé de rôle du codebase)
  phase: "night_vote" | "day_discussion" | "day_vote",
  alivePlayers: string[], // ["Tony", "Sophie", "René"]
  gameHistory: string[],  // ["Nuit 1: Alice éliminée", ...]
  knownInfo: string,      // Info spécifique au rôle
}

output: {
  action: string,         // ID du joueur ciblé ou "skip"
  message: string,        // "Je pense que Tony est suspect..."
}
```

### Prompt par rôle

```
Tu es {botName}, un joueur de Loup-Garou.
Personnalité: {traits}.
Ton rôle secret: {botRole}.

PHASE: {phase}
Joueurs vivants: {alivePlayers}
Historique: {gameHistory}

RÈGLES DE COMPORTEMENT:
- Si loup: protège tes alliés, accuse des innocents, sois subtil
- Si villageois: analyse les votes passés, cherche les incohérences
- Message: 1-2 phrases max, français familier
- Ne révèle JAMAIS ton rôle directement

Réponds avec: qui tu vises et ton argument.
```

### Flow Worker → ADK → Worker

**Mécanisme d'intégration:** Le Worker envoie un message à une conversation Botpress dédiée via l'API `converse`. L'ADK reçoit le message, le tool `botDecision` est invoqué par le LLM, et la réponse est retournée via le callback de l'API converse.

```
POST https://api.botpress.cloud/v1/chat/conversations/{botConvId}/messages
Authorization: Bearer {botpressToken}
Body: { "type": "text", "text": "BOT_DECISION: {JSON payload}" }
```

L'ADK parse le message entrant, détecte le préfixe `BOT_DECISION:`, et appelle le tool `botDecision` avec le payload. La réponse est retournée comme message de conversation, que le Worker poll ou reçoit via webhook.

**Alternative si latence trop élevée:** Le Worker appelle directement l'API Anthropic/OpenAI avec le prompt de rôle, sans passer par l'ADK. Moins élégant mais plus rapide (~2s vs ~5s). L'ADK reste l'approche principale, le direct LLM call est le fallback.

**Séquence complète:**

1. Worker: phase commence
2. Worker: pour chaque bot alive, calcule `délai = random(10%, 70%) × durée_phase`
3. Worker: après le délai, POST vers l'API Botpress converse
4. ADK: reçoit le message, invoque `botDecision` tool
5. ADK: `execute()` génère la décision via LLM
6. ADK: retourne `{ action, message }` comme réponse de conversation
7. Worker: poste `🤖 **Marcel** : "{message}"` dans Discord
8. Worker: applique le vote

Les appels sont lancés en **parallèle** avec des délais différents (pas séquentiels).

**Fallback en cas d'erreur/timeout (>10s):** Le bot fait un vote aléatoire avec un message générique ("Hmm... je vote pour {random}.").

---

## 4. Intégration dans les phases de jeu

### Phase Nuit (vote des loups)

- Le Worker identifie les bots avec rôle `loup`
- Chaque bot-loup reçoit un appel ADK avec `phase: "night_vote"` et `knownInfo` (les autres loups)
- Le vote est posté dans le **wolf thread**
- Les votes des bots sont injectés dans le `VoteState` existant (`votes: Record<string, string>`) en utilisant le `bot.id` comme clé (ex: `votes["bot_1"] = "targetPlayerId"`). L'embed de vote est mis à jour pour refléter le vote du bot.
- `resolveNightVote` est modifié pour compter les votes des bots identiquement aux votes humains
- Bots non-loups: ne font rien

### Phase Jour — Discussion

- Fenêtre de `discussionTime` secondes (configurable par preset)
- Le Worker tire un random pour chaque bot (60-80% chance) **avant** d'appeler l'ADK — si le bot ne parle pas, aucun appel LLM n'est fait (économie de tokens)
- Délai = `random(10%, 70%) × discussionTime`
- Appel ADK avec `phase: "day_discussion"`
- Message posté dans le game channel: `🤖 **Sophie** : "René a voté contre Alice hier..."`

### Phase Jour — Vote

- Fenêtre de `voteTime` secondes (configurable par preset)
- **Tous** les bots alive votent
- Délai = `random(10%, 70%) × voteTime`
- Appel ADK avec `phase: "day_vote"`
- Message posté: `🤖 **Marcel** vote pour éliminer **René**`

### Adaptation aux timers

Les timers sont configurables par preset:

| Preset | Discussion | Vote |
|--------|-----------|------|
| Classique | 120s | 60s |
| Étendu | 120s | 60s |
| Chaos | 150s | 90s |
| Loups+ | 120s | 60s |

Vote nuit: 90s (hardcodé `NIGHT_VOTE_SECONDS`).

Les bots respectent ces durées via la formule `random(10%, 70%) × durée_phase`. Le Worker passe `discussionTime` et `voteTime` du GameState pour calculer les délais.

### Élimination d'un bot

- `bot.alive = false` dans le GameState
- Message: `🤖 **Marcel** a été éliminé. Il était **Villageois**.`
- Le bot ne participe plus aux phases suivantes

### Win condition

Inchangée — les bots comptent dans le décompte loups vs villageois.

---

## 5. Mémoire et stratégie

### gameHistory via Cloudflare KV

```
Clé: game:{gameNumber}:history
Valeur: JSON array de strings
TTL: 86400s (24h)
```

Le Worker append un événement à chaque fin de phase. Quand un bot doit décider, le Worker fetch l'historique et le passe à l'ADK.

Exemples d'événements:
```json
[
  "Nuit 1: René a été tué par les loups",
  "Jour 1: Sophie a accusé Tony. Marcel a défendu Tony.",
  "Jour 1 vote: Sophie(2), Tony(1) → Sophie éliminée. Villageoise.",
  "Nuit 2: vote en cours..."
]
```

### Directives stratégiques par rôle

**Loup-garou:**
- Ne vote jamais contre un autre loup de jour
- Accuse des innocents avec des arguments crédibles
- Si accusé, défends-toi sans surréagir

**Villageois:**
- Analyse les patterns de vote (qui protège qui?)
- Relève les contradictions dans les arguments
- Suis la majorité si pas de conviction forte

Ces directives sont des guidelines — le LLM peut improviser.

### Limitation d'information

Les bots n'ont accès qu'à l'**information publique** + leur info de rôle. Un villageois ne sait pas qui sont les loups. Un loup connaît ses alliés. Exactement comme un humain.

---

## 6. Architecture — fichiers

### Nouveaux fichiers

| Fichier | Rôle |
|---------|------|
| `worker/bot-personalities.ts` | Pool de ~15 personnalités (nom, traits, emoji) |
| `worker/bot-orchestrator.ts` | Orchestration: délais, gameHistory, dispatch ADK, formatage messages |
| `src/tools/bot-decision.ts` | Tool ADK: contexte bot → execute() → décision + message |

### Fichiers modifiés

| Fichier | Modification |
|---------|-------------|
| `worker/index.ts` | Intégrer bot-orchestrator dans phases nuit/jour. Bots dans GameState. Auto-fill. Modifier `assignRoles(playerCount)` → `assignRoles(humanIds, botIds, selectedRoleIds?)` pour supporter la priorité humains. Vérifier que VoteState embed URL reste dans les limites avec les bot IDs ajoutés (sinon, migrer vers KV aussi). |
| `worker/config-embed.ts` | Select menu "Nombre de bots" step 2. Encoder/décoder bots dans ConfigState. |
| `worker/roles.ts` | Rôles spéciaux → humains en priorité (algorithme: shuffle tous les rôles, assigner les rôles non-loup/non-villageois aux humains d'abord, puis distribuer loup/villageois normalement entre humains et bots) |

### Aucun changement nécessaire

| Fichier | Raison |
|---------|--------|
| `agent.config.ts` | `execute()` et tools fonctionnent déjà |
| `interactions-server.ts` | Les bots n'interagissent pas via Discord buttons |

---

## 7. Hors scope MVP

- Rôles spéciaux pour les bots (sorcière, voyante, cupidon)
- Bots qui réagissent aux messages des humains en temps réel
- Niveaux de difficulté différents
- Bots qui mentent de manière élaborée
- Personnages complets avec backstory
- Multi-langue (FR uniquement)
