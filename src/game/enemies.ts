import Phaser from "phaser";
import type { DebugSettings } from "./events";
import { ARENA_HEIGHT, ARENA_WIDTH, MAX_ACTIVE_PICKUPS, MAX_PICKUP_VALUE, PICKUP_MERGE_RADIUS } from "./constants";
import { pickupPop } from "./effects";
import type { EnemyData, EnemyKind } from "./gameTypes";
import { fireEnemyBullet } from "./projectiles";

type EnemyShape = Phaser.GameObjects.Shape & Phaser.GameObjects.GameObject;

type EnemySpawnEntry = {
  kind: EnemyKind;
  unlockAtMs: number;
};

const ENEMY_SPAWN_TABLE: EnemySpawnEntry[] = [
  { kind: "chaser", unlockAtMs: 0 },
  { kind: "shooter", unlockAtMs: 20000 },
  { kind: "spinner", unlockAtMs: 40000 },
  { kind: "bomber", unlockAtMs: 60000 },
];

export function spawnEnemyIfReady(args: {
  scene: Phaser.Scene;
  enemies: Phaser.Physics.Arcade.Group;
  rng: Phaser.Math.RandomDataGenerator;
  player: Phaser.GameObjects.Shape;
  elapsedMs: number;
  spawnAt: number;
  threat: number;
  debug: DebugSettings;
}): number {
  if (args.elapsedMs < args.spawnAt) return args.spawnAt;
  if (args.enemies.countActive(true) >= args.debug.enemyCap) return args.elapsedMs + 250;

  const interval = Math.max(120, (1080 / Math.log2(args.threat + 2)) * args.debug.spawnMultiplier);
  const kind = chooseEnemyKind(args.elapsedMs, args.rng);

  createEnemy(args.scene, args.enemies, args.rng, kind, args.threat, args.elapsedMs, args.debug, args.player.x, args.player.y);
  if (args.threat > 6 && args.rng.frac() > 0.42) {
    createEnemy(args.scene, args.enemies, args.rng, "chaser", args.threat, args.elapsedMs, args.debug, args.player.x, args.player.y);
  }
  return args.elapsedMs + interval;
}

export function updateEnemies(args: {
  enemies: Phaser.Physics.Arcade.Group;
  enemyBullets: Phaser.Physics.Arcade.Group;
  scene: Phaser.Scene;
  player: Phaser.GameObjects.Shape;
  elapsedMs: number;
  threat: number;
  debug: DebugSettings;
}): void {
  args.enemies.children.each((child) => {
    const enemy = child as EnemyShape;
    const body = enemy.body as Phaser.Physics.Arcade.Body;
    const data = enemy.getData("enemy") as EnemyData;
    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, args.player.x, args.player.y);
    body.setVelocity(Math.cos(angle) * data.speed * args.debug.timeScale, Math.sin(angle) * data.speed * args.debug.timeScale);

    if (args.elapsedMs >= data.fireAt && data.kind !== "chaser") {
      firePattern(args.scene, args.enemyBullets, enemy, data.kind, args.threat, args.debug, args.player);
      data.fireAt = args.elapsedMs + Math.max(540, (2200 - args.threat * 72) * args.debug.enemyFireRateMultiplier);
    }

    return true;
  });
}

export function firePattern(
  scene: Phaser.Scene,
  enemyBullets: Phaser.Physics.Arcade.Group,
  enemy: Phaser.GameObjects.Shape,
  kind: EnemyKind,
  threat: number,
  debug: DebugSettings,
  player: Phaser.GameObjects.Shape,
): void {
  const baseAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
  if (kind === "shooter") {
    const spread = threat >= 9 ? 0.16 : 0;
    const shots = threat >= 9 ? [-1, 1] : [0];
    for (const i of shots) fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + i * spread, 165 + threat * 9, debug);
  }
  if (kind === "spinner") {
    const count = Math.min(7, 2 + Math.floor(threat * 0.42));
    for (let i = 0; i < count; i += 1) {
      fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + (Math.PI * 2 * i) / count, 132 + threat * 7, debug);
    }
  }
  if (kind === "bomber") {
    const count = threat >= 9 ? 4 : 2;
    for (let i = 0; i < count; i += 1) fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + i * 0.58, 148 + threat * 7, debug);
  }
}

export function createPickup(scene: Phaser.Scene, pickups: Phaser.Physics.Arcade.Group, x: number, y: number, rng?: Phaser.Math.RandomDataGenerator, timeScale = 1): void {
  const existing = findPickupMergeTarget(pickups, x, y, pickups.countActive(true) >= MAX_ACTIVE_PICKUPS);
  if (existing) {
    incrementPickupValue(existing);
    return;
  }

  const pickup = scene.physics.add.image(x, y, "pickup");
  const body = pickup.body as Phaser.Physics.Arcade.Body;
  body.setCircle(5).setAllowGravity(false).setDrag(260, 260);
  const angle = rng ? rng.realInRange(0, Math.PI * 2) : Phaser.Math.FloatBetween(0, Math.PI * 2);
  const speed = (rng ? rng.between(80, 190) : Phaser.Math.Between(80, 190)) * timeScale;
  body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  pickup.setData("value", 1);
  pickupPop(scene, pickup);
  applyPickupScale(pickup);
  pickups.add(pickup);
}

function createEnemy(
  scene: Phaser.Scene,
  enemies: Phaser.Physics.Arcade.Group,
  rng: Phaser.Math.RandomDataGenerator,
  kind: EnemyKind,
  threat: number,
  elapsedMs: number,
  debug: DebugSettings,
  playerX: number,
  playerY: number,
): void {
  const spawn = chooseSpawnPoint(rng, playerX, playerY);
  const x = spawn.x;
  const y = spawn.y;
  const color = kind === "chaser" ? 0x60a5fa : kind === "shooter" ? 0xa78bfa : kind === "spinner" ? 0xf59e0b : 0x22d3ee;
  const radius = kind === "spinner" ? 18 : kind === "bomber" ? 16 : 14;
  const enemy = createEnemyShape(scene, kind, x, y, radius, color);
  scene.physics.add.existing(enemy);
  const body = enemy.body as Phaser.Physics.Arcade.Body;
  body.setCircle(radius).setCollideWorldBounds(true);
  enemy.setData("enemy", {
    kind,
    hp: Math.ceil((kind === "spinner" ? 4 + threat : kind === "bomber" ? 3 + threat : 2 + Math.floor(threat / 2)) * 1.25 * debug.enemyHealthMultiplier),
    speed: (kind === "chaser" ? 88 + threat * 6 : kind === "bomber" ? 70 + threat * 5 : 36 + threat * 2) * debug.enemySpeedMultiplier,
    fireAt: elapsedMs + rng.between(900, 1800),
  } satisfies EnemyData);
  enemy.setData("color", color);
  enemies.add(enemy);
}

function chooseSpawnPoint(rng: Phaser.Math.RandomDataGenerator, playerX: number, playerY: number): { x: number; y: number } {
  let best = { x: 22, y: 22 };
  let bestDistanceSq = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < 8; i += 1) {
    const side = rng.between(0, 3);
    const candidate = {
      x: side === 0 ? 22 : side === 1 ? ARENA_WIDTH - 22 : rng.between(30, ARENA_WIDTH - 30),
      y: side === 2 ? 22 : side === 3 ? ARENA_HEIGHT - 22 : rng.between(30, ARENA_HEIGHT - 30),
    };
    const dx = candidate.x - playerX;
    const dy = candidate.y - playerY;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > bestDistanceSq) {
      best = candidate;
      bestDistanceSq = distanceSq;
    }
  }

  return best;
}

function chooseEnemyKind(elapsedMs: number, rng: Phaser.Math.RandomDataGenerator): EnemyKind {
  const unlocked = ENEMY_SPAWN_TABLE.filter((entry) => elapsedMs >= entry.unlockAtMs);
  if (unlocked.length <= 1) return "chaser";

  const weights = unlocked.map((entry) => {
    if (entry.kind === "chaser") return 10;
    const unlockedFor = elapsedMs - entry.unlockAtMs;
    const rampStage = Math.min(4, Math.floor(Math.max(0, unlockedFor) / 3000) + 1);
    return rampStage;
  });

  const total = weights.reduce((sum, value) => sum + value, 0);
  let roll = rng.frac() * total;
  for (let i = 0; i < unlocked.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return unlocked[i].kind;
  }
  return unlocked[unlocked.length - 1].kind;
}

function createEnemyShape(scene: Phaser.Scene, kind: EnemyKind, x: number, y: number, radius: number, color: number): EnemyShape {
  if (kind === "shooter") {
    return scene.add.triangle(x, y, 0, radius * 1.35, radius, 0, radius * 2, radius * 1.35, color, 1) as EnemyShape;
  }
  if (kind === "spinner") {
    return scene.add.star(x, y, 6, radius * 0.55, radius, color, 1) as EnemyShape;
  }
  if (kind === "bomber") {
    return scene.add.rectangle(x, y, radius * 1.8, radius * 1.8, color, 1) as EnemyShape;
  }
  return scene.add.polygon(x, y, [0, -radius, radius, 0, 0, radius, -radius, 0], color, 1) as EnemyShape;
}

function findPickupMergeTarget(pickups: Phaser.Physics.Arcade.Group, x: number, y: number, forceAnyNearest: boolean): Phaser.Physics.Arcade.Image | null {
  let best: Phaser.Physics.Arcade.Image | null = null;
  let bestDistanceSq = forceAnyNearest ? Number.POSITIVE_INFINITY : PICKUP_MERGE_RADIUS * PICKUP_MERGE_RADIUS;
  const entries = pickups.children.entries as Phaser.Physics.Arcade.Image[];
  for (const pickup of entries) {
    if (!pickup?.active) continue;
    const dx = pickup.x - x;
    const dy = pickup.y - y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      best = pickup;
      bestDistanceSq = distanceSq;
    }
  }
  return best;
}

function incrementPickupValue(pickup: Phaser.Physics.Arcade.Image) {
  const nextValue = Math.min(MAX_PICKUP_VALUE, Number(pickup.getData("value") || 1) + 1);
  pickup.setData("value", nextValue);
  applyPickupScale(pickup);
}

function applyPickupScale(pickup: Phaser.Physics.Arcade.Image) {
  const value = Number(pickup.getData("value") || 1);
  const scale = 0.9 + Math.min(0.75, Math.log2(value) * 0.22);
  pickup.setScale(scale);
  const body = pickup.body as Phaser.Physics.Arcade.Body;
  const radius = Math.round(5 + Math.min(4, Math.log2(value) * 1.35));
  body.setCircle(radius, 7 - radius, 7 - radius);
}
