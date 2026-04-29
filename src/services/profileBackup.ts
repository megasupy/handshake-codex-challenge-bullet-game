import type { RunRecord } from "../types";
import type { CheckpointState } from "./checkpoint";
import { clearCheckpoint, writeCheckpoint } from "./checkpoint";
import { readRuns, saveName, writeRuns } from "./localRuns";
import { readPreferences, writePreferences, type PreferencesState } from "./preferences";
import { readProgression, writeProgression, type ProgressionState } from "./progression";
import { readTelemetryArchive, replaceTelemetryArchive, type TelemetryArchiveEntry } from "./telemetryArchive";
import { markTutorialSeen, readTutorialState, type TutorialState } from "./tutorial";
import { readKeybinds, resetKeybinds, type KeybindState, writeKeybinds } from "./keybinds";

const BACKUP_VERSION = 1;

export type ProfileBackup = {
  version: number;
  savedAt: string;
  playerName: string;
  progression: ProgressionState;
  preferences: PreferencesState;
  tutorial: TutorialState;
  keybinds: KeybindState;
  runs: RunRecord[];
  telemetryArchive: TelemetryArchiveEntry[];
  checkpoint: CheckpointState | null;
};

export function exportProfileBackup(): ProfileBackup {
  return {
    version: BACKUP_VERSION,
    savedAt: new Date().toISOString(),
    playerName: localStorage.getItem("storm_player_name_v1") || "",
    progression: readProgression(),
    preferences: readPreferences(),
    tutorial: readTutorialState(),
    keybinds: readKeybinds(),
    runs: readRuns(),
    telemetryArchive: readTelemetryArchive(),
    checkpoint: readCheckpointSafe(),
  };
}

export function importProfileBackup(raw: string): { ok: boolean; error?: string } {
  try {
    const parsed = JSON.parse(raw) as Partial<ProfileBackup>;
    if (parsed.version !== BACKUP_VERSION) {
      return { ok: false, error: "Unsupported backup version." };
    }

    if (parsed.playerName !== undefined) saveName(String(parsed.playerName));
    if (parsed.progression) writeProgression(parsed.progression);
    if (parsed.preferences) writePreferences(parsed.preferences);
    if (parsed.tutorial) markTutorialSeen(parsed.tutorial.seen);
    if (parsed.keybinds) writeKeybinds(parsed.keybinds);
    else resetKeybinds();
    if (Array.isArray(parsed.runs)) writeRuns(parsed.runs);
    if (Array.isArray(parsed.telemetryArchive)) replaceTelemetryArchive(parsed.telemetryArchive);
    if (parsed.checkpoint === null) clearCheckpoint();
    else if (parsed.checkpoint) writeCheckpoint(parsed.checkpoint);

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid backup JSON." };
  }
}

function readCheckpointSafe(): CheckpointState | null {
  try {
    const raw = localStorage.getItem("storm_checkpoint_v1");
    return raw ? (JSON.parse(raw) as CheckpointState) : null;
  } catch {
    return null;
  }
}
