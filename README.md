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

## Autoplayer Training

Train autoplayer weights with the built-in CEM loop:

```bash
npm run telemetry:train
```

Useful knobs:

```bash
STORM_TRAIN_GENERATIONS=12
STORM_TRAIN_POPULATION=14
STORM_TRAIN_ELITES=4
STORM_TRAIN_EVAL_RUNS=8
STORM_TRAIN_TIME_SCALE=8
STORM_TRAIN_MAX_MS=180000
STORM_TRAIN_HEADFUL=0
STORM_TRAIN_RESUME=1
STORM_TRAIN_GRADIENT=1
STORM_TRAIN_OPTIMIZER=gd
STORM_TRAIN_LR=0.35
STORM_TRAIN_MOMENTUM=0.9
STORM_TRAIN_GRADIENT_MIX=0.55
```

If `STORM_TRAIN_EPOCHS`/`STORM_TRAIN_GENERATIONS` is not set, the trainer prompts for epoch count.
If `STORM_TRAIN_HEADFUL` is not set, the trainer prompts whether to run headful (`y/n`).

The trainer writes:

- best policy: `logs/training/best-policy.json`
- generation history: `logs/training/train-*.jsonl`
- resume state: `logs/training/trainer-state.json`
- per-run metrics: `logs/training/train-runs-train-*.jsonl`
- per-epoch metrics: `logs/training/train-epochs-train-*.jsonl`

Run telemetry with a trained policy:

```bash
STORM_POLICY_FILE=logs/training/best-policy.json npm run telemetry:run
```
