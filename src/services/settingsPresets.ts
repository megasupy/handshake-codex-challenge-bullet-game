import { updatePreferences, type PreferencesState } from "./preferences";

const PRESET_KEY = "storm_settings_preset_v1";

export type SettingsPresetId = "balanced" | "focus" | "silent" | "full-juice" | "custom";

export type SettingsPreset = {
  id: Exclude<SettingsPresetId, "custom">;
  title: string;
  description: string;
  settings: Partial<PreferencesState>;
};

export const SETTINGS_PRESETS: SettingsPreset[] = [
  {
    id: "balanced",
    title: "Balanced",
    description: "Comfortable defaults for normal play.",
    settings: { soundVolume: 1, screenShake: true, reducedMotion: false },
  },
  {
    id: "focus",
    title: "Focus",
    description: "Lower noise and reduced motion.",
    settings: { soundVolume: 0.7, screenShake: false, reducedMotion: true },
  },
  {
    id: "silent",
    title: "Silent",
    description: "Muted with minimal motion.",
    settings: { soundVolume: 0, screenShake: false, reducedMotion: true },
  },
  {
    id: "full-juice",
    title: "Full Juice",
    description: "Loud and energetic presentation.",
    settings: { soundVolume: 1, screenShake: true, reducedMotion: false },
  },
];

export function readSelectedSettingsPreset(): SettingsPresetId {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return "custom";
    return normalizePresetId(raw as SettingsPresetId);
  } catch {
    return "custom";
  }
}

export function writeSelectedSettingsPreset(id: SettingsPresetId): void {
  try {
    localStorage.setItem(PRESET_KEY, id);
  } catch {
    // Ignore storage failures.
  }
}

export function applySettingsPreset(id: Exclude<SettingsPresetId, "custom">): PreferencesState {
  const preset = SETTINGS_PRESETS.find((entry) => entry.id === id);
  if (!preset) return updatePreferences({});
  const next = updatePreferences(preset.settings);
  writeSelectedSettingsPreset(id);
  return next;
}

export function formatSettingsPresetSummary(id: SettingsPresetId, preferences: PreferencesState): string {
  if (id === "custom") {
    return `Custom · Sound ${Math.round(preferences.soundVolume * 100)}% · ${preferences.screenShake ? "Shake on" : "Shake off"} · ${preferences.reducedMotion ? "Reduced motion" : "Full motion"}`;
  }

  const preset = SETTINGS_PRESETS.find((entry) => entry.id === id);
  if (!preset) return "Custom";
  return `${preset.title} · ${preset.description}`;
}

function normalizePresetId(id: string): SettingsPresetId {
  return SETTINGS_PRESETS.some((entry) => entry.id === id) ? (id as Exclude<SettingsPresetId, "custom">) : "custom";
}
