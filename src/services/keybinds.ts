const KEYBINDS_KEY = "storm_keybinds_v1";

export type KeybindAction = "moveUp" | "moveDown" | "moveLeft" | "moveRight" | "dash";

export type KeybindState = Record<KeybindAction, string>;

export const DEFAULT_KEYBINDS: KeybindState = {
  moveUp: "UP",
  moveDown: "DOWN",
  moveLeft: "LEFT",
  moveRight: "RIGHT",
  dash: "SHIFT",
};

export function readKeybinds(): KeybindState {
  try {
    const raw = localStorage.getItem(KEYBINDS_KEY);
    if (!raw) return { ...DEFAULT_KEYBINDS };
    const parsed = JSON.parse(raw) as Partial<KeybindState>;
    return normalizeKeybinds(parsed);
  } catch {
    return { ...DEFAULT_KEYBINDS };
  }
}

export function writeKeybinds(state: KeybindState): void {
  try {
    localStorage.setItem(KEYBINDS_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
}

export function updateKeybind(action: KeybindAction, key: string): KeybindState {
  const next = normalizeKeybinds({ ...readKeybinds(), [action]: normalizeKeyName(key) });
  writeKeybinds(next);
  return next;
}

export function resetKeybinds(): KeybindState {
  writeKeybinds(DEFAULT_KEYBINDS);
  return { ...DEFAULT_KEYBINDS };
}

export function formatKeybindSummary(state: KeybindState): string {
  return `Move ${state.moveUp}/${state.moveDown}/${state.moveLeft}/${state.moveRight} · Dash ${state.dash}`;
}

export function normalizeKeyName(name: string): string {
  if (name === " ") return "SPACE";
  const cleaned = name.trim();
  if (!cleaned) return "";
  const normalized = cleaned.replace(/\s+/g, "").toUpperCase();
  if (normalized === "ARROWUP") return "UP";
  if (normalized === "ARROWDOWN") return "DOWN";
  if (normalized === "ARROWLEFT") return "LEFT";
  if (normalized === "ARROWRIGHT") return "RIGHT";
  if (normalized === "ESCAPE") return "ESC";
  if (normalized === "CONTROLLEFT" || normalized === "CONTROLRIGHT") return "CTRL";
  if (normalized === "METALEFT" || normalized === "METARIGHT") return "META";
  if (normalized === "SHIFTLEFT" || normalized === "SHIFTRIGHT") return "SHIFT";
  if (normalized === "ALTLEFT" || normalized === "ALTRIGHT") return "ALT";
  if (normalized === "SPACEBAR") return "SPACE";
  if (normalized.length === 1) return normalized;
  return normalized;
}

function normalizeKeybinds(input: Partial<KeybindState>): KeybindState {
  return {
    moveUp: normalizeKeyName(input.moveUp || DEFAULT_KEYBINDS.moveUp) || DEFAULT_KEYBINDS.moveUp,
    moveDown: normalizeKeyName(input.moveDown || DEFAULT_KEYBINDS.moveDown) || DEFAULT_KEYBINDS.moveDown,
    moveLeft: normalizeKeyName(input.moveLeft || DEFAULT_KEYBINDS.moveLeft) || DEFAULT_KEYBINDS.moveLeft,
    moveRight: normalizeKeyName(input.moveRight || DEFAULT_KEYBINDS.moveRight) || DEFAULT_KEYBINDS.moveRight,
    dash: normalizeKeyName(input.dash || DEFAULT_KEYBINDS.dash) || DEFAULT_KEYBINDS.dash,
  };
}
