const PREFERENCES_KEY = "storm_preferences_v1";

export type PreferencesState = {
  version: 1;
  soundVolume: number;
  screenShake: boolean;
  reducedMotion: boolean;
};

function defaultPreferences(): PreferencesState {
  return {
    version: 1,
    soundVolume: 1,
    screenShake: true,
    reducedMotion: false,
  };
}

export function readPreferences(): PreferencesState {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return defaultPreferences();
    const parsed = JSON.parse(raw) as Partial<PreferencesState>;
    return normalizePreferences(parsed);
  } catch {
    return defaultPreferences();
  }
}

export function writePreferences(state: PreferencesState): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures; preferences remain in memory for the session.
  }
}

export function updatePreferences(settings: Partial<PreferencesState>): PreferencesState {
  const next = normalizePreferences({ ...readPreferences(), ...settings });
  writePreferences(next);
  return next;
}

export function formatPreferencesSummary(state: PreferencesState): string {
  const parts = [
    `Sound ${Math.round(state.soundVolume * 100)}%`,
    state.screenShake ? "Shake on" : "Shake off",
    state.reducedMotion ? "Reduced motion" : "Full motion",
  ];
  return parts.join(" · ");
}

function normalizePreferences(input: Partial<PreferencesState>): PreferencesState {
  const base = defaultPreferences();
  return {
    version: 1,
    soundVolume: clamp01(input.soundVolume ?? base.soundVolume),
    screenShake: input.screenShake ?? base.screenShake,
    reducedMotion: input.reducedMotion ?? base.reducedMotion,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}
