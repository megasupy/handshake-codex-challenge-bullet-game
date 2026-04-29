# Sixty Second Storm

Endless Phaser bullet-hell survival MVP for the Codex competition.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Supabase

The game works offline by default. If Supabase env vars are missing or requests fail, scores are saved to `localStorage` and shown on the local leaderboard.

To enable the online leaderboard:

1. Create the table/policies in `supabase/schema.sql`.
2. Copy `.env.example` to `.env`.
3. Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Restart the dev server.

## MVP Features

- Tailwind UI shell with menu, HUD, upgrade picker, game-over flow, and leaderboard.
- Phaser 3 endless arena survival.
- Auto-shooting player, dash, pickups, escalating threat levels.
- Chaser, shooter, spinner, and bomber enemies.
- Offline-first leaderboard with pending sync behavior.
