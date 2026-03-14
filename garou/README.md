# Garou — Bot Discord Loup-Garou

**C’est ici le bon dossier pour lancer la partie avec `/loupgarou`.**

## Lancer depuis `garou`

```bash
cd garou
npm install
npm run dev
```

Le bot ADK tourne avec hot-reload. Sur Discord, utilise `/loupgarou <nombre>` pour créer une partie.

## Variables d’environnement

Fichier `garou/.env` :

- `DISCORD_BOT_TOKEN` — token du bot (Gamma)
- `OPENAI_API_KEY` — pour Dalle / images

## Autres commandes

- `npm run dev:voice` — service vocal (son au lancement de partie)
- `npm run dev:interactions` — serveur d’interactions local (Bun)
- `npm run build` — build ADK

## Worker (slash commands + boutons)

Le worker est dans `garou/worker/`. Déploiement :

```bash
cd garou/worker && wrangler deploy
```

Variables dans `worker/wrangler.toml` ou secrets : `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `VOICE_SERVICE_URL`, `VOICE_SERVICE_TOKEN`.
