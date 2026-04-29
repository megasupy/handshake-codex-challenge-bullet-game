import { readPreferences } from "../services/preferences";
import type { EnemyKind } from "./gameTypes";

export type VisualPalette = {
  highContrast: boolean;
  background: string;
  grid: number;
  arenaBorder: number;
  player: number;
  playerStroke: number;
  dashActive: number;
  dashReady: number;
  dashCooldown: number;
  playerShot: number;
  playerShotInner: number;
  pickup: number;
  enemyBullet: number;
  enemyBulletInner: number;
  enemyKinds: Record<EnemyKind, number>;
  bossPhases: Record<1 | 2 | 3, [number, number, number]>;
  enemyFlash: number;
  hitSpark: number;
  dashTrail: number;
};

export function getVisualPalette(): VisualPalette {
  return buildVisualPalette(readPreferences().highContrast);
}

export function buildVisualPalette(highContrast: boolean): VisualPalette {
  if (highContrast) {
    return {
      highContrast: true,
      background: "#02040a",
      grid: 0x4b5563,
      arenaBorder: 0xf8fafc,
      player: 0x22d3ee,
      playerStroke: 0xf8fafc,
      dashActive: 0xfacc15,
      dashReady: 0xf59e0b,
      dashCooldown: 0x64748b,
      playerShot: 0xfacc15,
      playerShotInner: 0xf8fafc,
      pickup: 0x22c55e,
      enemyBullet: 0xfb7185,
      enemyBulletInner: 0xf8fafc,
      enemyKinds: {
        chaser: 0x38bdf8,
        shooter: 0xa78bfa,
        spinner: 0xf59e0b,
        bomber: 0x2dd4bf,
        strafer: 0xf97316,
        mine: 0xeab308,
        sniper: 0xa3e635,
        summoner: 0xf472b6,
        minion: 0x60a5fa,
      },
      bossPhases: {
        1: [0xef4444, 0xf97316, 0xfacc15],
        2: [0x8b5cf6, 0x22d3ee, 0x38bdf8],
        3: [0x0ea5e9, 0x14b8a6, 0x2dd4bf],
      },
      enemyFlash: 0xffffff,
      hitSpark: 0xfda4af,
      dashTrail: 0x67e8f9,
    };
  }

  return {
    highContrast: false,
    background: "#07090f",
    grid: 0x243044,
    arenaBorder: 0x334155,
    player: 0x5eead4,
    playerStroke: 0xffffff,
    dashActive: 0xfacc15,
    dashReady: 0xfde047,
    dashCooldown: 0x475569,
    playerShot: 0xfacc15,
    playerShotInner: 0xffffff,
    pickup: 0x22c55e,
    enemyBullet: 0xdc2626,
    enemyBulletInner: 0xffffff,
    enemyKinds: {
      chaser: 0x60a5fa,
      shooter: 0xa78bfa,
      spinner: 0xf59e0b,
      bomber: 0x22d3ee,
      strafer: 0xf97316,
      mine: 0xeab308,
      sniper: 0x84cc16,
      summoner: 0xf472b6,
      minion: 0x60a5fa,
    },
    bossPhases: {
      1: [0xb91c1c, 0xea580c, 0xdc2626],
      2: [0x9333ea, 0x7c3aed, 0x6d28d9],
      3: [0x0ea5e9, 0x0284c7, 0x0369a1],
    },
    enemyFlash: 0xffffff,
    hitSpark: 0xfb7185,
    dashTrail: 0x5eead4,
  };
}
