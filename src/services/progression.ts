import { DEFAULT_PLAYER_STATS } from "../game/constants";
import type { PlayerStats } from "../game/gameTypes";
import type { RunSummary } from "../types";

const PROGRESSION_KEY = "storm_progression_v1";

export type ProgressionUpgradeId =
  | "health"
  | "damage"
  | "fireRate"
  | "speed"
  | "pickupRange"
  | "projectileSpeed"
  | "dashCooldown"
  | "projectiles";

export type ProgressionState = {
  version: 1;
  shards: number;
  totalRuns: number;
  totalSurvivalMs: number;
  totalScore: number;
  highestThreat: number;
  upgrades: Record<ProgressionUpgradeId, number>;
  lastReward: number;
};

export type ProgressionUpgrade = {
  id: ProgressionUpgradeId;
  title: string;
  description: string;
  baseCost: number;
  maxLevel: number;
};

export const PROGRESSION_UPGRADES: ProgressionUpgrade[] = [
  { id: "health", title: "Core Plating", description: "+1 max health per level", baseCost: 8, maxLevel: 6 },
  { id: "damage", title: "Reactor Mod", description: "+1 damage per level", baseCost: 10, maxLevel: 6 },
  { id: "fireRate", title: "Pulse Driver", description: "-10 fire delay per level", baseCost: 12, maxLevel: 6 },
  { id: "speed", title: "Vector Drive", description: "+12 movement speed per level", baseCost: 9, maxLevel: 5 },
  { id: "pickupRange", title: "Magnet Coil", description: "+14 pickup range per level", baseCost: 8, maxLevel: 6 },
  { id: "projectileSpeed", title: "Rail Tuning", description: "+35 projectile speed per level", baseCost: 9, maxLevel: 6 },
  { id: "dashCooldown", title: "Phase Capacitor", description: "-90ms dash cooldown per level", baseCost: 11, maxLevel: 5 },
  { id: "projectiles", title: "Split Array", description: "+1 projectile every 2 levels", baseCost: 15, maxLevel: 6 },
];

function defaultProgression(): ProgressionState {
  return {
    version: 1,
    shards: 0,
    totalRuns: 0,
    totalSurvivalMs: 0,
    totalScore: 0,
    highestThreat: 0,
    upgrades: {
      health: 0,
      damage: 0,
      fireRate: 0,
      speed: 0,
      pickupRange: 0,
      projectileSpeed: 0,
      dashCooldown: 0,
      projectiles: 0,
    },
    lastReward: 0,
  };
}

export function readProgression(): ProgressionState {
  try {
    const raw = localStorage.getItem(PROGRESSION_KEY);
    if (!raw) return defaultProgression();
    const parsed = JSON.parse(raw) as Partial<ProgressionState>;
    return normalizeProgression(parsed);
  } catch {
    return defaultProgression();
  }
}

export function writeProgression(state: ProgressionState): void {
  try {
    localStorage.setItem(PROGRESSION_KEY, JSON.stringify(state));
  } catch {
    // Ignore persistence failures; progression remains in-memory for the session.
  }
}

export function resetProgression(): ProgressionState {
  const state = defaultProgression();
  writeProgression(state);
  return state;
}

export function grantRunReward(summary: RunSummary): ProgressionState {
  const current = readProgression();
  const reward = computeReward(summary);
  const next = normalizeProgression({
    ...current,
    totalRuns: current.totalRuns + 1,
    totalSurvivalMs: current.totalSurvivalMs + summary.survivalMs,
    totalScore: current.totalScore + summary.score,
    highestThreat: Math.max(current.highestThreat, summary.maxThreatLevel),
    shards: current.shards + reward,
    lastReward: reward,
  });
  writeProgression(next);
  return next;
}

export function buyUpgrade(upgradeId: ProgressionUpgradeId): ProgressionState {
  const current = readProgression();
  const upgrade = PROGRESSION_UPGRADES.find((entry) => entry.id === upgradeId);
  if (!upgrade) return current;

  const level = current.upgrades[upgradeId];
  if (level >= upgrade.maxLevel) return current;

  const cost = getUpgradeCost(upgradeId, level);
  if (current.shards < cost) return current;

  const next = normalizeProgression({
    ...current,
    shards: current.shards - cost,
    upgrades: {
      ...current.upgrades,
      [upgradeId]: level + 1,
    },
  });
  writeProgression(next);
  return next;
}

export function applyProgression(stats: PlayerStats, progression: ProgressionState): PlayerStats {
  const level = progression.upgrades;
  const next = { ...stats };
  next.maxHealth += level.health;
  next.damage += level.damage;
  next.fireRate = Math.max(80, next.fireRate - level.fireRate * 10);
  next.speed += level.speed * 12;
  next.pickupRange += level.pickupRange * 14;
  next.projectileSpeed += level.projectileSpeed * 35;
  next.dashCooldown = Math.max(650, next.dashCooldown - level.dashCooldown * 90);
  next.projectiles = Math.min(8, next.projectiles + Math.floor(level.projectiles / 2));
  return next;
}

export function getUpgradeCost(upgradeId: ProgressionUpgradeId, currentLevel: number): number {
  const upgrade = PROGRESSION_UPGRADES.find((entry) => entry.id === upgradeId);
  if (!upgrade) return Number.POSITIVE_INFINITY;
  return Math.floor(upgrade.baseCost * Math.pow(1.35, currentLevel));
}

export function formatProgressionSummary(state: ProgressionState): string {
  return `${state.shards} shards · ${state.totalRuns} runs · threat ${state.highestThreat}`;
}

function computeReward(summary: RunSummary): number {
  const survivalReward = Math.max(1, Math.floor(summary.survivalMs / 15000));
  const scoreReward = Math.floor(summary.score / 7000);
  const killReward = Math.floor(summary.kills / 20);
  const threatReward = Math.floor(summary.maxThreatLevel / 6);
  return survivalReward + scoreReward + killReward + threatReward;
}

function normalizeProgression(input: Partial<ProgressionState>): ProgressionState {
  const base = defaultProgression();
  const upgrades = (input.upgrades || {}) as Partial<Record<ProgressionUpgradeId, number>>;
  return {
    version: 1,
    shards: Math.max(0, Math.floor(input.shards ?? base.shards)),
    totalRuns: Math.max(0, Math.floor(input.totalRuns ?? base.totalRuns)),
    totalSurvivalMs: Math.max(0, Math.floor(input.totalSurvivalMs ?? base.totalSurvivalMs)),
    totalScore: Math.max(0, Math.floor(input.totalScore ?? base.totalScore)),
    highestThreat: Math.max(0, Math.floor(input.highestThreat ?? base.highestThreat)),
    upgrades: {
      health: clampUpgradeLevel(upgrades.health ?? base.upgrades.health, "health"),
      damage: clampUpgradeLevel(upgrades.damage ?? base.upgrades.damage, "damage"),
      fireRate: clampUpgradeLevel(upgrades.fireRate ?? base.upgrades.fireRate, "fireRate"),
      speed: clampUpgradeLevel(upgrades.speed ?? base.upgrades.speed, "speed"),
      pickupRange: clampUpgradeLevel(upgrades.pickupRange ?? base.upgrades.pickupRange, "pickupRange"),
      projectileSpeed: clampUpgradeLevel(upgrades.projectileSpeed ?? base.upgrades.projectileSpeed, "projectileSpeed"),
      dashCooldown: clampUpgradeLevel(upgrades.dashCooldown ?? base.upgrades.dashCooldown, "dashCooldown"),
      projectiles: clampUpgradeLevel(upgrades.projectiles ?? base.upgrades.projectiles, "projectiles"),
    },
    lastReward: Math.max(0, Math.floor(input.lastReward ?? base.lastReward)),
  };
}

function clampUpgradeLevel(value: number, upgradeId: ProgressionUpgradeId): number {
  const upgrade = PROGRESSION_UPGRADES.find((entry) => entry.id === upgradeId);
  return Math.max(0, Math.min(upgrade?.maxLevel ?? 0, Math.floor(value)));
}
