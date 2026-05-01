import Phaser from "phaser";
import type { UpgradeOption } from "./events";
import type { PlayerStats } from "./gameTypes";

type UpgradeId =
  | "speed"
  | "rate"
  | "damage"
  | "projectile"
  | "volley"
  | "pierce"
  | "velocity"
  | "overdrive"
  | "health"
  | "heal"
  | "range"
  | "wide-range"
  | "dash";

type UpgradeDef = UpgradeOption & {
  power: number;
  primaryStat: "speed" | "fireRate" | "damage" | "projectiles" | "pierce" | "projectileSpeed" | "health" | "heal" | "pickupRange" | "dashCooldown" | "combo";
};

const UPGRADE_DEFS: UpgradeDef[] = [
  { id: "speed", title: "Thrusters", description: "+34 move speed", primaryStat: "speed", power: 1 },
  { id: "rate", title: "Overclock", description: "-50ms fire rate", primaryStat: "fireRate", power: 1 },
  { id: "damage", title: "Hot Rounds", description: "+2 projectile damage", primaryStat: "damage", power: 1 },
  { id: "projectile", title: "Split Fire", description: "+1 projectile", primaryStat: "projectiles", power: 1 },
  { id: "volley", title: "Volley Rig", description: "+2 projectiles", primaryStat: "projectiles", power: 2 },
  { id: "pierce", title: "Needle Rounds", description: "+1 pierce", primaryStat: "pierce", power: 1 },
  { id: "velocity", title: "Accelerator", description: "+120 projectile speed", primaryStat: "projectileSpeed", power: 1 },
  { id: "overdrive", title: "Overdrive", description: "+1 damage, -35ms fire rate, +20 move speed", primaryStat: "combo", power: 1 },
  { id: "health", title: "Repair Kit", description: "+1 max HP and heal +1", primaryStat: "health", power: 1 },
  { id: "heal", title: "Patch Job", description: "heal +2 HP", primaryStat: "heal", power: 1 },
  { id: "range", title: "Collector", description: "+42 pickup range", primaryStat: "pickupRange", power: 1 },
  { id: "wide-range", title: "Vacuum Field", description: "+90 pickup range", primaryStat: "pickupRange", power: 2 },
  { id: "dash", title: "Blink Drive", description: "-280ms dash cooldown", primaryStat: "dashCooldown", power: 1 },
];

export const UPGRADE_OPTIONS: UpgradeOption[] = UPGRADE_DEFS.map(({ id, title, description }) => ({ id, title, description }));

export function chooseUpgradeOptions(): UpgradeOption[] {
  const shuffled = Phaser.Utils.Array.Shuffle([...UPGRADE_DEFS]);
  const picks: UpgradeDef[] = [];
  const byStat = new Map<UpgradeDef["primaryStat"], number>();

  for (const candidate of shuffled) {
    if (picks.length >= 3) break;
    const existingIndex = byStat.get(candidate.primaryStat);
    if (existingIndex == null) {
      byStat.set(candidate.primaryStat, picks.length);
      picks.push(candidate);
      continue;
    }
    if (candidate.power > picks[existingIndex].power) {
      picks[existingIndex] = candidate;
    }
  }

  if (picks.length < 3) {
    for (const candidate of shuffled) {
      if (picks.length >= 3) break;
      if (picks.some((entry) => entry.id === candidate.id)) continue;
      picks.push(candidate);
    }
  }

  return picks.map(({ id, title, description }) => ({ id, title, description }));
}

export function chooseAutoplayerUpgrade(options: UpgradeOption[], stats: PlayerStats, health: number): string {
  const scored = options.map((option) => ({
    id: option.id,
    score: getAutoplayerUpgradeScore(option.id, stats, health),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id || options[0]?.id || "speed";
}

export function getUpgradeTitle(id: string): string {
  return UPGRADE_DEFS.find((option) => option.id === id)?.title || id;
}

export function formatUpgradePreview(id: string, stats: PlayerStats, health: number): string {
  const before = { ...stats };
  const applied = applyUpgrade(stats, health, id);
  const after = applied.stats;
  const parts: string[] = [];
  if (after.damage !== before.damage) parts.push(`DMG ${before.damage}->${after.damage}`);
  if (after.projectiles !== before.projectiles) parts.push(`PRJ ${before.projectiles}->${after.projectiles}`);
  if (after.fireRate !== before.fireRate) parts.push(`FR ${before.fireRate}ms->${after.fireRate}ms`);
  if (after.pierce !== before.pierce) parts.push(`PIERCE ${before.pierce}->${after.pierce}`);
  if (after.maxHealth !== before.maxHealth) parts.push(`MAX HP ${before.maxHealth}->${after.maxHealth}`);
  if (after.projectileSpeed !== before.projectileSpeed) parts.push(`SPD ${before.projectileSpeed}->${after.projectileSpeed}`);
  if (after.pickupRange !== before.pickupRange) parts.push(`RANGE ${before.pickupRange}->${after.pickupRange}`);
  if (applied.health !== health) parts.push(`HP ${health}->${applied.health}`);
  return parts.join(" · ");
}

export function applyUpgrade(stats: PlayerStats, health: number, id: string): { stats: PlayerStats; health: number } {
  const next = { ...stats };
  let nextHealth = health;

  if (id === "speed") next.speed += 34;
  if (id === "rate") next.fireRate = Math.max(80, next.fireRate - 50);
  if (id === "damage") next.damage += 2;
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
    rate: weakness.fireRate + needsThroughput * 0.36,
    projectile: weakness.projectiles + 0.18 + needsThroughput * 0.65,
    volley: weakness.projectiles * 0.92 + 0.2 + needsThroughput * 0.72,
    pierce: weakness.pierce * 0.8 + needsThroughput * 0.2,
    velocity: weakness.velocity * 0.75,
    speed: weakness.speed,
    overdrive: (weakness.damage + weakness.fireRate + weakness.speed) / 3,
    health: weakness.defense * 0.85,
    heal: missingHealth > 0 ? 1.2 + missingHealth * 0.25 : 0.05,
    range: weakness.utility * 0.75,
    "wide-range": weakness.utility * 0.65,
    dash: weakness.dash * 0.5,
  };

  return scores[id] ?? 0;
}
