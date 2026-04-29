import Phaser from "phaser";
import type { UpgradeOption } from "./events";
import type { PlayerStats } from "./gameTypes";

export const UPGRADE_OPTIONS: UpgradeOption[] = [
  { id: "speed", title: "Thrusters", description: "+ movement speed" },
  { id: "rate", title: "Overclock", description: "+ fire rate" },
  { id: "damage", title: "Hot Rounds", description: "++ projectile damage" },
  { id: "heavy-damage", title: "Rail Slugs", description: "massive projectile damage" },
  { id: "projectile", title: "Split Fire", description: "+ projectile count" },
  { id: "volley", title: "Volley Rig", description: "++ projectile count" },
  { id: "pierce", title: "Needle Rounds", description: "shots pierce enemies" },
  { id: "velocity", title: "Accelerator", description: "+ projectile speed" },
  { id: "overdrive", title: "Overdrive", description: "+ damage, fire rate, speed" },
  { id: "health", title: "Repair Kit", description: "+ max health and heal 1" },
  { id: "heal", title: "Patch Job", description: "heal 2" },
  { id: "range", title: "Collector", description: "+ pickup range" },
  { id: "wide-range", title: "Vacuum Field", description: "++ pickup range" },
  { id: "dash", title: "Blink Drive", description: "- dash cooldown" },
];

export function chooseUpgradeOptions(): UpgradeOption[] {
  return Phaser.Utils.Array.Shuffle([...UPGRADE_OPTIONS]).slice(0, 3);
}

export function chooseAutoplayerUpgrade(options: UpgradeOption[], stats: PlayerStats, health: number): string {
  const scored = options.map((option) => ({
    id: option.id,
    score: getAutoplayerUpgradeScore(option.id, stats, health),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id || options[0]?.id || "speed";
}

export function applyUpgrade(stats: PlayerStats, health: number, id: string): { stats: PlayerStats; health: number } {
  const next = { ...stats };
  let nextHealth = health;

  if (id === "speed") next.speed += 34;
  if (id === "rate") next.fireRate = Math.max(80, next.fireRate - 50);
  if (id === "damage") next.damage += 2;
  if (id === "heavy-damage") next.damage += 4;
  if (id === "projectile") next.projectiles = Math.min(8, next.projectiles + 1);
  if (id === "volley") next.projectiles = Math.min(8, next.projectiles + 2);
  if (id === "pierce") next.pierce = Math.min(4, next.pierce + 1);
  if (id === "velocity") next.projectileSpeed += 120;
  if (id === "overdrive") {
    next.damage += 1;
    next.fireRate = Math.max(80, next.fireRate - 35);
    next.speed += 20;
  }
  if (id === "health") {
    next.maxHealth += 1;
    nextHealth = Math.min(next.maxHealth, nextHealth + 1);
  }
  if (id === "heal") nextHealth = Math.min(next.maxHealth, nextHealth + 2);
  if (id === "range") next.pickupRange += 42;
  if (id === "wide-range") next.pickupRange += 90;
  if (id === "dash") next.dashCooldown = Math.max(700, next.dashCooldown - 280);

  return { stats: next, health: nextHealth };
}

function getAutoplayerUpgradeScore(id: string, stats: PlayerStats, health: number): number {
  const categories = {
    damage: (stats.damage - 1) / 18,
    fireRate: (250 - stats.fireRate) / 170,
    projectiles: (stats.projectiles - 1) / 7,
    pierce: stats.pierce / 4,
    speed: (stats.speed - 245) / 220,
    defense: (stats.maxHealth - 3) / 5,
    utility: (stats.pickupRange - 72) / 420,
    dash: (1800 - stats.dashCooldown) / 1100,
    velocity: (stats.projectileSpeed - 620) / 720,
  };

  const weakness = {
    damage: 1 - categories.damage,
    fireRate: 1 - categories.fireRate,
    projectiles: 1 - categories.projectiles,
    pierce: 1 - categories.pierce,
    speed: 1 - categories.speed,
    defense: 1 - categories.defense,
    utility: 1 - categories.utility,
    dash: 1 - categories.dash,
    velocity: 1 - categories.velocity,
  };

  const missingHealth = stats.maxHealth - health;
  const throughput = stats.damage * stats.projectiles * (250 / Math.max(80, stats.fireRate)) * (1 + stats.pierce * 0.22);
  const needsThroughput = throughput < 6.8 ? 1 : throughput < 9.2 ? 0.55 : 0.15;
  const scores: Record<string, number> = {
    damage: weakness.damage * 1.1 + needsThroughput * 0.18,
    "heavy-damage": weakness.damage * 0.95 + needsThroughput * 0.2,
    rate: weakness.fireRate + needsThroughput * 0.36,
    projectile: weakness.projectiles + needsThroughput * 0.65,
    volley: weakness.projectiles * 0.92 + needsThroughput * 0.72,
    pierce: weakness.pierce * 0.8 + needsThroughput * 0.2,
    velocity: weakness.velocity * 0.75,
    speed: weakness.speed,
    overdrive: (weakness.damage + weakness.fireRate + weakness.speed) / 3,
    health: weakness.defense * 0.85,
    heal: missingHealth > 0 ? 1.2 + missingHealth * 0.25 : 0.05,
    range: weakness.utility * 0.75,
    "wide-range": weakness.utility * 0.65,
    dash: weakness.dash * 0.7,
  };

  return scores[id] ?? 0;
}
