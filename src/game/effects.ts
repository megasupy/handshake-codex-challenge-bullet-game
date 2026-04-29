import Phaser from "phaser";

type FillShape = Phaser.GameObjects.Shape & { fillColor?: number; setFillStyle: (color: number, alpha?: number) => unknown };
type BossRenderable = Phaser.GameObjects.Shape | Phaser.Physics.Arcade.Image;

export function flashEnemy(scene: Phaser.Scene, enemy: FillShape): void {
  const original = enemy.getData("color") as number | undefined;
  enemy.setFillStyle(0xffffff);
  scene.time.delayedCall(45, () => {
    if (enemy.active && original !== undefined) enemy.setFillStyle(original);
  });
  scene.tweens.add({ targets: enemy, scale: 1.18, duration: 55, yoyo: true });
}

export function flashBoss(scene: Phaser.Scene, boss: BossRenderable): void {
  const color = boss.getData("color") as number | undefined;
  if (boss instanceof Phaser.Physics.Arcade.Image) {
    boss.setVisible(true);
    boss.setAlpha(1);
    boss.setTint(0xffffff);
    scene.time.delayedCall(35, () => {
      if (!boss.active) return;
      boss.setVisible(true);
      boss.setAlpha(1);
      boss.setTint(color ?? 0xef4444);
    });
    return;
  }

  boss.setVisible(true);
  boss.setAlpha(1);
  (boss as FillShape).setFillStyle(0xffffff, 1);
  scene.time.delayedCall(35, () => {
    if (!boss.active) return;
    boss.setVisible(true);
    boss.setAlpha(1);
    (boss as FillShape).setFillStyle(color ?? 0xef4444, 1);
  });
}

export function enemyDeathBurst(scene: Phaser.Scene, x: number, y: number, color: number): void {
  for (let i = 0; i < 16; i += 1) {
    const angle = (Math.PI * 2 * i) / 16 + Phaser.Math.FloatBetween(-0.16, 0.16);
    const distance = Phaser.Math.Between(28, 74);
    const particle = scene.add.circle(x, y, Phaser.Math.Between(2, 5), color, 0.9);
    scene.tweens.add({
      targets: particle,
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance,
      alpha: 0,
      scale: 0.2,
      duration: Phaser.Math.Between(220, 420),
      ease: "Quad.easeOut",
      onComplete: () => particle.destroy(),
    });
  }
}

export function playerHitBurst(scene: Phaser.Scene, player: Phaser.GameObjects.Shape): void {
  scene.cameras.main.flash(90, 251, 113, 133, false);
  for (let i = 0; i < 12; i += 1) {
    const angle = (Math.PI * 2 * i) / 12;
    const spark = scene.add.circle(player.x, player.y, 3, 0xfb7185, 0.9);
    scene.tweens.add({
      targets: spark,
      x: player.x + Math.cos(angle) * 48,
      y: player.y + Math.sin(angle) * 48,
      alpha: 0,
      duration: 260,
      ease: "Quad.easeOut",
      onComplete: () => spark.destroy(),
    });
  }
}

export function dashTrail(scene: Phaser.Scene, player: Phaser.GameObjects.Shape): void {
  const trail = scene.add.rectangle(player.x, player.y, 26, 26, 0x5eead4, 0.22);
  trail.setRotation(player.rotation);
  scene.tweens.add({
    targets: trail,
    alpha: 0,
    scale: 2.4,
    duration: 180,
    ease: "Quad.easeOut",
    onComplete: () => trail.destroy(),
  });
}

export function pickupPop(scene: Phaser.Scene, pickup: Phaser.Physics.Arcade.Image): void {
  pickup.setScale(0.45);
  scene.tweens.add({
    targets: pickup,
    scale: 1.25,
    duration: 120,
    yoyo: true,
    ease: "Back.easeOut",
  });
}

export function pickupCollectBurst(scene: Phaser.Scene, x: number, y: number): void {
  const ring = scene.add.circle(x, y, 5, 0x22c55e, 0);
  ring.setStrokeStyle(2, 0x22c55e, 0.8);
  scene.tweens.add({
    targets: ring,
    scale: 4,
    alpha: 0,
    duration: 180,
    ease: "Quad.easeOut",
    onComplete: () => ring.destroy(),
  });
}

export function upgradePulse(scene: Phaser.Scene, player: Phaser.GameObjects.Shape): void {
  const ring = scene.add.circle(player.x, player.y, 18, 0x5eead4, 0);
  ring.setStrokeStyle(3, 0x5eead4, 0.9);
  scene.tweens.add({
    targets: ring,
    scale: 7,
    alpha: 0,
    duration: 420,
    ease: "Cubic.easeOut",
    onComplete: () => ring.destroy(),
  });
}
