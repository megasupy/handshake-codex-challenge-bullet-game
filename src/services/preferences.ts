const PREFERENCES_KEY = "storm_preferences_v1";

export type PreferencesState = {
  version: 1;
  soundVolume: number;
  screenShake: boolean;
  screenShakeStrength: number;
  reducedMotion: boolean;
  highContrast: boolean;
  combatText: boolean;
};

function defaultPreferences(): PreferencesState {
  return {
    version: 1,
    soundVolume: 1,
    screenShake: true,
    screenShakeStrength: 1,
    reducedMotion: false,
    highContrast: false,
    combatText: true,
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
    state.screenShake ? `Strength ${state.screenShakeStrength.toFixed(1)}x` : "No shake",
    state.reducedMotion ? "Reduced motion" : "Full motion",
    state.highContrast ? "High contrast" : "Standard colors",
    state.combatText ? "Combat text on" : "Combat text off",
  ];
  return parts.join(" · ");
}

function normalizePreferences(input: Partial<PreferencesState>): PreferencesState {
  const base = defaultPreferences();
  return {
    version: 1,
    soundVolume: clamp01(input.soundVolume ?? base.soundVolume),
    screenShake: input.screenShake ?? base.screenShake,
    screenShakeStrength: clampRange(input.screenShakeStrength ?? base.screenShakeStrength, 0.25, 2),
    reducedMotion: input.reducedMotion ?? base.reducedMotion,
    highContrast: input.highContrast ?? base.highContrast,
    combatText: input.combatText ?? base.combatText,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function clampRange(value: number, min: number, max: number): number {
  const normalized = Number.isFinite(value) ? value : 1;
  return Math.max(min, Math.min(max, normalized));
}
