import Phaser from "phaser";
import type { DebugSettings } from "./events";
import type { PlayerStats } from "./gameTypes";

export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 900;
export const UPGRADE_INTERVAL_MS = 12000;
export const PLAYER_BULLET_RADIUS = 3;
export const ENEMY_BULLET_RADIUS = 11;
export const MAX_ACTIVE_ENEMY_BULLETS = 130;
export const MAX_ACTIVE_PICKUPS = 45;
export const MAX_PICKUP_VALUE = 8;
export const PICKUP_MERGE_RADIUS = 28;
export const AUTOPLAYER_DECISION_INTERVAL_MS = 75;
export const AUTOPLAYER_PICKUP_SCAN_LIMIT = 48;
export const AUTOPLAYER_BULLET_SCAN_LIMIT = 96;
export const AUTOPLAYER_ENEMY_SCAN_LIMIT = 48;
export const TELEMETRY_SAMPLE_INTERVAL_MS = 250;

export const AUTOPLAYER_DIRECTIONS = [
  new Phaser.Math.Vector2(0, 0),
  ...Array.from({ length: 16 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 16;
    return new Phaser.Math.Vector2(Math.cos(angle), Math.sin(angle));
  }),
];

export const DEFAULT_DEBUG_SETTINGS: DebugSettings = {
  enabled: false,
  threatOverride: 0,
  timeScale: 1,
  spawnMultiplier: 1,
  enemySpeedMultiplier: 1,
  enemyBulletSpeedMultiplier: 1,
  enemyHealthMultiplier: 1,
  enemyFireRateMultiplier: 1,
  playerFireRateMultiplier: 1,
  playerProjectileSpeed: 620,
  enemyCap: 120,
  invulnerable: false,
  autoplayer: false,
};

export const DEFAULT_PLAYER_STATS: PlayerStats = {
  speed: 245,
  fireRate: 250,
  damage: 1,
  projectiles: 1,
  projectileSpeed: 620,
  pierce: 0,
  maxHealth: 3,
  pickupRange: 72,
  dashCooldown: 1800,
};
