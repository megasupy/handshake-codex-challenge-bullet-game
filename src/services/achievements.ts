import type { RunSummary } from "../types";

const ACHIEVEMENTS_KEY = "storm_achievements_v1";

export type AchievementId =
  | "first_boss"
  | "survive_60"
  | "survive_120"
  | "kills_100"
  | "bosses_3"
  | "accuracy_50"
  | "threat_10"
  | "score_20000";

export type AchievementState = {
  unlocked: Record<AchievementId, string | null>;
};

type AchievementDefinition = {
  id: AchievementId;
  title: string;
  description: string;
};

const ACHIEVEMENTS: AchievementDefinition[] = [
  { id: "first_boss", title: "First Blood", description: "Defeat one boss in a run." },
  { id: "survive_60", title: "Sixty Second Storm", description: "Survive for 60 seconds." },
  { id: "survive_120", title: "Long Haul", description: "Survive for 120 seconds." },
  { id: "kills_100", title: "Clean Sweep", description: "Get 100 kills in one run." },
  { id: "bosses_3", title: "Boss Hunter", description: "Defeat three bosses in one run." },
  { id: "accuracy_50", title: "Sharpshooter", description: "Hit 50% accuracy in one run." },
  { id: "threat_10", title: "Deep Storm", description: "Reach threat 10." },
  { id: "score_20000", title: "Score Stack", description: "Score 20,000 points in one run." },
];

export function readAchievements(): AchievementState {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (!raw) return { unlocked: createEmptyUnlocks() };
    const parsed = JSON.parse(raw) as Partial<AchievementState>;
    return normalize(parsed);
  } catch {
    return { unlocked: createEmptyUnlocks() };
  }
}

export function writeAchievements(state: AchievementState): void {
  try {
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
}

export function updateAchievements(run: RunSummary): AchievementState {
  const current = readAchievements();
  const next: AchievementState = { unlocked: { ...current.unlocked } };
  const unlockedAt = new Date().toISOString();

  for (const achievement of ACHIEVEMENTS) {
    if (next.unlocked[achievement.id]) continue;
    if (meetsRequirement(achievement.id, run)) next.unlocked[achievement.id] = unlockedAt;
  }

  writeAchievements(next);
  return next;
}

export function formatAchievementsSummary(state: AchievementState): string {
  const unlocked = Object.values(state.unlocked).filter(Boolean).length;
  return `${unlocked}/${ACHIEVEMENTS.length} achievements unlocked`;
}

export function listAchievements() {
  return ACHIEVEMENTS;
}

function meetsRequirement(id: AchievementId, run: RunSummary): boolean {
  switch (id) {
    case "first_boss":
      return (run.bossesDefeated ?? 0) >= 1;
    case "survive_60":
      return run.survivalMs >= 60000;
    case "survive_120":
      return run.survivalMs >= 120000;
    case "kills_100":
      return run.kills >= 100;
    case "bosses_3":
      return (run.bossesDefeated ?? 0) >= 3;
    case "accuracy_50":
      return (run.shotAccuracy ?? 0) >= 0.5;
    case "threat_10":
      return (run.maxThreatLevel ?? 0) >= 10;
    case "score_20000":
      return run.score >= 20000;
    default:
      return false;
  }
}

function normalize(input: Partial<AchievementState>): AchievementState {
  return {
    unlocked: {
      first_boss: input.unlocked?.first_boss || null,
      survive_60: input.unlocked?.survive_60 || null,
      survive_120: input.unlocked?.survive_120 || null,
      kills_100: input.unlocked?.kills_100 || null,
      bosses_3: input.unlocked?.bosses_3 || null,
      accuracy_50: input.unlocked?.accuracy_50 || null,
      threat_10: input.unlocked?.threat_10 || null,
      score_20000: input.unlocked?.score_20000 || null,
    },
  };
}

function createEmptyUnlocks(): Record<AchievementId, string | null> {
  return {
    first_boss: null,
    survive_60: null,
    survive_120: null,
    kills_100: null,
    bosses_3: null,
    accuracy_50: null,
    threat_10: null,
    score_20000: null,
  };
}
