import { readFile } from "node:fs/promises";

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  const summary = await summarizeRuns(files);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

export async function summarizeRuns(files) {
  const runs = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const samples = runs.flatMap((run) => run.samples || []);
  const events = runs.flatMap((run) => run.events || []);
  const survival = runs.map((run) => Number(run.summary?.survivalMs || 0));
  const frameMs = samples.map((sample) => Number(sample.frameMs || 0)).filter((value) => value > 0);
  const bullets = samples.map((sample) => Number(sample.enemyBullets || 0));
  const pickups = samples.map((sample) => Number(sample.pickups || 0));
  const bossDurations = events.filter((event) => event.type === "boss-defeat").map((event) => Number(event.data?.durationMs || 0));
  const bossesDefeated = runs.map((run) => Number(run.summary?.bossesDefeated || 0));
  const damageByThreat = aggregateDamageByThreat(events);
  const threatTimeMs = aggregateThreatTime(samples, runs);

  return {
    runs: runs.length,
    averageSurvivalMs: average(survival),
    averageSurvivalSec: average(survival) / 1000,
    medianSurvivalMs: percentile(survival, 0.5),
    boss1ClearRate: rate(bossesDefeated.map((value) => value >= 1)),
    boss3ClearRate: rate(bossesDefeated.map((value) => value >= 3)),
    p95FrameMs: percentile(frameMs, 0.95),
    p95EnemyBullets: percentile(bullets, 0.95),
    p95Pickups: percentile(pickups, 0.95),
    averageBossDurationMs: average(bossDurations),
    damageByThreat,
    threatTimeMs,
    recommendations: buildRecommendations({
      p95FrameMs: percentile(frameMs, 0.95),
      p95EnemyBullets: percentile(bullets, 0.95),
      p95Pickups: percentile(pickups, 0.95),
      averageBossDurationMs: average(bossDurations),
      averageSurvivalMs: average(survival),
      damageByThreat,
    }),
  };
}

function aggregateDamageByThreat(events) {
  const buckets = {};
  for (const event of events) {
    if (event.type !== "damage") continue;
    const threat = Number(event.data?.threat || 0);
    buckets[threat] = (buckets[threat] || 0) + 1;
  }
  return buckets;
}

function aggregateThreatTime(samples, runs) {
  const sampleInterval = Number(runs[0]?.config?.sampleIntervalMs || 250);
  const buckets = {};
  for (const sample of samples) {
    const threat = Number(sample.threat || 0);
    buckets[threat] = (buckets[threat] || 0) + sampleInterval;
  }
  return buckets;
}

function buildRecommendations(metrics) {
  const items = [];
  if (metrics.p95FrameMs > 22 && metrics.p95EnemyBullets > 180) {
    items.push("Bullet pressure is the likely frame-time driver. Lower enemy bullet cap or reduce spinner/boss volley density.");
  }
  if (metrics.p95FrameMs > 22 && metrics.p95Pickups > 55) {
    items.push("Pickup pressure is still too high. Merge pickups more aggressively or reduce drop chance.");
  }
  if (metrics.averageBossDurationMs > 22000) {
    items.push("Boss time-to-kill is long. Increase player DPS progression or reduce boss health scaling.");
  }
  if (metrics.averageSurvivalMs < 35000) {
    items.push("Autoplayer is dying early. Check damage spikes in low threat bands before adding more content.");
  }
  const earlyDamage = Number(metrics.damageByThreat[1] || 0) + Number(metrics.damageByThreat[2] || 0);
  if (earlyDamage > 3) {
    items.push("Early threats are causing too much damage. Slow enemy bullets further or reduce early spawn density.");
  }
  if (items.length === 0) {
    items.push("No obvious bottleneck from the current batch. Increase run count or sample a harder debug profile.");
  }
  return items;
}

function average(values) {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)));
  return sorted[index];
}

function rate(flags) {
  if (flags.length === 0) return 0;
  return flags.filter(Boolean).length / flags.length;
}
