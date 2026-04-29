import Phaser from "phaser";
import type { DebugSettings } from "./events";

export function applyDebugSettings(current: DebugSettings, settings: Partial<DebugSettings>): DebugSettings {
  const next = { ...current, ...settings };
  if (settings.timeScale !== undefined) {
    next.timeScale = Phaser.Math.Clamp(settings.timeScale, 0.1, 20);
  }
  if (settings.threatOverride !== undefined) {
    next.threatOverride = Math.max(0, Math.floor(settings.threatOverride));
  }
  if (settings.enemyCap !== undefined) {
    next.enemyCap = Phaser.Math.Clamp(Math.floor(settings.enemyCap), 10, 500);
  }
  return next;
}
