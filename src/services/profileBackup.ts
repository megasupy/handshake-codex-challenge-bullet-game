import type { GameMode, RunRecord } from "../types";
import type { CheckpointState } from "./checkpoint";
import { clearCheckpoint, writeCheckpoint } from "./checkpoint";
import { readPinnedRunIds, readRuns, saveName, writePinnedRunIds, writeRuns } from "./localRuns";
import { readPreferences, writePreferences, type PreferencesState } from "./preferences";
import { readSelectedSettingsPreset, writeSelectedSettingsPreset, type SettingsPresetId } from "./settingsPresets";
import { readProgression, writeProgression, type ProgressionState } from "./progression";
import { readRecords, writeRecords, type RecordsState } from "./records";
import { readAchievements, writeAchievements, type AchievementState } from "./achievements";
import { readTelemetryArchive, replaceTelemetryArchive, type TelemetryArchiveEntry } from "./telemetryArchive";
import { markTutorialSeen, readTutorialState, type TutorialState } from "./tutorial";
import { readKeybinds, resetKeybinds, type KeybindState, writeKeybinds } from "./keybinds";

const BACKUP_VERSION = 1;
const RUN_SEARCH_KEY = "storm_run_search_v1";
const RUN_TAG_FILTER_KEY = "storm_run_tag_filter_v1";
const RUN_COMPARE_KEY = "storm_run_compare_v1";
const RUN_SORT_KEY = "storm_run_sort_v1";
const TELEMETRY_FILTER_KEY = "storm_telemetry_filter_v1";
const LEADERBOARD_MODE_KEY = "storm_leaderboard_mode_v1";

export type ProfileBackup = {
  version: number;
  savedAt: string;
  playerName: string;
  progression: ProgressionState;
  preferences: PreferencesState;
  settingsPreset: SettingsPresetId;
  records: RecordsState;
  achievements: AchievementState;
  tutorial: TutorialState;
  keybinds: KeybindState;
  runs: RunRecord[];
  pinnedRunIds: string[];
  telemetryArchive: TelemetryArchiveEntry[];
  uiState?: {
    runSearch?: string;
    runTagFilter?: string;
    runCompare?: string;
    runSort?: string;
    telemetryFilter?: string;
    leaderboardMode?: GameMode;
  };
  checkpoint: CheckpointState | null;
};

export function exportProfileBackup(): ProfileBackup {
  return {
    version: BACKUP_VERSION,
    savedAt: new Date().toISOString(),
    playerName: localStorage.getItem("storm_player_name_v1") || "",
    progression: readProgression(),
    preferences: readPreferences(),
    settingsPreset: readSelectedSettingsPreset(),
    records: readRecords(),
    achievements: readAchievements(),
    tutorial: readTutorialState(),
    keybinds: readKeybinds(),
    runs: readRuns(),
    pinnedRunIds: readPinnedRunIds(),
    telemetryArchive: readTelemetryArchive(),
    uiState: {
      runSearch: localStorage.getItem(RUN_SEARCH_KEY) || "",
      runTagFilter: localStorage.getItem(RUN_TAG_FILTER_KEY) || "",
      runCompare: localStorage.getItem(RUN_COMPARE_KEY) || "",
      runSort: localStorage.getItem(RUN_SORT_KEY) || "best",
      telemetryFilter: localStorage.getItem(TELEMETRY_FILTER_KEY) || "",
      leaderboardMode: normalizeLeaderboardMode(localStorage.getItem(LEADERBOARD_MODE_KEY)),
    },
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
    if (parsed.settingsPreset) writeSelectedSettingsPreset(parsed.settingsPreset);
    if (parsed.records) writeRecords(parsed.records);
    if (parsed.achievements) writeAchievements(parsed.achievements);
    if (parsed.tutorial) markTutorialSeen(parsed.tutorial.seen);
    if (parsed.keybinds) writeKeybinds(parsed.keybinds);
    else resetKeybinds();
    if (Array.isArray(parsed.runs)) writeRuns(parsed.runs);
    if (Array.isArray(parsed.pinnedRunIds)) writePinnedRunIds(parsed.pinnedRunIds.map((id) => String(id)));
    if (Array.isArray(parsed.telemetryArchive)) replaceTelemetryArchive(parsed.telemetryArchive);
    if (parsed.uiState) {
      if (parsed.uiState.runSearch !== undefined) setTextState(RUN_SEARCH_KEY, parsed.uiState.runSearch);
      if (parsed.uiState.runTagFilter !== undefined) setTextState(RUN_TAG_FILTER_KEY, parsed.uiState.runTagFilter);
      if (parsed.uiState.runCompare !== undefined) setTextState(RUN_COMPARE_KEY, parsed.uiState.runCompare);
      if (parsed.uiState.runSort !== undefined) setTextState(RUN_SORT_KEY, parsed.uiState.runSort);
      if (parsed.uiState.telemetryFilter !== undefined) setTextState(TELEMETRY_FILTER_KEY, parsed.uiState.telemetryFilter);
      if (parsed.uiState.leaderboardMode !== undefined) setTextState(LEADERBOARD_MODE_KEY, normalizeLeaderboardMode(parsed.uiState.leaderboardMode));
    }
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

function setTextState(key: string, value: string): void {
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

function normalizeLeaderboardMode(mode: string | null | undefined): GameMode {
  return mode === "daily" || mode === "campaign" ? mode : "endless";
}
