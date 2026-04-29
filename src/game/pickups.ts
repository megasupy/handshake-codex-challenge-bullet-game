import Phaser from "phaser";
import type { PlayerStats } from "./gameTypes";

export type SerializedPickupState = {
  x: number;
  y: number;
  value: number;
  vx: number;
  vy: number;
  scale: number;
};

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

export function restorePickup(
  scene: Phaser.Scene,
  pickups: Phaser.Physics.Arcade.Group,
  state: SerializedPickupState,
): void {
  const pickup = scene.physics.add.image(state.x, state.y, "pickup");
  const body = pickup.body as Phaser.Physics.Arcade.Body;
  body.setCircle(5).setAllowGravity(false).setDrag(260, 260).setVelocity(state.vx, state.vy);
  pickup.setData("value", state.value);
  pickup.setScale(state.scale);
  pickups.add(pickup);
}
