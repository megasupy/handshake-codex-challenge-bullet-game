import Phaser from "phaser";
import type { PlayerStats } from "./gameTypes";

export function magnetPickups(pickups: Phaser.Physics.Arcade.Group, player: Phaser.GameObjects.Shape, stats: PlayerStats, physics: Phaser.Physics.Arcade.ArcadePhysics, timeScale: number): void {
  const rangeSq = stats.pickupRange * stats.pickupRange;
  const entries = pickups.children.entries as Phaser.Physics.Arcade.Image[];
  for (const pickup of entries) {
    if (!pickup?.active) continue;
    const dx = player.x - pickup.x;
    const dy = player.y - pickup.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < rangeSq) {
      const distance = Math.sqrt(distanceSq);
      const speed = Phaser.Math.Clamp(520 - distance * 1.8, 260, 520) * timeScale;
      physics.moveToObject(pickup, player, speed);
      pickup.setTint(0x86efac);
    } else {
      pickup.clearTint();
    }
  }
}
