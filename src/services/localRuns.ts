import type { GameMode, RunRecord } from "../types";

const RUNS_KEY = "storm_runs_v1";
const NAME_KEY = "storm_player_name_v1";

export function readRuns(): RunRecord[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    return raw ? (JSON.parse(raw) as RunRecord[]) : [];
  } catch {
    return [];
  }
}

export function writeRuns(runs: RunRecord[]): void {
  localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, 100)));
}

export function saveLocalRun(run: RunRecord): void {
  const runs = readRuns().filter((existing) => existing.id !== run.id);
  runs.unshift(run);
  writeRuns(sortRuns(runs));
}

export function markRunSynced(id: string): void {
  writeRuns(readRuns().map((run) => (run.id === id ? { ...run, synced: true } : run)));
}

export function getPendingRuns(): RunRecord[] {
  return readRuns().filter((run) => !run.synced);
}

export function getLocalLeaderboard(mode?: GameMode): RunRecord[] {
  const rows = mode ? readRuns().filter((run) => run.mode === mode) : readRuns();
  return sortRuns(rows).slice(0, 10);
}

export function getSavedName(): string {
  return localStorage.getItem(NAME_KEY) || "";
}

export function saveName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

export function sortRuns(runs: RunRecord[]): RunRecord[] {
  return [...runs].sort((a, b) => {
    if (b.survivalMs !== a.survivalMs) return b.survivalMs - a.survivalMs;
    if (b.score !== a.score) return b.score - a.score;
    return b.kills - a.kills;
  });
}
