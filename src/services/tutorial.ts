const TUTORIAL_KEY = "storm_tutorial_seen_v1";

export type TutorialState = {
  seen: boolean;
};

export function readTutorialState(): TutorialState {
  try {
    return {
      seen: localStorage.getItem(TUTORIAL_KEY) === "true",
    };
  } catch {
    return { seen: false };
  }
}

export function markTutorialSeen(seen = true): TutorialState {
  try {
    localStorage.setItem(TUTORIAL_KEY, seen ? "true" : "false");
  } catch {
    // Ignore storage failures.
  }
  return { seen };
}

export function formatTutorialSummary(state: TutorialState): string {
  return state.seen ? "Tutorial hidden" : "Tutorial on startup";
}
