import type { DebugSettings, UpgradeOption } from "../game/events";
import type { SerializedBossState } from "../game/boss1";
import type { SerializedEnemyBulletState, SerializedPlayerShotState } from "../game/projectiles";
import type { SerializedEnemyState } from "../game/enemies";
import type { SerializedPickupState } from "../game/pickups";
import type { GameMode } from "../types";
import type { ProgressionState } from "./progression";
import type { TelemetryConfig } from "../game/telemetry";
import type { PlayerStats } from "../game/gameTypes";

const CHECKPOINT_KEY = "storm_checkpoint_v1";

export type CheckpointState = {
  version: 1;
  savedAt: string;
  mode: GameMode;
  seed: string;
  elapsedMs: number;
  score: number;
  kills: number;
  health: number;
  invulnerableUntil: number;
  spawnAt: number;
  shootAt: number;
  dashAt: number;
  dashUntil: number;
  dashVector: { x: number; y: number };
  lastManualDirection: { x: number; y: number };
  pausedForUpgrade: boolean;
  nextUpgradeAt: number;
  nextBossAt: number;
  bossEncountersSpawned: number;
  finalApexActive: boolean;
  maxThreatLevel: number;
  activeBossStartedAt: number | null;
  playerShotsFired: number;
  playerShotsHit: number;
  upgradesTaken: number;
  bossesDefeated: number;
  debug: DebugSettings;
  stats: PlayerStats;
  initialProgression: ProgressionState | null;
  telemetryConfig: TelemetryConfig;
  player: {
    x: number;
    y: number;
    rotation: number;
    visible: boolean;
    velocityX: number;
    velocityY: number;
  };
  boss: SerializedBossState | null;
  enemies: SerializedEnemyState[];
  enemyBullets: SerializedEnemyBulletState[];
  playerShots: SerializedPlayerShotState[];
  pickups: SerializedPickupState[];
  upgradeOptions: UpgradeOption[] | null;
};

export function readCheckpoint(): CheckpointState | null {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CheckpointState;
  } catch {
    return null;
  }
}

export function writeCheckpoint(checkpoint: CheckpointState): void {
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
  } catch {
    // Ignore persistence failures so the run itself keeps working offline.
  }
}

export function clearCheckpoint(): void {
  try {
    localStorage.removeItem(CHECKPOINT_KEY);
  } catch {
    // Ignore persistence failures.
  }
}

export function hasCheckpoint(): boolean {
  return readCheckpoint() !== null;
}

export function describeCheckpoint(checkpoint: CheckpointState | null): string {
  if (!checkpoint) return "No saved run";
  const time = (checkpoint.elapsedMs / 1000).toFixed(1);
  return `Resume ${time}s run · Score ${Math.floor(checkpoint.score).toLocaleString()} · Threat ${checkpoint.maxThreatLevel}`;
}
