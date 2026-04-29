import type { GameMode, RunRecord } from "../types";

const RUNS_KEY = "storm_runs_v1";
const NAME_KEY = "storm_player_name_v1";
const PINNED_KEY = "storm_pinned_runs_v1";

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

export function updateRunNote(id: string, note: string): boolean {
  const cleanNote = normalizeNote(note);
  let updated = false;
  const runs = readRuns().map((run) => {
    if (run.id !== id) return run;
    updated = true;
    return cleanNote ? { ...run, note: cleanNote } : removeRunNote(run);
  });

  if (!updated) return false;
  writeRuns(sortRuns(runs));
  return true;
}

export function updateRunTags(id: string, tags: string[]): boolean {
  const cleanTags = normalizeTags(tags);
  let updated = false;
  const runs = readRuns().map((run) => {
    if (run.id !== id) return run;
    updated = true;
    return cleanTags.length > 0 ? { ...run, tags: cleanTags } : removeRunTags(run);
  });

  if (!updated) return false;
  writeRuns(sortRuns(runs));
  return true;
}

export function removeRun(id: string): void {
  writeRuns(readRuns().filter((run) => run.id !== id));
  writePinnedRunIds(readPinnedRunIds().filter((runId) => runId !== id));
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

export function readPinnedRunIds(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    const values = raw ? (JSON.parse(raw) as unknown[]) : [];
    return values.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export function isRunPinned(id: string): boolean {
  return readPinnedRunIds().includes(id);
}

export function toggleRunPinned(id: string): boolean {
  const current = readPinnedRunIds();
  const next = current.includes(id) ? current.filter((value) => value !== id) : [id, ...current];
  writePinnedRunIds(next);
  return next.includes(id);
}

export function writePinnedRunIds(ids: string[]): void {
  localStorage.setItem(PINNED_KEY, JSON.stringify(Array.from(new Set(ids)).slice(0, 100)));
}

export function getSavedName(): string {
  return localStorage.getItem(NAME_KEY) || "";
}

export function saveName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

export function sortRuns(runs: RunRecord[]): RunRecord[] {
  return [...runs].sort((a, b) => {
    return compareRuns(a, b);
  });
}

export function sortRunsWithPinned(runs: RunRecord[]): RunRecord[] {
  const pinned = new Set(readPinnedRunIds());
  return [...runs].sort((a, b) => {
    const aPinned = pinned.has(a.id);
    const bPinned = pinned.has(b.id);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return compareRuns(a, b);
  });
}

function compareRuns(a: RunRecord, b: RunRecord): number {
  if (b.survivalMs !== a.survivalMs) return b.survivalMs - a.survivalMs;
  if (b.score !== a.score) return b.score - a.score;
  return b.kills - a.kills;
}

function normalizeNote(note: string): string {
  return note.trim().slice(0, 500);
}

function removeRunNote(run: RunRecord): RunRecord {
  const { note: _note, ...rest } = run;
  return rest;
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .flatMap((tag) => String(tag).split(","))
        .map((tag) => tag.trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .slice(0, 12),
    ),
  ).slice(0, 12);
}

function removeRunTags(run: RunRecord): RunRecord {
  const { tags: _tags, ...rest } = run;
  return rest;
}
