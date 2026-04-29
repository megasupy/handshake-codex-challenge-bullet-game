import Phaser from "phaser";
import { ARENA_WIDTH } from "./constants";
import type { DebugSettings } from "./events";
import { enemyDeathBurst } from "./effects";
import { fireEnemyBullet } from "./projectiles";

export const FIRST_BOSS_AT_MS = 60000;
export const SECOND_BOSS_AT_MS = 120000;
export const BOSS_RESPAWN_DELAY_MS = 60000;

type Phase = 1 | 2 | 3;

export class Boss1Controller {
  readonly name = "The Red Vector";
  readonly maxHp: number;
  hp: number;
  phase: Phase = 1;
  x = ARENA_WIDTH / 2;
  y = 132;

  private readonly bornAt: number;
  private readonly phaseDamageRequired: number[];
  private phaseDamage = 0;
  private attackAt = 0;
  private hitFlashUntil = 0;
  private attackIndex = 0;
  private view: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene, elapsedMs: number, threat: number) {
    this.bornAt = elapsedMs;
    this.maxHp = 450 + threat * 25;
    this.hp = this.maxHp;
    this.phaseDamageRequired = [this.maxHp * 0.22, this.maxHp * 0.28, this.maxHp * 0.5];
    this.attackAt = elapsedMs + 900;
    this.view = scene.add.graphics();
    this.redraw(elapsedMs);
  }

  update(elapsedMs: number, player: Phaser.GameObjects.Shape, enemyBullets: Phaser.Physics.Arcade.Group, debug: DebugSettings) {
    const t = (elapsedMs - this.bornAt) / 1000;
    const lane = this.phase === 1 ? 80 : this.phase === 2 ? 120 : 150;
    const motion = this.phase === 1 ? 0.18 : this.phase === 2 ? 0.24 : 0.3;
    this.x = Phaser.Math.Clamp(ARENA_WIDTH / 2 + Math.sin(t * motion) * lane, 120, ARENA_WIDTH - 120);
    this.y = 122 + Math.cos(t * (motion + 0.06)) * 12;
    this.redraw(elapsedMs);

    if (elapsedMs < this.attackAt) return;
    this.firePattern(player, enemyBullets, debug, t);
    this.attackIndex += 1;
    this.attackAt = elapsedMs + this.getAttackCooldownMs();
  }

  hitByShot(shot: Phaser.Physics.Arcade.Image, elapsedMs: number): { hit: boolean; defeated: boolean; phaseChanged: boolean } {
    const radius = 44;
    const sx = shot.x as number;
    const sy = shot.y as number;
    const lx = (shot.getData("lastX") as number | undefined) ?? sx;
    const ly = (shot.getData("lastY") as number | undefined) ?? sy;
    if (!segmentCircleHit(lx, ly, sx, sy, this.x, this.y, radius)) return { hit: false, defeated: false, phaseChanged: false };

    const damage = (shot.getData("damage") as number) || 1;
    const pierce = (shot.getData("pierce") as number) || 0;
    if (pierce > 0) shot.setData("pierce", pierce - 1);
    else shot.destroy();

    const phaseRequirement = this.phaseDamageRequired[this.phase - 1];
    const remaining = Math.max(0, phaseRequirement - this.phaseDamage);
    const applied = this.phase < 3 ? Math.min(damage, remaining) : damage;

    this.hp = Math.max(0, this.hp - applied);
    this.phaseDamage += applied;
    this.hitFlashUntil = elapsedMs + 50;

    if (this.phase < 3 && this.phaseDamage >= phaseRequirement) {
      this.phase = (this.phase + 1) as Phase;
      this.phaseDamage = 0;
      return { hit: true, defeated: false, phaseChanged: true };
    }

    return { hit: true, defeated: this.hp <= 0, phaseChanged: false };
  }

  overlapsPlayer(playerX: number, playerY: number, playerRadius: number): boolean {
    const bossRadius = 44;
    const minDist = bossRadius + playerRadius;
    return Phaser.Math.Distance.Squared(this.x, this.y, playerX, playerY) <= minDist * minDist;
  }

  destroy() {
    enemyDeathBurst(this.scene, this.x, this.y, 0xef4444);
    this.view.destroy();
  }

  private firePattern(player: Phaser.GameObjects.Shape, enemyBullets: Phaser.Physics.Arcade.Group, debug: DebugSettings, t: number) {
    const base = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    const orbit = t * 1.1;
    const emitters = [
      { x: this.x + Math.cos(orbit) * 52, y: this.y + Math.sin(orbit) * 52 },
      { x: this.x + Math.cos(orbit + Math.PI) * 52, y: this.y + Math.sin(orbit + Math.PI) * 52 },
    ];

    if (this.phase === 1) {
      for (const offset of [-0.36, -0.2, -0.08, 0.08, 0.2, 0.36]) {
        fireEnemyBullet(this.scene, enemyBullets, this.x, this.y, base + offset, 118, debug);
      }
      const ring = 14;
      const spin = t * 0.95 + (this.attackIndex % 2 === 0 ? 0 : Math.PI / ring);
      for (let i = 0; i < ring; i += 1) {
        const e = emitters[i % 2];
        fireEnemyBullet(this.scene, enemyBullets, e.x, e.y, spin + (Math.PI * 2 * i) / ring, 104 + (i % 3) * 7, debug);
      }
      return;
    }

    if (this.phase === 2) {
      const dualSpiralCount = 10;
      const spin = t * 1.35;
      for (let i = 0; i < dualSpiralCount; i += 1) {
        fireEnemyBullet(this.scene, enemyBullets, emitters[0].x, emitters[0].y, spin + (Math.PI * 2 * i) / dualSpiralCount, 114 + i * 2, debug);
        fireEnemyBullet(this.scene, enemyBullets, emitters[1].x, emitters[1].y, -spin + (Math.PI * 2 * i) / dualSpiralCount, 114 + i * 2, debug);
      }
      const fan = 7;
      const fanStep = 0.12;
      const fanStart = -((fan - 1) * fanStep) / 2;
      for (let i = 0; i < fan; i += 1) {
        fireEnemyBullet(this.scene, enemyBullets, this.x, this.y, base + fanStart + i * fanStep, 136 + i * 3, debug);
      }
      return;
    }

    const barrage = 16;
    const sweep = t * 0.8;
    for (let i = 0; i < barrage; i += 1) {
      fireEnemyBullet(this.scene, enemyBullets, emitters[0].x, emitters[0].y, sweep + (Math.PI * 2 * i) / barrage, 132 + (i % 4) * 8, debug);
      fireEnemyBullet(this.scene, enemyBullets, emitters[1].x, emitters[1].y, -sweep + (Math.PI * 2 * i) / barrage, 132 + (i % 4) * 8, debug);
    }
    const lanes = 9;
    for (let i = 0; i < lanes; i += 1) {
      const offset = (i - (lanes - 1) / 2) * 0.1;
      fireEnemyBullet(this.scene, enemyBullets, this.x, this.y, base + offset, 158 + i * 3, debug);
    }
    if (this.attackIndex % 2 === 0) {
      const wall = 12;
      for (let i = 0; i < wall; i += 1) {
        fireEnemyBullet(this.scene, enemyBullets, this.x, this.y, (Math.PI * 2 * i) / wall + t * 0.45, 124, debug);
      }
    }
  }

  private getAttackCooldownMs(): number {
    if (this.phase === 1) return 900;
    if (this.phase === 2) return 680;
    return 520;
  }

  private redraw(elapsedMs: number) {
    const flash = elapsedMs < this.hitFlashUntil;
    const color = flash ? 0xffffff : this.phase === 1 ? 0xb91c1c : this.phase === 2 ? 0xea580c : 0xdc2626;
    const size = flash ? 98 : 92;
    this.view.clear();
    this.view.lineStyle(4, 0xffffff, 0.92);
    this.view.fillStyle(color, 1);
    this.view.fillRect(this.x - size / 2, this.y - size / 2, size, size);
    this.view.lineBetween(this.x - 24, this.y, this.x + 24, this.y);
    this.view.lineBetween(this.x, this.y - 24, this.x, this.y + 24);
  }
}

function segmentCircleHit(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, r: number): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const segLenSq = dx * dx + dy * dy;
  if (segLenSq < 0.0001) return Phaser.Math.Distance.Squared(x1, y1, cx, cy) <= r * r;
  const t = Phaser.Math.Clamp(((cx - x1) * dx + (cy - y1) * dy) / segLenSq, 0, 1);
  const nx = x1 + dx * t;
  const ny = y1 + dy * t;
  return Phaser.Math.Distance.Squared(nx, ny, cx, cy) <= r * r;
}
