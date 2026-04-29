import type { RunSummary } from "../types";
import type { TelemetryRun } from "./telemetry";

export const gameEvents = new EventTarget();

export type HudPayload = {
  timeMs: number;
  score: number;
  health: number;
  threat: number;
};

export type UpgradeOption = {
  id: string;
  title: string;
  description: string;
};

export type DebugSettings = {
  enabled: boolean;
  threatOverride: number;
  timeScale: number;
  spawnMultiplier: number;
  enemySpeedMultiplier: number;
  enemyBulletSpeedMultiplier: number;
  enemyHealthMultiplier: number;
  enemyFireRateMultiplier: number;
  playerFireRateMultiplier: number;
  playerProjectileSpeed: number;
  enemyCap: number;
  invulnerable: boolean;
  autoplayer: boolean;
};

export type DebugStats = {
  elapsedMs: number;
  threat: number;
  score: number;
  health: number;
  kills: number;
  enemies: number;
  playerShots: number;
  enemyBullets: number;
  pickups: number;
  nextSpawnMs: number;
  nextUpgradeMs: number;
  dashCooldownMs: number;
  seed: string;
  danger: number;
  projectedDanger: number;
};

export type BossHudPayload = {
  active: boolean;
  name: string;
  hp: number;
  maxHp: number;
  phase: number;
  patternId?: string;
};

export type AutomationCompletePayload = {
  run: TelemetryRun | null;
};

export type AutomationSnapshotPayload = {
  run: TelemetryRun;
};

export function emitHud(payload: HudPayload): void {
  gameEvents.dispatchEvent(new CustomEvent("hud", { detail: payload }));
}

export function emitUpgrade(options: UpgradeOption[]): void {
  gameEvents.dispatchEvent(new CustomEvent("upgrade", { detail: options }));
}

export function emitGameOver(summary: RunSummary): void {
  gameEvents.dispatchEvent(new CustomEvent("game-over", { detail: summary }));
}

export function emitDebugStats(stats: DebugStats): void {
  gameEvents.dispatchEvent(new CustomEvent("debug-stats", { detail: stats }));
}

export function emitBossHud(payload: BossHudPayload): void {
  gameEvents.dispatchEvent(new CustomEvent("boss-hud", { detail: payload }));
}

export function emitAutomationComplete(payload: AutomationCompletePayload): void {
  gameEvents.dispatchEvent(new CustomEvent("automation-complete", { detail: payload }));
}

export function emitAutomationSnapshot(payload: AutomationSnapshotPayload): void {
  gameEvents.dispatchEvent(new CustomEvent("automation-snapshot", { detail: payload }));
}
