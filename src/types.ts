export type GameMode = "endless" | "daily" | "boss-rush" | "campaign";

export type RunRecord = {
  id: string;
  playerName: string;
  survivalMs: number;
  score: number;
  kills: number;
  maxThreatLevel: number;
  seed: string;
  mode: GameMode;
  createdAt: string;
  synced: boolean;
  note?: string;
  tags?: string[];
  campaignLevel?: number;
};

export type LeaderboardResult = {
  rows: RunRecord[];
  source: "remote" | "local";
  error?: string;
};

export type RunSummary = Omit<RunRecord, "id" | "playerName" | "createdAt" | "synced"> & {
  playerDamage?: number;
  playerProjectiles?: number;
  playerFireRate?: number;
  playerPierce?: number;
  playerProjectileSpeed?: number;
  shotsFired?: number;
  shotsHit?: number;
  shotAccuracy?: number;
  upgradesTaken?: number;
  bossesDefeated?: number;
  maxHealth?: number;
  speed?: number;
  finalThreat?: number;
  damageTaken?: number;
  damageAttrition?: number;
  damageBurst?: number;
  damageCornered?: number;
  damageBossContact?: number;
  campaignLevel?: number;
  upgradePath?: string[];
  chronology?: string[];
};
