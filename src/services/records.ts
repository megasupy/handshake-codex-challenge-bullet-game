import type { RunSummary } from "../types";

const RECORDS_KEY = "storm_records_v1";

export type RecordsState = {
  bestScore: number;
  bestSurvivalMs: number;
  bestKills: number;
  bestThreat: number;
  bestAccuracy: number;
  bestBosses: number;
  updatedAt: string | null;
};

export const DEFAULT_RECORDS: RecordsState = {
  bestScore: 0,
  bestSurvivalMs: 0,
  bestKills: 0,
  bestThreat: 0,
  bestAccuracy: 0,
  bestBosses: 0,
  updatedAt: null,
};

export function readRecords(): RecordsState {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (!raw) return { ...DEFAULT_RECORDS };
    return normalize(JSON.parse(raw) as Partial<RecordsState>);
  } catch {
    return { ...DEFAULT_RECORDS };
  }
}

export function writeRecords(state: RecordsState): void {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
}

export function updateRecords(run: RunSummary): RecordsState {
  const current = readRecords();
  const next: RecordsState = {
    bestScore: Math.max(current.bestScore, run.score),
    bestSurvivalMs: Math.max(current.bestSurvivalMs, run.survivalMs),
    bestKills: Math.max(current.bestKills, run.kills),
    bestThreat: Math.max(current.bestThreat, run.maxThreatLevel),
    bestAccuracy: Math.max(current.bestAccuracy, run.shotAccuracy ?? 0),
    bestBosses: Math.max(current.bestBosses, run.bossesDefeated ?? 0),
    updatedAt: new Date().toISOString(),
  };
  writeRecords(next);
  return next;
}

export function formatRecordsSummary(state: RecordsState): string {
  return `Best score ${state.bestScore.toLocaleString()} · Survival ${(state.bestSurvivalMs / 1000).toFixed(1)}s · Kills ${state.bestKills}`;
}

function normalize(input: Partial<RecordsState>): RecordsState {
  return {
    bestScore: Number(input.bestScore || 0),
    bestSurvivalMs: Number(input.bestSurvivalMs || 0),
    bestKills: Number(input.bestKills || 0),
    bestThreat: Number(input.bestThreat || 0),
    bestAccuracy: Number(input.bestAccuracy || 0),
    bestBosses: Number(input.bestBosses || 0),
    updatedAt: input.updatedAt || null,
  };
}
