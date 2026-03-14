# Loup-Garou : Commande /loupgarou + Lobby

## Contexte

Bot Discord de Loup-Garou construit avec Botpress ADK. L'integration Discord de Botpress ne supporte pas les embeds, boutons interactifs, ni la creation de channels. On utilise l'API REST Discord directement via `fetch()` avec le bot token deja configure.

## Flux utilisateur

1. Un joueur ecrit `/loupgarou 10` dans un channel Discord
2. Le bot detecte la commande via le handler de conversation, envoie un **embed Discord** :
   - Image de loup-garou (URL libre de droits)
   - Titre : "Partie de Loup-Garou #N"
   - Description : "Creee par @username — 0/10 joueurs"
   - Bouton interactif : "Rejoindre la partie"
3. Quand un joueur clique "Rejoindre" :
   - Le bot cree un **nouveau channel** `#partie-N` dans une categorie "Loup-Garou" (cree la categorie si elle n'existe pas)
   - Le joueur recoit la permission de voir le channel mais **pas d'ecrire**
   - L'embed original est mis a jour avec le nouveau compte : "3/10 joueurs"
   - Un message s'affiche dans le channel de partie : "Gabriel a rejoint! (3/10)"
4. Quand max joueurs atteint → la partie demarre automatiquement
5. Le createur voit un bouton "Lancer la partie" dans le channel de partie des que 4+ joueurs sont presents
6. Minimum 4 joueurs pour lancer une partie

## Architecture

```
src/
  conversations/index.ts    — Detecte /loupgarou, orchestre le flow
  actions/
    discord-api.ts          — Wrapper fetch() pour l'API Discord REST
    game-manager.ts         — Logique de gestion des parties (create, join)
  triggers/index.ts         — Ecoute les interactions Discord (clics boutons)
  tables/index.ts           — Table "games" pour stocker l'etat des parties
```

### Table "games"

| Champ | Type | Description |
|-------|------|-------------|
| gameId | number | Numero de la partie (auto-increment via compteur) |
| creatorId | string | Discord user ID du createur |
| guildId | string | ID du serveur Discord |
| lobbyChannelId | string | ID du channel source ou la commande a ete lancee |
| gameChannelId | string | ID du channel #partie-N cree pour la partie |
| messageId | string | ID du message embed dans le channel source (pour updates) |
| maxPlayers | number | Nombre max de joueurs |
| players | string (JSON) | Liste serialisee des Discord user IDs |
| status | string | "lobby" / "playing" / "finished" |

### Discord API Endpoints utilises

| Methode | Endpoint | Usage |
|---------|----------|-------|
| POST | `/channels/{id}/messages` | Envoyer l'embed avec bouton |
| PATCH | `/channels/{id}/messages/{id}` | Mettre a jour l'embed (compteur joueurs) |
| POST | `/guilds/{id}/channels` | Creer le channel de partie |
| PUT | `/channels/{id}/permissions/{id}` | Donner/retirer acces aux joueurs |
| GET | `/guilds/{id}/channels` | Trouver/creer la categorie "Loup-Garou" |
| POST | `/interactions/{id}/{token}/callback` | Repondre aux clics de boutons |

### Embed Discord

```json
{
  "embeds": [{
    "title": "Partie de Loup-Garou #1",
    "description": "Creee par @username\n\n**Joueurs:** 0/10\n\nCliquez sur le bouton pour rejoindre!",
    "color": 0x8B0000,
    "image": { "url": "<image-loup-garou>" },
    "footer": { "text": "Minimum 4 joueurs pour lancer" }
  }],
  "components": [{
    "type": 1,
    "components": [{
      "type": 2,
      "style": 3,
      "label": "Rejoindre la partie",
      "custom_id": "join_game_1"
    }]
  }]
}
```

### Gestion des interactions

Les clics sur boutons Discord arrivent comme des interactions au webhook Botpress. Le bot doit :

1. Detecter que c'est une interaction de type bouton (pas un message texte)
2. Parser le `custom_id` pour identifier l'action (`join_game_N`, `start_game_N`)
3. Repondre avec un acknowledgement ephemeral (visible seulement par le joueur)
4. Executer la logique (ajouter le joueur, mettre a jour l'embed, etc.)

### Channel de partie

- Nom : `#partie-N`
- Categorie parente : "Loup-Garou" (creee automatiquement si absente)
- Permissions par defaut : personne ne peut voir le channel sauf le bot
- Chaque joueur recoit `VIEW_CHANNEL` mais pas `SEND_MESSAGES`
- Le bot peut ecrire dans le channel

### Bouton "Lancer la partie"

Envoye dans le channel `#partie-N` quand 4+ joueurs sont presents. Visible par tous mais seul le createur peut cliquer (verification cote serveur). Le message inclut la liste des joueurs actuels.

## Decisions

- **API Discord directe** plutot que discord.js (zero dependance, le token est deja la)
- **Table Botpress** pour persister l'etat des parties plutot que de l'etat en memoire
- **Categorie Discord** pour organiser les channels de parties
- **Permissions channel** pour controler l'acces (lecture seule pour les joueurs en attente)
- **Interactions ephemeral** pour les reponses aux boutons (evite le spam)
