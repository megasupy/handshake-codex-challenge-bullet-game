import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH } from "./constants";
import type { DebugSettings } from "./events";
import { enemyDeathBurst } from "./effects";
import { fireEnemyBullet } from "./projectiles";

export const FIRST_BOSS_AT_MS = 60000;
export const SECOND_BOSS_AT_MS = 120000;
export const THIRD_BOSS_AT_MS = 180000;
export const BOSS_RESPAWN_DELAY_MS = 60000;

type Phase = 1 | 2 | 3;

export class Boss1Controller {
  readonly name: string;
  readonly bossId: 1 | 2 | 3;
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
  private currentPatternId = "idle";

  constructor(private readonly scene: Phaser.Scene, elapsedMs: number, threat: number, bossId: 1 | 2 | 3) {
    this.bornAt = elapsedMs;
    this.bossId = bossId;
    this.name = bossId === 1 ? "Vector Regent" : bossId === 2 ? "Lane Warden" : "Apex Engine";
    const hpBase = bossId === 1 ? 640 : bossId === 2 ? 840 : 1120;
    this.maxHp = hpBase + Math.floor(threat * 33);
    this.hp = this.maxHp;
    this.phaseDamageRequired = [this.maxHp * 0.36, this.maxHp * 0.36, this.maxHp * 0.28];
    this.attackAt = elapsedMs + 850;
    this.view = scene.add.graphics();
    this.redraw(elapsedMs);
  }

  update(elapsedMs: number, player: Phaser.GameObjects.Shape, enemyBullets: Phaser.Physics.Arcade.Group, debug: DebugSettings) {
    const t = (elapsedMs - this.bornAt) / 1000;
    this.updateMovement(t);
    this.redraw(elapsedMs);
    if (elapsedMs < this.attackAt) return;
    this.firePattern(player, enemyBullets, debug, t);
    this.attackIndex += 1;
    this.attackAt = elapsedMs + this.getAttackCooldownMs();
  }

  getPatternId(): string {
    return `b${this.bossId}-p${this.phase}-${this.currentPatternId}`;
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
    const minDist = 44 + playerRadius;
    return Phaser.Math.Distance.Squared(this.x, this.y, playerX, playerY) <= minDist * minDist;
  }

  destroy() {
    enemyDeathBurst(this.scene, this.x, this.y, 0xef4444);
    this.view.destroy();
  }

  private updateMovement(t: number) {
    if (this.bossId === 1) {
      this.x = Phaser.Math.Clamp(ARENA_WIDTH / 2 + Math.sin(t * 0.3) * 96, 130, ARENA_WIDTH - 130);
      this.y = 124 + Math.cos(t * 0.2) * 10;
      return;
    }
    if (this.bossId === 2) {
      const move = this.phase === 1 ? 0 : this.phase === 2 ? 0.12 : 0.08;
      this.x = Phaser.Math.Clamp(ARENA_WIDTH / 2 + Math.sin(t * move) * 70, 140, ARENA_WIDTH - 140);
      this.y = 128;
      return;
    }
    this.x = Phaser.Math.Clamp(ARENA_WIDTH / 2 + Math.sin(t * 0.16) * 54, 150, ARENA_WIDTH - 150);
    this.y = 128 + Math.cos(t * 0.11) * 8;
  }

  private firePattern(player: Phaser.GameObjects.Shape, enemyBullets: Phaser.Physics.Arcade.Group, debug: DebugSettings, t: number) {
    if (this.bossId === 1) this.fireBoss1(player, enemyBullets, debug, t);
    else if (this.bossId === 2) this.fireBoss2(player, enemyBullets, debug, t);
    else this.fireBoss3(player, enemyBullets, debug, t);
  }

  private fireBoss1(player: Phaser.GameObjects.Shape, enemyBullets: Phaser.Physics.Arcade.Group, debug: DebugSettings, t: number) {
    const aim = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    if (this.phase === 1) {
      this.currentPatternId = "aim-fan+ring";
      for (const offset of [-0.28, -0.12, 0, 0.12, 0.28]) fireEnemyBullet(this.scene, enemyBullets, this.x, this.y, aim + offset, 140, debug);
      if (this.attackIndex % 2 === 0) {
        for (let i = 0; i < 10; i += 1) fireEnemyBullet(this.scene, enemyBullets, this.x, this.y, t * 0.7 + (Math.PI * 2 * i) / 10, 124, debug);
      }
      return;
    }
    if (this.phase === 2) {
      this.currentPatternId = "sweep-arcs";
      const sweep = (this.attackIndex % 4) * 0.16 - 0.24;
      for (let i = 0; i < 8; i += 1) fireEnemyBullet(this.scene, enemyBullets, this.x, this.y, aim + sweep + (i - 3.5) * 0.11, 152 + i * 2, debug);
      return;
    }
    this.currentPatternId = "dual-spiral";
    for (let i = 0; i < 14; i += 1) {
      fireEnemyBullet(this.scene, enemyBullets, this.x - 30, this.y, t * 1.2 + (Math.PI * 2 * i) / 14, 144 + (i % 3) * 6, debug);
      fireEnemyBullet(this.scene, enemyBullets, this.x + 30, this.y, -t * 1.2 + (Math.PI * 2 * i) / 14, 144 + (i % 3) * 6, debug);
    }
  }

  private fireBoss2(player: Phaser.GameObjects.Shape, enemyBullets: Phaser.Physics.Arcade.Group, debug: DebugSettings, t: number) {
    const aim = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    if (this.phase === 1) {
      this.currentPatternId = "lane-walls";
      const gaps = [ARENA_WIDTH * 0.2, ARENA_WIDTH * 0.5, ARENA_WIDTH * 0.8];
      const gap = gaps[this.attackIndex % gaps.length];
      for (let i = 0; i <= 14; i += 1) {
        const x = 30 + i * ((ARENA_WIDTH - 60) / 14);
        if (Math.abs(x - gap) < 70) continue;
        const angle = Phaser.Math.Angle.Between(x, 40, x, ARENA_HEIGHT - 20);
        fireEnemyBullet(this.scene, enemyBullets, x, 40, angle, 146, debug);
      }
      return;
    }
    if (this.phase === 2) {
      this.currentPatternId = "orbiter-bursts";
      const orbit = t * 1.1;
      for (const phaseOffset of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
        const ex = this.x + Math.cos(orbit + phaseOffset) * 92;
        const ey = this.y + Math.sin(orbit + phaseOffset) * 68;
        for (let i = -1; i <= 1; i += 1) fireEnemyBullet(this.scene, enemyBullets, ex, ey, aim + i * 0.14, 156, debug);
      }
      return;
    }
    this.currentPatternId = "box-collapse";
    const inset = 40 + (this.attackIndex % 4) * 22;
    for (let i = 0; i < 10; i += 1) {
      const tx = inset + i * ((ARENA_WIDTH - inset * 2) / 9);
      fireEnemyBullet(this.scene, enemyBullets, tx, 30, Math.PI / 2, 154, debug);
      fireEnemyBullet(this.scene, enemyBullets, tx, ARENA_HEIGHT - 30, -Math.PI / 2, 154, debug);
    }
  }

  private fireBoss3(player: Phaser.GameObjects.Shape, enemyBullets: Phaser.Physics.Arcade.Group, debug: DebugSettings, t: number) {
    const aim = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
    if (this.phase === 1) {
      this.currentPatternId = "precision-lanes";
      for (let i = -3; i <= 3; i += 1) fireEnemyBullet(this.scene, enemyBullets, this.x, this.y, aim + i * 0.09, 172 + Math.abs(i) * 4, debug);
      return;
    }
    if (this.phase === 2) {
      this.currentPatternId = "counter-rotors";
      for (let i = 0; i < 16; i += 1) {
        fireEnemyBullet(this.scene, enemyBullets, this.x - 36, this.y, t * 1.35 + (Math.PI * 2 * i) / 16, 148 + (i % 4) * 8, debug);
        fireEnemyBullet(this.scene, enemyBullets, this.x + 36, this.y, -t * 1.35 + (Math.PI * 2 * i) / 16, 148 + (i % 4) * 8, debug);
      }
      return;
    }
    const cycle = this.attackIndex % 3;
    if (cycle === 0) {
      this.currentPatternId = "ring-compress";
      for (let i = 0; i < 20; i += 1) fireEnemyBullet(this.scene, enemyBullets, this.x, this.y, (Math.PI * 2 * i) / 20, 178, debug);
      return;
    }
    if (cycle === 1) {
      this.currentPatternId = "diag-sweep";
      for (let i = 0; i < 12; i += 1) {
        const x = 30 + i * ((ARENA_WIDTH - 60) / 11);
        fireEnemyBullet(this.scene, enemyBullets, x, 32, Math.PI * 0.63, 164, debug);
      }
      return;
    }
    this.currentPatternId = "gap-chase";
    for (let i = -4; i <= 4; i += 1) fireEnemyBullet(this.scene, enemyBullets, this.x, this.y, aim + i * 0.07, 186, debug);
  }

  private getAttackCooldownMs(): number {
    if (this.bossId === 1) return this.phase === 1 ? 860 : this.phase === 2 ? 680 : 560;
    if (this.bossId === 2) return this.phase === 1 ? 980 : this.phase === 2 ? 760 : 620;
    return this.phase === 1 ? 760 : this.phase === 2 ? 600 : 520;
  }

  private redraw(elapsedMs: number) {
    const flash = elapsedMs < this.hitFlashUntil;
    const color =
      flash ? 0xffffff :
        this.bossId === 1 ? (this.phase === 1 ? 0xb91c1c : this.phase === 2 ? 0xea580c : 0xdc2626) :
          this.bossId === 2 ? (this.phase === 1 ? 0x9333ea : this.phase === 2 ? 0x7c3aed : 0x6d28d9) :
            (this.phase === 1 ? 0x0ea5e9 : this.phase === 2 ? 0x0284c7 : 0x0369a1);
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
