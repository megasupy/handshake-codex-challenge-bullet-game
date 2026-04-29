import type { GameMode, LeaderboardResult, RunRecord, RunSummary } from "../types";
import { getSupabaseClient } from "./supabase";
import {
  getLocalLeaderboard,
  getPendingRuns,
  markRunSynced,
  saveLocalRun,
  saveName,
  sortRuns,
} from "./localRuns";

const BUILD_VERSION = "mvp-0.1.0";

type RemoteRun = {
  id: string;
  player_name: string;
  survival_ms: number;
  score: number;
  kills: number;
  max_threat_level: number;
  seed: string;
  mode: GameMode;
  created_at: string;
};

export async function getLeaderboard(mode: GameMode = "endless"): Promise<LeaderboardResult> {
  const fallback = getLocalLeaderboard(mode);
  const supabase = getSupabaseClient();

  if (!supabase) {
    return { rows: fallback, source: "local", error: "Supabase is not configured." };
  }

  try {
    const { data, error } = await supabase
      .from("runs")
      .select("id, player_name, survival_ms, score, kills, max_threat_level, seed, mode, created_at")
      .eq("mode", mode)
      .order("survival_ms", { ascending: false })
      .order("score", { ascending: false })
      .limit(10);

    if (error) throw error;

    return {
      rows: (data || []).map(fromRemoteRun),
      source: "remote",
    };
  } catch (error) {
    return {
      rows: fallback,
      source: "local",
      error: error instanceof Error ? error.message : "Leaderboard unavailable.",
    };
  }
}

export async function submitRun(summary: RunSummary, playerName: string): Promise<LeaderboardResult> {
  const cleanName = sanitizeName(playerName);
  saveName(cleanName);

  const run: RunRecord = {
    ...summary,
    id: crypto.randomUUID(),
    playerName: cleanName,
    createdAt: new Date().toISOString(),
    synced: false,
  };

  saveLocalRun(run);
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      rows: getLocalLeaderboard(summary.mode),
      source: "local",
      error: "Saved locally. Online leaderboard is not configured.",
    };
  }

  try {
    await insertRemoteRun(run);
    markRunSynced(run.id);
    await syncPendingRuns();
    return getLeaderboard(summary.mode);
  } catch (error) {
    return {
      rows: getLocalLeaderboard(summary.mode),
      source: "local",
      error: error instanceof Error ? `Saved locally. ${error.message}` : "Saved locally.",
    };
  }
}

export async function syncPendingRuns(): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase || !navigator.onLine) return;

  for (const run of getPendingRuns()) {
    try {
      await insertRemoteRun(run);
      markRunSynced(run.id);
    } catch {
      return;
    }
  }
}

function sanitizeName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ").slice(0, 18);
  return cleaned || "pilot";
}

async function insertRemoteRun(run: RunRecord): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const { error } = await supabase.from("runs").insert({
    id: run.id,
    player_name: run.playerName,
    survival_ms: run.survivalMs,
    score: run.score,
    kills: run.kills,
    max_threat_level: run.maxThreatLevel,
    seed: run.seed,
    mode: run.mode,
    build_version: BUILD_VERSION,
    created_at: run.createdAt,
  });

  if (error) throw error;
}

function fromRemoteRun(row: RemoteRun): RunRecord {
  return {
    id: row.id,
    playerName: row.player_name,
    survivalMs: row.survival_ms,
    score: row.score,
    kills: row.kills,
    maxThreatLevel: row.max_threat_level,
    seed: row.seed,
    mode: row.mode,
    createdAt: row.created_at,
    synced: true,
  };
}

export function mergeLocalRows(rows: RunRecord[], mode: GameMode): RunRecord[] {
  return sortRuns([...rows, ...getLocalLeaderboard(mode)]).slice(0, 10);
}
