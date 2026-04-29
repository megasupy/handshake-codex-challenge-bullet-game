import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH, ENEMY_BULLET_RADIUS, PLAYER_BULLET_RADIUS } from "./constants";

export function createArenaBackground(scene: Phaser.Scene): void {
  scene.cameras.main.setBackgroundColor("#07090f");
  const grid = scene.add.graphics();
  grid.lineStyle(1, 0x243044, 0.38);
  for (let x = 0; x <= ARENA_WIDTH; x += 64) grid.lineBetween(x, 0, x, ARENA_HEIGHT);
  for (let y = 0; y <= ARENA_HEIGHT; y += 64) grid.lineBetween(0, y, ARENA_WIDTH, y);

  scene.add.rectangle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, ARENA_WIDTH - 36, ARENA_HEIGHT - 36).setStrokeStyle(2, 0x334155, 0.9);
}

export function createGameTextures(scene: Phaser.Scene): void {
  makeCircleTexture(scene, "player-shot", PLAYER_BULLET_RADIUS, 0xfacc15);
  makeEnemyBulletTextures(scene);
  makeCircleTexture(scene, "pickup", 7, 0x22c55e);
  makeBossTexture(scene);
}

function makeEnemyBulletTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists("enemy-bullet-circle")) {
    const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0xdc2626, 1);
    graphics.fillCircle(ENEMY_BULLET_RADIUS, ENEMY_BULLET_RADIUS, ENEMY_BULLET_RADIUS);
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(ENEMY_BULLET_RADIUS, ENEMY_BULLET_RADIUS, Math.max(3, ENEMY_BULLET_RADIUS * 0.42));
    graphics.generateTexture("enemy-bullet-circle", ENEMY_BULLET_RADIUS * 2, ENEMY_BULLET_RADIUS * 2);
    graphics.destroy();
  }

  if (!scene.textures.exists("enemy-bullet-diamond")) {
    const size = ENEMY_BULLET_RADIUS * 2.5;
    const mid = size / 2;
    const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0xdc2626, 1);
    graphics.beginPath();
    graphics.moveTo(mid, 0);
    graphics.lineTo(size, mid);
    graphics.lineTo(mid, size);
    graphics.lineTo(0, mid);
    graphics.closePath();
    graphics.fillPath();
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(mid, mid, ENEMY_BULLET_RADIUS * 0.38);
    graphics.generateTexture("enemy-bullet-diamond", size, size);
    graphics.destroy();
  }

  if (!scene.textures.exists("enemy-bullet-arrow")) {
    const width = ENEMY_BULLET_RADIUS * 3.2;
    const height = ENEMY_BULLET_RADIUS * 2;
    const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0xdc2626, 1);
    graphics.beginPath();
    graphics.moveTo(width, height / 2);
    graphics.lineTo(width * 0.42, 0);
    graphics.lineTo(width * 0.52, height * 0.34);
    graphics.lineTo(0, height * 0.34);
    graphics.lineTo(0, height * 0.66);
    graphics.lineTo(width * 0.52, height * 0.66);
    graphics.lineTo(width * 0.42, height);
    graphics.closePath();
    graphics.fillPath();
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(width * 0.45, height / 2, ENEMY_BULLET_RADIUS * 0.34);
    graphics.generateTexture("enemy-bullet-arrow", width, height);
    graphics.destroy();
  }
}

function makeCircleTexture(scene: Phaser.Scene, key: string, radius: number, color: number): void {
  if (scene.textures.exists(key)) return;
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.fillStyle(color, 1);
  graphics.fillCircle(radius, radius, radius);
  graphics.generateTexture(key, radius * 2, radius * 2);
  graphics.destroy();
}

function makeBossTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists("boss-core")) return;
  const size = 172;
  const mid = size / 2;
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.fillStyle(0xef4444, 1);
  graphics.fillCircle(mid, mid, 70);
  graphics.fillStyle(0xdc2626, 1);
  graphics.fillCircle(mid, mid, 54);
  graphics.fillStyle(0xffffff, 1);
  graphics.fillCircle(mid, mid, 21);
  graphics.lineStyle(4, 0xffffff, 0.9);
  graphics.strokeCircle(mid, mid, 70);
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8;
    const x = mid + Math.cos(angle) * 82;
    const y = mid + Math.sin(angle) * 82;
    graphics.fillStyle(0xef4444, 1);
    graphics.fillTriangle(
      x,
      y,
      x + Math.cos(angle + 0.45) * 16,
      y + Math.sin(angle + 0.45) * 16,
      x + Math.cos(angle - 0.45) * 16,
      y + Math.sin(angle - 0.45) * 16,
    );
  }
  graphics.generateTexture("boss-core", size, size);
  graphics.destroy();
}
