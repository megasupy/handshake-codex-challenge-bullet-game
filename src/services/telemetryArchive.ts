import type { TelemetryRun } from "../game/telemetry";

const ARCHIVE_KEY = "storm_telemetry_archive_v1";
const MAX_ENTRIES = 5;

export type TelemetryArchiveEntry = {
  runId: string;
  startedAt: string;
  seed: string;
  mode: string;
  summary: Record<string, boolean | number | string | null> | undefined;
  logText: string;
};

export function readTelemetryArchive(): TelemetryArchiveEntry[] {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TelemetryArchiveEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function saveTelemetryRun(run: TelemetryRun): TelemetryArchiveEntry[] {
  if (!run.logText) return readTelemetryArchive();
  const entry: TelemetryArchiveEntry = {
    runId: run.runId,
    startedAt: run.startedAt,
    seed: run.seed,
    mode: run.mode,
    summary: run.summary,
    logText: run.logText,
  };

  const entries = readTelemetryArchive().filter((existing) => existing.runId !== entry.runId);
  entries.unshift(entry);
  writeTelemetryArchive(entries);
  return entries;
}

export function clearTelemetryArchive(): void {
  try {
    localStorage.removeItem(ARCHIVE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function replaceTelemetryArchive(entries: TelemetryArchiveEntry[]): void {
  writeTelemetryArchive(entries);
}

export function formatTelemetryArchiveEntry(entry: TelemetryArchiveEntry): string {
  const lines = entry.logText.split("\n").filter(Boolean).length;
  const survival = toNumber(entry.summary?.survivalMs);
  const score = toNumber(entry.summary?.score);
  const threat = toNumber(entry.summary?.maxThreatLevel);
  const bits = [
    `${entry.mode}`,
    `${new Date(entry.startedAt).toLocaleString()}`,
    `seed ${entry.seed}`,
    `lines ${lines}`,
  ];
  if (survival !== null) bits.push(`${Math.round(survival / 1000)}s`);
  if (score !== null) bits.push(`score ${score.toLocaleString()}`);
  if (threat !== null) bits.push(`threat ${threat}`);
  return bits.join(" · ");
}

function writeTelemetryArchive(entries: TelemetryArchiveEntry[]): void {
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Ignore storage failures.
  }
}

function toNumber(value: boolean | number | string | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
