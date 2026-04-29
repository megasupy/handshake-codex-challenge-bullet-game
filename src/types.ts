export type GameMode = "endless" | "daily";

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
};

export type LeaderboardResult = {
  rows: RunRecord[];
  source: "remote" | "local";
  error?: string;
};

export type RunSummary = Omit<RunRecord, "id" | "playerName" | "createdAt" | "synced">;
