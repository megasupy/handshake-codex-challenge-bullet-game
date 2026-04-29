import Phaser from "phaser";
import type { DebugSettings } from "./events";
import { ARENA_HEIGHT, ARENA_WIDTH, MAX_ACTIVE_PICKUPS, MAX_PICKUP_VALUE, PICKUP_MERGE_RADIUS } from "./constants";
import { pickupPop } from "./effects";
import type { EnemyData, EnemyKind } from "./gameTypes";
import { fireEnemyBullet } from "./projectiles";
import { getVisualPalette } from "./palette";

type EnemyShape = Phaser.GameObjects.Shape & Phaser.GameObjects.GameObject;

export type SerializedEnemyState = {
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  speed: number;
  fireAt: number;
  casts: number;
  vx: number;
  vy: number;
};

type WaveBlock = {
  durationMs: number;
  mix: Partial<Record<EnemyKind, number>>;
  spawnScale: number;
};

const PHASE_TABLES: Record<1 | 2 | 3, WaveBlock[]> = {
  1: [
    { durationMs: 12000, mix: { chaser: 1 }, spawnScale: 1.45 },
    { durationMs: 12000, mix: { chaser: 0.86, shooter: 0.14 }, spawnScale: 1.32 },
    { durationMs: 12000, mix: { chaser: 0.74, shooter: 0.18, spinner: 0.08 }, spawnScale: 1.25 },
    { durationMs: 24000, mix: { chaser: 0.66, shooter: 0.18, spinner: 0.1, bomber: 0.06 }, spawnScale: 1.18 },
  ],
  2: [
    { durationMs: 12000, mix: { chaser: 0.45, shooter: 0.28, spinner: 0.14, bomber: 0.13 }, spawnScale: 0.98 },
    { durationMs: 12000, mix: { chaser: 0.26, strafer: 0.28, shooter: 0.16, spinner: 0.1, bomber: 0.08, splitter: 0.12 }, spawnScale: 0.93 },
    { durationMs: 12000, mix: { strafer: 0.24, mine: 0.22, shooter: 0.14, spinner: 0.12, chaser: 0.14, splitter: 0.14 }, spawnScale: 0.84 },
    { durationMs: 24000, mix: { strafer: 0.22, mine: 0.16, bomber: 0.12, shooter: 0.14, spinner: 0.12, chaser: 0.1, splitter: 0.14 }, spawnScale: 0.82 },
  ],
  3: [
    { durationMs: 12000, mix: { chaser: 0.18, strafer: 0.22, shooter: 0.18, sniper: 0.12, spinner: 0.1, mine: 0.08, splitter: 0.12 }, spawnScale: 0.95 },
    { durationMs: 12000, mix: { strafer: 0.22, sniper: 0.12, summoner: 0.1, shooter: 0.14, spinner: 0.14, mine: 0.14, splitter: 0.12 }, spawnScale: 0.92 },
    { durationMs: 12000, mix: { sniper: 0.14, summoner: 0.12, mine: 0.16, strafer: 0.18, spinner: 0.14, bomber: 0.14, splitter: 0.12 }, spawnScale: 0.9 },
    { durationMs: 36000, mix: { sniper: 0.12, summoner: 0.14, strafer: 0.18, mine: 0.16, spinner: 0.14, bomber: 0.1, shooter: 0.08, splitter: 0.08 }, spawnScale: 0.88 },
  ],
};

export function getEnemyWaveStep(phaseId: 1 | 2 | 3, elapsedInPhaseMs: number): number {
  let elapsed = 0;
  const table = PHASE_TABLES[phaseId];
  for (let i = 0; i < table.length; i += 1) {
    elapsed += table[i].durationMs;
    if (elapsedInPhaseMs < elapsed) return i + 1;
  }
  return table.length;
}

export function spawnEnemyIfReady(args: {
  scene: Phaser.Scene;
  enemies: Phaser.Physics.Arcade.Group;
  rng: Phaser.Math.RandomDataGenerator;
  player: Phaser.GameObjects.Shape;
  elapsedMs: number;
  elapsedInPhaseMs: number;
  phaseId: 1 | 2 | 3;
  spawnAt: number;
  threat: number;
  debug: DebugSettings;
  spawnRateScale?: number;
}): number {
  if (args.elapsedMs < args.spawnAt) return args.spawnAt;
  if (args.enemies.countActive(true) >= args.debug.enemyCap) return args.elapsedMs + 260;

  const block = getWaveBlock(args.phaseId, args.elapsedInPhaseMs);
  const threatRamp = args.threat > 32 ? 0.74 : args.threat > 24 ? 0.84 : 1;
  const rateScale = Math.max(0.2, args.spawnRateScale ?? 1);
  const interval = Math.max(165, (1020 / Math.log2(args.threat + 2.4)) * block.spawnScale * threatRamp * args.debug.spawnMultiplier * rateScale);
  const kind = args.phaseId === 1 && args.elapsedInPhaseMs < 10000 ? "chaser" : weightedPick(block.mix, args.rng);
  if (!kind) return args.elapsedMs + interval;
  if (!canSpawnKind(args.enemies, kind)) return args.elapsedMs + interval * 0.55;

  createEnemy(args.scene, args.enemies, args.rng, kind, args.threat, args.elapsedMs, args.debug, args.player.x, args.player.y);
  if (args.threat > 8 && args.rng.frac() > 0.73 && kind !== "sniper" && kind !== "summoner") {
    createEnemy(args.scene, args.enemies, args.rng, "chaser", args.threat, args.elapsedMs, args.debug, args.player.x, args.player.y);
  }
  if (args.threat > 24 && args.rng.frac() > 0.8) {
    createEnemy(args.scene, args.enemies, args.rng, args.rng.frac() > 0.55 ? "minion" : "strafer", args.threat, args.elapsedMs, args.debug, args.player.x, args.player.y);
  }
  return args.elapsedMs + interval;
}

export function spawnEnemyAt(
  scene: Phaser.Scene,
  enemies: Phaser.Physics.Arcade.Group,
  rng: Phaser.Math.RandomDataGenerator,
  kind: EnemyKind,
  threat: number,
  elapsedMs: number,
  debug: DebugSettings,
  x: number,
  y: number,
): void {
  const { color, radius } = styleEnemy(kind);
  const enemy = createEnemyShape(scene, kind, x, y, radius, color);
  scene.physics.add.existing(enemy);
  const body = enemy.body as Phaser.Physics.Arcade.Body;
  body.setCircle(radius).setCollideWorldBounds(true);
  enemy.setData("enemy", {
    kind,
    hp: getEnemyHp(kind, threat, debug),
    speed: getEnemySpeed(kind, threat, debug),
    fireAt: elapsedMs + rng.between(220, 620),
    casts: 0,
  } satisfies EnemyData);
  enemy.setData("color", color);
  enemies.add(enemy);
}

export function updateEnemies(args: {
  enemies: Phaser.Physics.Arcade.Group;
  enemyBullets: Phaser.Physics.Arcade.Group;
  scene: Phaser.Scene;
  player: Phaser.GameObjects.Shape;
  elapsedMs: number;
  threat: number;
  debug: DebugSettings;
  rng: Phaser.Math.RandomDataGenerator;
}): void {
  args.enemies.children.each((child) => {
    const enemy = child as EnemyShape;
    const body = enemy.body as Phaser.Physics.Arcade.Body;
    const data = enemy.getData("enemy") as EnemyData;
    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, args.player.x, args.player.y);

    if (data.kind === "strafer") {
      body.setVelocity(Math.cos(angle + Math.PI / 2) * data.speed, Math.sin(angle + Math.PI / 2) * data.speed);
    } else if (data.kind === "mine") {
      body.setVelocity(Math.cos(angle) * data.speed * 0.35, Math.sin(angle) * data.speed * 0.35);
    } else if (data.kind === "sniper") {
      body.setVelocity(Math.cos(angle) * data.speed * 0.2, Math.sin(angle) * data.speed * 0.2);
    } else if (data.kind === "summoner") {
      body.setVelocity(Math.cos(angle) * data.speed * 0.42, Math.sin(angle) * data.speed * 0.42);
    } else if (data.kind === "splitter") {
      body.setVelocity(Math.cos(angle) * data.speed * 0.9, Math.sin(angle) * data.speed * 0.9);
    } else {
      body.setVelocity(Math.cos(angle) * data.speed, Math.sin(angle) * data.speed);
    }

    if (args.elapsedMs >= data.fireAt && data.kind !== "chaser" && data.kind !== "minion") {
      firePattern(args.scene, args.enemyBullets, enemy, data.kind, args.threat, args.debug, args.player, data.casts);
      data.casts += 1;
      data.fireAt = args.elapsedMs + getEnemyFireCadenceMs(data.kind, args.threat, args.debug);

      if (data.kind === "summoner" && args.enemies.countActive(true) < Math.max(24, Math.floor(args.debug.enemyCap * 0.4))) {
        createEnemy(args.scene, args.enemies, args.rng, "minion", args.threat, args.elapsedMs, args.debug, args.player.x, args.player.y);
      }
    }
    return true;
  });
}

export function restoreEnemyFromState(
  scene: Phaser.Scene,
  enemies: Phaser.Physics.Arcade.Group,
  state: SerializedEnemyState,
): void {
  const { color, radius } = styleEnemy(state.kind);
  const enemy = createEnemyShape(scene, state.kind, state.x, state.y, radius, color);
  scene.physics.add.existing(enemy);
  const body = enemy.body as Phaser.Physics.Arcade.Body;
  body.setCircle(radius).setCollideWorldBounds(true).setVelocity(state.vx, state.vy);
  enemy.setData("enemy", {
    kind: state.kind,
    hp: state.hp,
    speed: state.speed,
    fireAt: state.fireAt,
    casts: state.casts,
  } satisfies EnemyData);
  enemy.setData("color", color);
  enemies.add(enemy);
}

export function firePattern(
  scene: Phaser.Scene,
  enemyBullets: Phaser.Physics.Arcade.Group,
  enemy: Phaser.GameObjects.Shape,
  kind: EnemyKind,
  threat: number,
  debug: DebugSettings,
  player: Phaser.GameObjects.Shape,
  casts = 0,
): void {
  const baseAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
  if (kind === "shooter") {
    if (threat >= 10 && casts % 7 === 6) {
      // Special 1: moving lane wall (forces side-step through narrow lanes)
      const normal = baseAngle + Math.PI / 2;
      for (let i = -4; i <= 4; i += 1) {
        const offset = i * 20;
        const ex = enemy.x + Math.cos(normal) * offset;
        const ey = enemy.y + Math.sin(normal) * offset;
        fireEnemyBullet(scene, enemyBullets, ex, ey, baseAngle, 176 + threat * 4, debug, { radiusScale: 1.18 });
      }
      return;
    }
    const offsets = threat < 7 ? [0] : threat < 14 ? [-0.1, 0.1] : [-0.1, 0, 0.1];
    for (const offset of offsets) fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + offset, 152 + threat * 6, debug);
    return;
  }
  if (kind === "spinner") {
    if (threat >= 12 && casts % 6 === 5) {
      // Special 2: dual rotating rings
      const ringA = 9;
      const ringB = 11;
      const rot = casts * 0.22;
      for (let i = 0; i < ringA; i += 1) fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, rot + (Math.PI * 2 * i) / ringA, 132 + threat * 4, debug);
      for (let i = 0; i < ringB; i += 1) fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, -rot + (Math.PI * 2 * i) / ringB, 126 + threat * 4, debug, { radiusScale: 1.08 });
      return;
    }
    const count = threat < 8 ? 3 : Math.min(8, 3 + Math.floor(threat * 0.24));
    for (let i = 0; i < count; i += 1) fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + (Math.PI * 2 * i) / count, 128 + threat * 6, debug);
    return;
  }
  if (kind === "bomber") {
    if (threat >= 11 && casts % 6 === 3) {
      // Special 3: heavy slow orbs (area denial)
      for (const offset of [-0.26, 0, 0.26]) {
        fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + offset, 104 + threat * 2, debug, { radiusScale: 1.95 });
      }
      return;
    }
    for (const offset of [-0.42, -0.14, 0.14, 0.42]) fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + offset, 144 + threat * 6, debug);
    return;
  }
  if (kind === "strafer") {
    for (const side of [-Math.PI / 2, Math.PI / 2]) fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + side, 172 + threat * 5, debug);
    return;
  }
  if (kind === "mine") {
    if (threat >= 12 && casts % 5 === 4) {
      // Special 4: rotating cage
      const petals = 10;
      const spin = casts * 0.28;
      for (let i = 0; i < petals; i += 1) {
        fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, spin + (Math.PI * 2 * i) / petals, 118 + threat * 3, debug, { radiusScale: i % 2 === 0 ? 1.35 : 1 });
      }
      return;
    }
    const petals = 6;
    for (let i = 0; i < petals; i += 1) fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + (Math.PI * 2 * i) / petals, 112 + threat * 4, debug);
    return;
  }
  if (kind === "sniper") {
    if (threat >= 14 && casts % 4 === 3) {
      // Special 5: puncture shot with side blockers
      fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle, 240 + threat * 5, debug, { radiusScale: 1.65 });
      fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + 0.22, 172 + threat * 3, debug, { radiusScale: 1.15 });
      fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle - 0.22, 172 + threat * 3, debug, { radiusScale: 1.15 });
      return;
    }
    fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle, 215 + threat * 4, debug);
    return;
  }
  if (kind === "summoner") {
    for (const offset of [-0.2, 0.2]) fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + offset, 140 + threat * 4, debug);
    return;
  }
  if (kind === "splitter") {
    const count = threat < 14 ? 3 : 5;
    for (let i = 0; i < count; i += 1) {
      const offset = (i - (count - 1) / 2) * 0.12;
      fireEnemyBullet(scene, enemyBullets, enemy.x, enemy.y, baseAngle + offset, 146 + threat * 4, debug, { radiusScale: i === Math.floor(count / 2) ? 1.2 : 1 });
    }
  }
}

export function createPickup(scene: Phaser.Scene, pickups: Phaser.Physics.Arcade.Group, x: number, y: number, rng?: Phaser.Math.RandomDataGenerator, timeScale = 1): void {
  const existing = findPickupMergeTarget(pickups, x, y, pickups.countActive(true) >= MAX_ACTIVE_PICKUPS);
  if (existing) {
    incrementPickupValue(existing);
    return;
  }

  const pickup = scene.physics.add.image(x, y, getVisualPalette().highContrast ? "pickup-hc" : "pickup");
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
  const { color, radius } = styleEnemy(kind);
  const enemy = createEnemyShape(scene, kind, x, y, radius, color);
  scene.physics.add.existing(enemy);
  const body = enemy.body as Phaser.Physics.Arcade.Body;
  body.setCircle(radius).setCollideWorldBounds(true);
  enemy.setData("enemy", {
    kind,
    hp: getEnemyHp(kind, threat, debug),
    speed: getEnemySpeed(kind, threat, debug),
    fireAt: elapsedMs + rng.between(700, 1700),
    casts: 0,
  } satisfies EnemyData);
  enemy.setData("color", color);
  enemies.add(enemy);
}

function styleEnemy(kind: EnemyKind): { color: number; radius: number } {
  const palette = getVisualPalette();
  const baseRadius = kind === "minion" ? 9 : kind === "spinner" ? 16 : kind === "bomber" ? 15 : kind === "sniper" ? 15 : kind === "splitter" ? 15 : 14;
  return { color: palette.enemyKinds[kind], radius: baseRadius };
}

function getEnemyHp(kind: EnemyKind, threat: number, debug: DebugSettings): number {
  const base =
    kind === "spinner" ? 5 + threat :
      kind === "bomber" ? 4 + threat :
        kind === "sniper" ? 4 + Math.floor(threat * 0.6) :
          kind === "summoner" ? 6 + Math.floor(threat * 0.8) :
            kind === "splitter" ? 5 + Math.floor(threat * 0.7) :
            kind === "minion" ? 1 + Math.floor(threat * 0.2) :
              2 + Math.floor(threat / 2);
  return Math.ceil(base * debug.enemyHealthMultiplier);
}

function getEnemySpeed(kind: EnemyKind, threat: number, debug: DebugSettings): number {
  const base =
    kind === "chaser" ? 90 + threat * 6 :
      kind === "strafer" ? 102 + threat * 5 :
        kind === "bomber" ? 74 + threat * 4 :
          kind === "mine" ? 62 + threat * 3 :
            kind === "sniper" ? 52 + threat * 2 :
              kind === "summoner" ? 58 + threat * 3 :
                kind === "splitter" ? 88 + threat * 4 :
                kind === "minion" ? 112 + threat * 5 :
                  40 + threat * 2;
  return base * debug.enemySpeedMultiplier;
}

function getEnemyFireCadenceMs(kind: EnemyKind, threat: number, debug: DebugSettings): number {
  const base =
    kind === "sniper" ? 2100 :
      kind === "mine" ? 1900 :
        kind === "spinner" ? 1500 :
          kind === "bomber" ? 1400 :
            kind === "strafer" ? 1280 :
              kind === "summoner" ? 2000 :
                kind === "splitter" ? 1550 :
                1650;
  return Math.max(760, (base - threat * 26) * debug.enemyFireRateMultiplier);
}

function getWaveBlock(phaseId: 1 | 2 | 3, elapsedInPhaseMs: number): WaveBlock {
  const table = PHASE_TABLES[phaseId];
  let elapsed = 0;
  for (const block of table) {
    elapsed += block.durationMs;
    if (elapsedInPhaseMs < elapsed) return block;
  }
  return table[table.length - 1];
}

function weightedPick(mix: Partial<Record<EnemyKind, number>>, rng: Phaser.Math.RandomDataGenerator): EnemyKind | null {
  const entries = Object.entries(mix) as Array<[EnemyKind, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return null;
  let roll = rng.frac() * total;
  for (const [kind, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return entries[entries.length - 1][0];
}

function canSpawnKind(enemies: Phaser.Physics.Arcade.Group, kind: EnemyKind): boolean {
  if (kind !== "sniper" && kind !== "summoner" && kind !== "mine" && kind !== "splitter") return true;
  let count = 0;
  enemies.children.each((child) => {
    const enemy = child as EnemyShape;
    if (!enemy.active) return true;
    const data = enemy.getData("enemy") as EnemyData | undefined;
    if (data?.kind === kind) count += 1;
    return true;
  });
  const cap = kind === "sniper" ? 3 : kind === "summoner" ? 3 : kind === "splitter" ? 4 : 6;
  return count < cap;
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

function createEnemyShape(scene: Phaser.Scene, kind: EnemyKind, x: number, y: number, radius: number, color: number): EnemyShape {
  if (kind === "shooter") return scene.add.triangle(x, y, 0, radius * 1.35, radius, 0, radius * 2, radius * 1.35, color, 1) as EnemyShape;
  if (kind === "spinner") return scene.add.star(x, y, 6, radius * 0.55, radius, color, 1) as EnemyShape;
  if (kind === "bomber") return scene.add.rectangle(x, y, radius * 1.8, radius * 1.8, color, 1) as EnemyShape;
  if (kind === "strafer") return scene.add.ellipse(x, y, radius * 2.1, radius * 1.2, color, 1) as EnemyShape;
  if (kind === "mine") return scene.add.polygon(x, y, [0, -radius, radius * 0.75, 0, 0, radius, -radius * 0.75, 0], color, 1) as EnemyShape;
  if (kind === "sniper") return scene.add.star(x, y, 4, radius * 0.48, radius, color, 1) as EnemyShape;
  if (kind === "summoner") return scene.add.rectangle(x, y, radius * 1.5, radius * 1.5, color, 1) as EnemyShape;
  if (kind === "splitter") return scene.add.polygon(x, y, [0, -radius, radius * 0.86, -radius * 0.5, radius * 0.86, radius * 0.5, 0, radius, -radius * 0.86, radius * 0.5, -radius * 0.86, -radius * 0.5], color, 1) as EnemyShape;
  if (kind === "minion") return scene.add.circle(x, y, radius, color, 1) as EnemyShape;
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
