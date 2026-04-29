import Phaser from "phaser";
import type { DebugSettings } from "./events";
import { ARENA_HEIGHT, ARENA_WIDTH, ENEMY_BULLET_RADIUS, MAX_ACTIVE_ENEMY_BULLETS, PLAYER_BULLET_RADIUS } from "./constants";

export type SerializedPlayerShotState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastX: number;
  lastY: number;
  damage: number;
  pierce: number;
};

export type SerializedEnemyBulletState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastX: number;
  lastY: number;
  radiusScale: number;
  angle: number;
};

export function firePlayerShot(
  scene: Phaser.Scene,
  group: Phaser.Physics.Arcade.Group,
  x: number,
  y: number,
  angle: number,
  damage: number,
  projectileSpeed: number,
  pierce: number,
  debug: DebugSettings,
): void {
  const shot = scene.physics.add.image(x, y, "player-shot");
  const body = shot.body as Phaser.Physics.Arcade.Body;
  const speedScale = debug.playerProjectileSpeed / 620;
  const vx = Math.cos(angle) * projectileSpeed * speedScale;
  const vy = Math.sin(angle) * projectileSpeed * speedScale;
  body.setCircle(PLAYER_BULLET_RADIUS).setAllowGravity(false).setVelocity(vx, vy);
  shot.setData("vx", vx);
  shot.setData("vy", vy);
  shot.setData("lastX", shot.x);
  shot.setData("lastY", shot.y);
  shot.setData("damage", damage);
  shot.setData("pierce", pierce);
  group.add(shot);
}

export function restorePlayerShot(
  scene: Phaser.Scene,
  group: Phaser.Physics.Arcade.Group,
  state: SerializedPlayerShotState,
): void {
  const shot = scene.physics.add.image(state.x, state.y, "player-shot");
  const body = shot.body as Phaser.Physics.Arcade.Body;
  body.setCircle(PLAYER_BULLET_RADIUS).setAllowGravity(false).setVelocity(state.vx, state.vy);
  shot.setData("vx", state.vx);
  shot.setData("vy", state.vy);
  shot.setData("lastX", state.lastX);
  shot.setData("lastY", state.lastY);
  shot.setData("damage", state.damage);
  shot.setData("pierce", state.pierce);
  group.add(shot);
}

export function fireEnemyBullet(
  scene: Phaser.Scene,
  group: Phaser.Physics.Arcade.Group,
  x: number,
  y: number,
  angle: number,
  speed: number,
  debug: DebugSettings,
  options?: { radiusScale?: number },
): boolean {
  if (group.countActive(true) >= MAX_ACTIVE_ENEMY_BULLETS) return false;
  const texture = getEnemyBulletTexture(angle);
  const bullet = scene.physics.add.image(x, y, texture);
  const body = bullet.body as Phaser.Physics.Arcade.Body;
  const finalSpeed = speed * debug.enemyBulletSpeedMultiplier;
  const vx = Math.cos(angle) * finalSpeed;
  const vy = Math.sin(angle) * finalSpeed;
  const radiusScale = Phaser.Math.Clamp(options?.radiusScale ?? 1, 0.6, 3.2);
  const radius = ENEMY_BULLET_RADIUS * radiusScale;
  body.setCircle(radius).setAllowGravity(false).setVelocity(vx, vy);
  bullet.setScale(radiusScale);
  bullet.setRotation(angle);
  bullet.setData("vx", vx);
  bullet.setData("vy", vy);
  bullet.setData("lastX", bullet.x);
  bullet.setData("lastY", bullet.y);
  group.add(bullet);
  return true;
}

export function restoreEnemyBullet(
  scene: Phaser.Scene,
  group: Phaser.Physics.Arcade.Group,
  state: SerializedEnemyBulletState,
): void {
  if (group.countActive(true) >= MAX_ACTIVE_ENEMY_BULLETS) return;
  const bullet = scene.physics.add.image(state.x, state.y, "enemy-bullet-circle");
  const body = bullet.body as Phaser.Physics.Arcade.Body;
  const radiusScale = Phaser.Math.Clamp(state.radiusScale, 0.6, 3.2);
  const radius = ENEMY_BULLET_RADIUS * radiusScale;
  body.setCircle(radius).setAllowGravity(false).setVelocity(state.vx, state.vy);
  bullet.setScale(radiusScale);
  bullet.setRotation(state.angle);
  bullet.setData("vx", state.vx);
  bullet.setData("vy", state.vy);
  bullet.setData("lastX", state.lastX);
  bullet.setData("lastY", state.lastY);
  group.add(bullet);
}

function getEnemyBulletTexture(angle: number): string {
  void angle;
  return "enemy-bullet-circle";
}

export function updateProjectiles(group: Phaser.Physics.Arcade.Group): void {
  ensureProjectileMotion(group);
  group.children.each((child) => {
    const obj = child as Phaser.Physics.Arcade.Image;
    if (obj.x < -40 || obj.x > ARENA_WIDTH + 40 || obj.y < -40 || obj.y > ARENA_HEIGHT + 40) obj.destroy();
    return true;
  });
}

function ensureProjectileMotion(group: Phaser.Physics.Arcade.Group): void {
  group.children.each((child) => {
    const projectile = child as Phaser.Physics.Arcade.Image;
    const body = projectile.body as Phaser.Physics.Arcade.Body;
    const lastX = projectile.getData("lastX") as number;
    const lastY = projectile.getData("lastY") as number;
    if (Math.abs(projectile.x - lastX) < 0.01 && Math.abs(projectile.y - lastY) < 0.01) {
      body.setVelocity(projectile.getData("vx") as number, projectile.getData("vy") as number);
    }
    projectile.setData("lastX", projectile.x);
    projectile.setData("lastY", projectile.y);
    return true;
  });
}
