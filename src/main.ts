import Phaser from "phaser";
import "./styles.css";
import { playTestSound, unlockAudio } from "./game/audio";
import { GameScene } from "./game/GameScene";
import { ARENA_HEIGHT, ARENA_WIDTH } from "./game/constants";
import { gameEvents, type AutomationCompletePayload, type AutomationSnapshotPayload, type BossHudPayload, type DebugSettings, type DebugStats, type HudPayload, type UpgradeOption } from "./game/events";
import { getLeaderboard, submitRun, syncPendingRuns } from "./services/leaderboard";
import { clearCheckpoint, describeCheckpoint, readCheckpoint } from "./services/checkpoint";
import { getPendingRuns, getSavedName, isRunPinned, readPinnedRunIds, readRuns, removeRun, sortRunsWithPinned, toggleRunPinned } from "./services/localRuns";
import { formatKeybindSummary, readKeybinds, resetKeybinds, updateKeybind, type KeybindAction, type KeybindState } from "./services/keybinds";
import { exportProfileBackup, importProfileBackup } from "./services/profileBackup";
import { formatTutorialSummary, markTutorialSeen, readTutorialState, type TutorialState } from "./services/tutorial";
import { clearTelemetryArchive, formatTelemetryArchiveEntry, readTelemetryArchive, saveTelemetryRun, type TelemetryArchiveEntry } from "./services/telemetryArchive";
import { formatPreferencesSummary, readPreferences, updatePreferences, type PreferencesState } from "./services/preferences";
import { applySettingsPreset, formatSettingsPresetSummary, readSelectedSettingsPreset, SETTINGS_PRESETS, type SettingsPresetId, writeSelectedSettingsPreset } from "./services/settingsPresets";
import { formatRecordsSummary, readRecords, updateRecords, type RecordsState } from "./services/records";
import { formatAchievementsSummary, listAchievements, readAchievements, updateAchievements, type AchievementState } from "./services/achievements";
import { PROGRESSION_UPGRADES, buyUpgrade, formatProgressionSummary, grantRunReward, getUpgradeCost, readProgression, resetProgression, type ProgressionState, type ProgressionUpgradeId } from "./services/progression";
import type { GameMode, LeaderboardResult, RunRecord, RunSummary } from "./types";
import type { TelemetryConfig, TelemetryRun } from "./game/telemetry";

const AUTOPLAYER_KEY = "storm_debug_autoplayer_v1";
const LEADERBOARD_MODE_KEY = "storm_leaderboard_mode_v1";
const RUN_SEARCH_KEY = "storm_run_search_v1";
const TELEMETRY_FILTER_KEY = "storm_telemetry_filter_v1";
const RUN_SORT_KEY = "storm_run_sort_v1";
const query = new URLSearchParams(window.location.search);
const automationConfig = getAutomationConfig();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-container",
  width: ARENA_WIDTH,
  height: ARENA_HEIGHT,
  backgroundColor: "#07090f",
  physics: {
    default: "arcade",
    arcade: {
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [],
});

game.scene.add("game", GameScene, false);

const menu = mustGet("menu");
const hud = mustGet("hud");
const bossHud = mustGet("boss-hud");
const bossName = mustGet("boss-name");
const bossPhase = mustGet("boss-phase");
const bossPattern = mustGet("boss-pattern");
const bossHealthFill = mustGet("boss-health-fill");
const hudKills = mustGet("hud-kills");
const hudShots = mustGet("hud-shots");
const hudAccuracy = mustGet("hud-accuracy");
const progressionShards = mustGet("progression-shards");
const progressionSummary = mustGet("progression-summary");
const checkpointSummary = mustGet("checkpoint-summary");
const progressionStats = mustGet("progression-stats");
const progressionUpgrades = mustGet("progression-upgrades");
const progressionReset = mustGetButton("progression-reset");
const recordsSummary = mustGet("records-summary");
const recordsStats = mustGet("records-stats");
const recentRunsCount = mustGet("recent-runs-count");
const recentRunsSummary = mustGet("recent-runs-summary");
const recentRunsList = mustGet("recent-runs-list");
const selectedRunSync = mustGet("selected-run-sync");
const selectedRunSummary = mustGet("selected-run-summary");
const selectedRunComparison = mustGet("selected-run-comparison");
const selectedRunPin = mustGetButton("selected-run-pin");
const selectedRunReplay = mustGetButton("selected-run-replay");
const selectedRunCopySeed = mustGetButton("selected-run-copy-seed");
const selectedRunCopyLink = mustGetButton("selected-run-copy-link");
const selectedRunCopyReport = mustGetButton("selected-run-copy-report");
const selectedRunDelete = mustGetButton("selected-run-delete");
const achievementsCount = mustGet("achievements-count");
const achievementsSummary = mustGet("achievements-summary");
const achievementsList = mustGet("achievements-list");
const syncStatusPill = mustGet("sync-status-pill");
const syncStatusSummary = mustGet("sync-status-summary");
const syncStatusStats = mustGet("sync-status-stats");
const syncNowButton = mustGetButton("sync-now-button");
const preferencesSummary = mustGet("preferences-summary");
const settingsPresetSummary = mustGet("settings-preset-summary");
const settingsPresetList = mustGet("settings-preset-list");
const prefsVolume = mustGetInput("prefs-volume");
const prefsVolumeValue = mustGet("prefs-volume-value");
const prefsScreenShake = mustGetInput("prefs-screen-shake");
const prefsScreenShakeStrength = mustGetInput("prefs-screen-shake-strength");
const prefsScreenShakeStrengthValue = mustGet("prefs-screen-shake-strength-value");
const prefsReducedMotion = mustGetInput("prefs-reduced-motion");
const prefsHighContrast = mustGetInput("prefs-high-contrast");
const prefsCombatText = mustGetInput("prefs-combat-text");
const fullscreenSummary = mustGet("fullscreen-summary");
const fullscreenToggle = mustGetButton("fullscreen-toggle");
const keybindsSummary = mustGet("keybinds-summary");
const bindUp = mustGetButton("bind-up");
const bindDown = mustGetButton("bind-down");
const bindLeft = mustGetButton("bind-left");
const bindRight = mustGetButton("bind-right");
const bindDash = mustGetButton("bind-dash");
const keybindsReset = mustGetButton("keybinds-reset");
const telemetryArchiveCount = mustGet("telemetry-archive-count");
const telemetryArchiveSummary = mustGet("telemetry-archive-summary");
const telemetryFilter = mustGetInput("telemetry-filter");
const telemetryArchiveList = mustGet("telemetry-archive-list");
const telemetryArchiveCopy = mustGetButton("telemetry-archive-copy");
const telemetryArchiveDownload = mustGetButton("telemetry-archive-download");
const telemetryArchiveClear = mustGetButton("telemetry-archive-clear");
const telemetryTimelineCount = mustGet("telemetry-timeline-count");
const telemetryTimelineSummary = mustGet("telemetry-timeline-summary");
const telemetryTimelineList = mustGet("telemetry-timeline-list");
const runFeedCount = mustGet("run-feed-count");
const runFeedSummary = mustGet("run-feed-summary");
const runFeedList = mustGet("run-feed-list");
const profileBackup = mustGet("profile-backup") as HTMLTextAreaElement;
const profileBackupSavedAt = mustGet("profile-backup-saved-at");
const profileBackupExport = mustGetButton("profile-backup-export");
const profileBackupImport = mustGetButton("profile-backup-import");
const profileBackupCopy = mustGetButton("profile-backup-copy");
const profileResetAll = mustGetButton("profile-reset-all");
const profileBackupStatus = mustGet("profile-backup-status");
const upgradeScreen = mustGet("upgrade-screen");
const tutorialScreen = mustGet("tutorial-screen");
const tutorialClose = mustGetButton("tutorial-close");
const tutorialDontShow = mustGetInput("tutorial-dont-show");
const gameOver = mustGet("game-over");
const pauseScreen = mustGet("pause-screen");
const pauseTime = mustGet("pause-time");
const pauseScore = mustGet("pause-score");
const pauseThreat = mustGet("pause-threat");
const pauseHp = mustGet("pause-hp");
const pauseBoss = mustGet("pause-boss");
const pauseDangerLabel = mustGet("pause-danger-label");
const pauseDangerTrace = mustGet("pause-danger-trace");
const pauseButton = mustGetButton("pause-button");
const pauseResume = mustGetButton("pause-resume");
const pauseRestart = mustGetButton("pause-restart");
const pauseMenu = mustGetButton("pause-menu");
const runSummary = mustGet("run-summary");
const runStyle = mustGet("run-style");
const runDamage = mustGet("run-damage");
const runUpgradePath = mustGet("run-upgrade-path");
const runAdvice = mustGet("run-advice");
const runBreakdown = mustGet("run-breakdown");
const runComparison = mustGet("run-comparison");
const runSeed = mustGet("run-seed");
const leaderboardList = mustGet("leaderboard-list");
const leaderboardSource = mustGet("leaderboard-source");
const leaderboardModeEndless = mustGetButton("leaderboard-mode-endless");
const leaderboardModeDaily = mustGetButton("leaderboard-mode-daily");
const leaderboardRefresh = mustGetButton("leaderboard-refresh");
const leaderboardExport = mustGetButton("leaderboard-export");
const selectedBoardSync = mustGet("selected-board-sync");
const selectedBoardSummary = mustGet("selected-board-summary");
const selectedBoardComparison = mustGet("selected-board-comparison");
const selectedBoardPin = mustGetButton("selected-board-pin");
const selectedBoardReplay = mustGetButton("selected-board-replay");
const selectedBoardCopySeed = mustGetButton("selected-board-copy-seed");
const selectedBoardCopyLink = mustGetButton("selected-board-copy-link");
const selectedBoardCopyReport = mustGetButton("selected-board-copy-report");
const selectedBoardDelete = mustGetButton("selected-board-delete");
const playButton = mustGetButton("play-button");
const resumeButton = mustGetButton("resume-button");
const dailyButton = mustGetButton("daily-button");
const bossRushButton = mustGetButton("boss-rush-button");
const tutorialButton = mustGetButton("tutorial-button");
const tutorialSummary = mustGet("tutorial-summary");
const dailySeedPreview = mustGet("daily-seed-preview");
const dailySeedCopy = mustGetButton("daily-seed-copy");
const runSearch = mustGetInput("run-search");
const runSort = mustGet("run-sort") as HTMLSelectElement;
const submitButton = mustGetButton("submit-button");
const replayButton = mustGetButton("replay-button");
const copySeedButton = mustGetButton("copy-seed-button");
const copyLinkButton = mustGetButton("copy-link-button");
const copyReportButton = mustGetButton("copy-report-button");
const restartButton = mustGetButton("restart-button");
const menuButton = mustGetButton("menu-button");
const playerNameInput = mustGetInput("player-name");
const submitStatus = mustGet("submit-status");
const debugToggle = mustGetButton("debug-toggle");
const debugClose = mustGetButton("debug-close");
const debugPanel = mustGet("debug-panel");
const debugStats = mustGet("debug-stats");
const toastStack = mustGet("toast-stack");

const debugControls = {
  enabled: mustGetInput("debug-enabled"),
  invulnerable: mustGetInput("debug-invulnerable"),
  autoplayer: mustGetInput("debug-autoplayer"),
  threat: mustGetInput("debug-threat"),
  time: mustGetInput("debug-time"),
  timeScale: mustGetInput("debug-time-scale"),
  spawn: mustGetInput("debug-spawn"),
  enemySpeed: mustGetInput("debug-enemy-speed"),
  bulletSpeed: mustGetInput("debug-bullet-speed"),
  health: mustGetInput("debug-health"),
  fireRate: mustGetInput("debug-fire-rate"),
  playerFire: mustGetInput("debug-player-fire"),
  projectileSpeed: mustGetInput("debug-projectile-speed"),
  enemyCap: mustGetInput("debug-enemy-cap"),
};

let currentMode: GameMode = "endless";
let leaderboardMode: GameMode = readLeaderboardMode();
let lastRun: RunSummary | null = null;
let currentUpgradeOptions: UpgradeOption[] = [];
let currentProgression: ProgressionState = readProgression();
let currentPreferences: PreferencesState = readPreferences();
let currentSettingsPreset: SettingsPresetId = readSelectedSettingsPreset();
let currentRecords: RecordsState = readRecords();
let currentAchievements: AchievementState = readAchievements();
let currentKeybinds: KeybindState = readKeybinds();
let currentTelemetryArchive: TelemetryArchiveEntry[] = readTelemetryArchive();
let currentTutorial: TutorialState = readTutorialState();
let currentHudState: HudPayload | null = null;
let currentBossHudState: BossHudPayload | null = null;
let currentLeaderboardRows: RunRecord[] = [];
let selectedRecentRun: RunRecord | null = null;
let selectedBoardRun: RunRecord | null = null;
let telemetryFilterValue = readStoredText(TELEMETRY_FILTER_KEY);
let selectedTelemetryRunId: string | null = null;
let runSearchValue = readStoredText(RUN_SEARCH_KEY);
let runSortValue = readStoredText(RUN_SORT_KEY) || "best";
let dangerHistory: number[] = [];
let pendingKeybindAction: KeybindAction | null = null;
let runPaused = false;
let toastId = 0;

if (automationConfig.autoplayer) localStorage.setItem(AUTOPLAYER_KEY, "true");
playerNameInput.value = getSavedName();
debugControls.autoplayer.checked = automationConfig.autoplayer || localStorage.getItem(AUTOPLAYER_KEY) === "true";
if (automationConfig.timeScale !== null) debugControls.timeScale.value = automationConfig.timeScale.toString();
applyPreferencesToUi(currentPreferences);
renderSettingsPresetPanel();
renderFullscreenUi();
tutorialDontShow.checked = !currentTutorial.seen;
renderKeybindsPanel();
telemetryFilter.value = telemetryFilterValue;
runSearch.value = runSearchValue;
runSort.value = runSortValue;
refreshDailySeedUi();

playButton.addEventListener("click", () => startRun("endless"));
resumeButton.addEventListener("click", () => {
  const checkpoint = readCheckpoint();
  if (!checkpoint) return;
  startRun(checkpoint.mode, checkpoint);
});
dailyButton.addEventListener("click", () => startRun("daily"));
bossRushButton.addEventListener("click", () => startRun("boss-rush", null, undefined, 58000));
tutorialButton.addEventListener("click", () => showTutorial());
dailySeedCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(dailySeedPreview.textContent || dailySeed());
    showToast("Daily seed copied.", "success");
  } catch {
    showToast("Daily seed copy failed.", "error");
  }
});
bindUp.addEventListener("click", () => beginKeybindCapture("moveUp"));
bindDown.addEventListener("click", () => beginKeybindCapture("moveDown"));
bindLeft.addEventListener("click", () => beginKeybindCapture("moveLeft"));
bindRight.addEventListener("click", () => beginKeybindCapture("moveRight"));
bindDash.addEventListener("click", () => beginKeybindCapture("dash"));
keybindsReset.addEventListener("click", () => {
  currentKeybinds = resetKeybinds();
  pendingKeybindAction = null;
  renderKeybindsPanel();
  profileBackup.value = JSON.stringify(exportProfileBackup(), null, 2);
});
syncNowButton.addEventListener("click", () => void syncNow());
pauseButton.addEventListener("click", () => togglePause());
pauseResume.addEventListener("click", () => resumeRun());
pauseRestart.addEventListener("click", () => startRun(currentMode));
pauseMenu.addEventListener("click", () => void showMenu());
replayButton.addEventListener("click", () => {
  if (!lastRun) return;
  startRun(lastRun.mode, null, lastRun.seed);
});
copySeedButton.addEventListener("click", async () => {
  if (!lastRun) return;
  try {
    await navigator.clipboard.writeText(lastRun.seed);
    showToast("Seed copied.", "success");
  } catch {
    showToast("Seed copy failed.", "error");
  }
});
copyLinkButton.addEventListener("click", async () => {
  if (!lastRun) return;
  const link = buildReplayLink(lastRun);
  try {
    await navigator.clipboard.writeText(link);
    showToast("Replay link copied.", "success");
  } catch {
    showToast("Replay link copy failed.", "error");
  }
});
copyReportButton.addEventListener("click", async () => {
  if (!lastRun) return;
  const report = buildRunReport(lastRun);
  try {
    await navigator.clipboard.writeText(report);
    showToast("Run report copied.", "success");
  } catch {
    showToast("Run report copy failed.", "error");
  }
});
recentRunsList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const item = target.closest("[data-run-id]") as HTMLElement | null;
  if (!item) return;
  const run = readRuns().find((entry) => entry.id === item.dataset.runId);
  if (!run) return;
  selectedRecentRun = run;
  renderSelectedRunPanel();
  renderRecentRunsPanel();
});
selectedRunReplay.addEventListener("click", () => {
  if (!selectedRecentRun) return;
  startRun(selectedRecentRun.mode, null, selectedRecentRun.seed);
});
selectedRunPin.addEventListener("click", () => {
  if (!selectedRecentRun) return;
  toggleRunPinned(selectedRecentRun.id);
  renderRecentRunsPanel();
  renderSelectedRunPanel();
});
selectedRunCopySeed.addEventListener("click", async () => {
  if (!selectedRecentRun) return;
  try {
    await navigator.clipboard.writeText(selectedRecentRun.seed);
    showToast("Selected seed copied.", "success");
  } catch {
    showToast("Selected seed copy failed.", "error");
  }
});
selectedRunCopyLink.addEventListener("click", async () => {
  if (!selectedRecentRun) return;
  const link = buildRunLink(selectedRecentRun);
  try {
    await navigator.clipboard.writeText(link);
    showToast("Selected run link copied.", "success");
  } catch {
    showToast("Selected run link copy failed.", "error");
  }
});
selectedRunCopyReport.addEventListener("click", async () => {
  if (!selectedRecentRun) return;
  const report = buildRunRecordReport(selectedRecentRun);
  try {
    await navigator.clipboard.writeText(report);
    showToast("Selected run report copied.", "success");
  } catch {
    showToast("Selected run report copy failed.", "error");
  }
});
selectedRunDelete.addEventListener("click", () => {
  if (!selectedRecentRun) return;
  removeRun(selectedRecentRun.id);
  selectedRecentRun = null;
  renderRecentRunsPanel();
  renderSelectedRunPanel();
  showToast("Selected run deleted.", "success");
});
restartButton.addEventListener("click", () => startRun(currentMode));
menuButton.addEventListener("click", showMenu);
leaderboardRefresh.addEventListener("click", () => void refreshLeaderboard(leaderboardMode));
leaderboardExport.addEventListener("click", () => exportLeaderboardCsv());
leaderboardModeEndless.addEventListener("click", () => {
  leaderboardMode = "endless";
  writeLeaderboardMode(leaderboardMode);
  renderLeaderboardModeButtons();
  void refreshLeaderboard(leaderboardMode);
});
leaderboardModeDaily.addEventListener("click", () => {
  leaderboardMode = "daily";
  writeLeaderboardMode(leaderboardMode);
  renderLeaderboardModeButtons();
  void refreshLeaderboard(leaderboardMode);
});
leaderboardList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const item = target.closest("[data-board-run-id]") as HTMLElement | null;
  if (!item) return;
  const run = currentLeaderboardRows.find((entry) => entry.id === item.dataset.boardRunId);
  if (!run) return;
  selectedBoardRun = run;
  renderSelectedBoardPanel();
});
selectedBoardReplay.addEventListener("click", () => {
  if (!selectedBoardRun) return;
  startRun(selectedBoardRun.mode, null, selectedBoardRun.seed);
});
selectedBoardPin.addEventListener("click", () => {
  if (!selectedBoardRun) return;
  toggleRunPinned(selectedBoardRun.id);
  renderRecentRunsPanel();
  renderSelectedBoardPanel();
});
selectedBoardCopySeed.addEventListener("click", async () => {
  if (!selectedBoardRun) return;
  try {
    await navigator.clipboard.writeText(selectedBoardRun.seed);
    showToast("Leaderboard seed copied.", "success");
  } catch {
    showToast("Leaderboard seed copy failed.", "error");
  }
});
selectedBoardCopyLink.addEventListener("click", async () => {
  if (!selectedBoardRun) return;
  const link = buildRunLink(selectedBoardRun);
  try {
    await navigator.clipboard.writeText(link);
    showToast("Leaderboard link copied.", "success");
  } catch {
    showToast("Leaderboard link copy failed.", "error");
  }
});
selectedBoardCopyReport.addEventListener("click", async () => {
  if (!selectedBoardRun) return;
  const report = buildRunRecordReport(selectedBoardRun);
  try {
    await navigator.clipboard.writeText(report);
    showToast("Leaderboard run report copied.", "success");
  } catch {
    showToast("Leaderboard run report copy failed.", "error");
  }
});
selectedBoardDelete.addEventListener("click", () => {
  if (!selectedBoardRun) return;
  removeRun(selectedBoardRun.id);
  selectedBoardRun = null;
  void refreshLeaderboard(leaderboardMode);
  renderSelectedBoardPanel();
  renderRecentRunsPanel();
  showToast("Leaderboard run deleted.", "success");
});
submitButton.addEventListener("click", submitCurrentRun);
debugToggle.addEventListener("click", () => debugPanel.classList.toggle("hidden"));
debugClose.addEventListener("click", () => hide(debugPanel));
progressionReset.addEventListener("click", () => {
  currentProgression = resetProgression();
  renderProgressionPanel();
});
prefsVolume.addEventListener("input", applyPreferenceControls);
prefsVolume.addEventListener("change", applyPreferenceControls);
prefsScreenShake.addEventListener("input", applyPreferenceControls);
prefsScreenShake.addEventListener("change", applyPreferenceControls);
prefsScreenShakeStrength.addEventListener("input", applyPreferenceControls);
prefsScreenShakeStrength.addEventListener("change", applyPreferenceControls);
prefsReducedMotion.addEventListener("input", applyPreferenceControls);
prefsReducedMotion.addEventListener("change", applyPreferenceControls);
prefsHighContrast.addEventListener("input", applyPreferenceControls);
prefsHighContrast.addEventListener("change", applyPreferenceControls);
prefsCombatText.addEventListener("input", applyPreferenceControls);
prefsCombatText.addEventListener("change", applyPreferenceControls);
fullscreenToggle.addEventListener("click", () => void toggleFullscreen());
telemetryArchiveCopy.addEventListener("click", copyLatestTelemetryLog);
telemetryArchiveDownload.addEventListener("click", downloadLatestTelemetryLog);
telemetryArchiveClear.addEventListener("click", () => {
  clearTelemetryArchive();
  currentTelemetryArchive = [];
  selectedTelemetryRunId = null;
  renderTelemetryArchive();
  renderTelemetryTimeline();
  renderRunFeed();
  showToast("Telemetry archive cleared.", "success");
});
telemetryArchiveList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const item = target.closest("[data-telemetry-run-id]") as HTMLElement | null;
  if (!item) return;
  selectedTelemetryRunId = item.dataset.telemetryRunId || null;
  renderTelemetryArchive();
  renderTelemetryTimeline();
  renderRunFeed();
});
telemetryFilter.addEventListener("input", () => {
  telemetryFilterValue = telemetryFilter.value.trim().toLowerCase();
  writeStoredText(TELEMETRY_FILTER_KEY, telemetryFilterValue);
  renderTelemetryArchive();
  renderTelemetryTimeline();
  renderRunFeed();
});
runSearch.addEventListener("input", () => {
  runSearchValue = runSearch.value.trim().toLowerCase();
  writeStoredText(RUN_SEARCH_KEY, runSearchValue);
  renderRecentRunsPanel();
  renderLeaderboard({ source: leaderboardSource.textContent === "Online" ? "remote" : "local", rows: currentLeaderboardRows });
});
runSort.addEventListener("change", () => {
  runSortValue = runSort.value;
  writeStoredText(RUN_SORT_KEY, runSortValue);
  renderRecentRunsPanel();
});
profileBackupExport.addEventListener("click", () => {
  const backup = exportProfileBackup();
  profileBackup.value = JSON.stringify(backup, null, 2);
  profileBackupStatus.textContent = `Exported ${new Date(backup.savedAt).toLocaleString()}.`;
  renderBackupSavedAt(backup.savedAt);
  showToast("Profile exported.", "success");
});
profileBackupImport.addEventListener("click", () => {
  const result = importProfileBackup(profileBackup.value);
  if (!result.ok) {
    profileBackupStatus.textContent = result.error || "Import failed.";
    showToast(result.error || "Profile import failed.", "error");
    return;
  }
  syncProfileFromStorage();
  profileBackupStatus.textContent = "Profile restored.";
  renderBackupSavedAt(new Date().toISOString());
  showToast("Profile restored.", "success");
});
profileBackupCopy.addEventListener("click", async () => {
  if (!profileBackup.value.trim()) profileBackup.value = JSON.stringify(exportProfileBackup(), null, 2);
  try {
    await navigator.clipboard.writeText(profileBackup.value);
    profileBackupStatus.textContent = "Backup copied.";
    showToast("Backup copied.", "success");
  } catch {
    profileBackupStatus.textContent = "Copy failed. Use the text box manually.";
    showToast("Backup copy failed.", "error");
  }
});
profileResetAll.addEventListener("click", () => {
  resetAllLocalData();
  showToast("Local data reset.", "success");
});
tutorialClose.addEventListener("click", () => {
  currentTutorial = markTutorialSeen(!tutorialDontShow.checked);
  refreshTutorialUi();
  hide(tutorialScreen);
});
tutorialDontShow.addEventListener("change", () => {
  currentTutorial = markTutorialSeen(!tutorialDontShow.checked);
  refreshTutorialUi();
});
mustGetButton("debug-apply-time").addEventListener("click", () => getGameScene()?.setElapsedSeconds(Number(debugControls.time.value) || 0));
mustGetButton("debug-clear").addEventListener("click", () => getGameScene()?.clearThreats());
mustGetButton("debug-kill").addEventListener("click", () => getGameScene()?.forceEndRun());
mustGetButton("debug-test-sound").addEventListener("click", async () => {
  const ok = await playTestSound();
  if (!ok) console.warn("Audio did not unlock. Check browser/site sound permissions.");
});
window.addEventListener("online", () => {
  void syncPendingRuns().finally(() => renderSyncStatusPanel());
});
window.addEventListener("pointerdown", () => void unlockAudio(), { once: true });
window.addEventListener("keydown", () => void unlockAudio(), { once: true });
window.addEventListener("fullscreenchange", () => renderFullscreenUi());
window.addEventListener("blur", () => {
  if (shouldAutoPause()) pauseRun();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && shouldAutoPause()) pauseRun();
});
window.addEventListener("keydown", (event) => {
  if (!pendingKeybindAction) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  currentKeybinds = updateKeybind(pendingKeybindAction, event.key);
  pendingKeybindAction = null;
  renderKeybindsPanel();
  profileBackup.value = JSON.stringify(exportProfileBackup(), null, 2);
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" || event.key.toLowerCase() === "p") {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    if (!getGameScene() || upgradeScreen.classList.contains("hidden") === false || tutorialScreen.classList.contains("hidden") === false || gameOver.classList.contains("hidden") === false) return;
    event.preventDefault();
    togglePause();
    return;
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "`") {
    event.preventDefault();
    debugPanel.classList.toggle("hidden");
  }
});
window.addEventListener("keydown", (event) => {
  if (upgradeScreen.classList.contains("hidden")) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!/^[123]$/.test(event.key)) return;

  event.preventDefault();
  const option = currentUpgradeOptions[Number(event.key) - 1];
  if (option) chooseUpgrade(option.id);
});
window.addEventListener("keydown", (event) => {
  if (gameOver.classList.contains("hidden")) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === "r" || key === "c" || key === "l") {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
  }
  if (key === "r") {
    event.preventDefault();
    replayButton.click();
  } else if (key === "c") {
    event.preventDefault();
    copyReportButton.click();
  } else if (key === "l") {
    event.preventDefault();
    copyLinkButton.click();
  }
});

Object.values(debugControls).forEach((control) => {
  control.addEventListener("input", applyDebugControls);
  control.addEventListener("change", applyDebugControls);
});

gameEvents.addEventListener("hud", (event) => {
  const detail = (event as CustomEvent<HudPayload>).detail;
  currentHudState = detail;
  text("hud-time", `${(detail.timeMs / 1000).toFixed(1)}s`);
  text("hud-score", Math.floor(detail.score).toString());
  text("hud-threat", detail.threat.toString());
  text("hud-health", detail.health.toString());
  text("hud-kills", detail.kills.toString());
  text("hud-shots", detail.shotsFired.toString());
  text("hud-accuracy", `${Math.round(detail.shotAccuracy * 100)}%`);
  if (runPaused) renderPauseSnapshot();
});

gameEvents.addEventListener("upgrade", (event) => {
  const options = (event as CustomEvent<UpgradeOption[]>).detail;
  currentUpgradeOptions = options;
  const container = mustGet("upgrade-options");
  container.innerHTML = "";

  for (const option of options) {
    const button = document.createElement("button");
    button.className = "upgrade-card";
    const key = String(options.indexOf(option) + 1);
    button.innerHTML = `
      <span class="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-slate-950/80 text-xs font-black text-white">${key}</span>
      <strong class="block text-lg text-white">${option.title}</strong>
      <span class="mt-3 block text-sm leading-6 text-slate-300">${option.description}</span>
      <span class="mt-4 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Press ${key}</span>
    `;
    button.addEventListener("click", () => chooseUpgrade(option.id));
    container.append(button);
  }

  show(upgradeScreen);
});

gameEvents.addEventListener("game-over", (event) => {
  lastRun = (event as CustomEvent<RunSummary>).detail;
  const previousRecords = currentRecords;
  currentProgression = grantRunReward(lastRun);
  currentRecords = updateRecords(lastRun);
  currentAchievements = updateAchievements(lastRun);
  text("game-over-status", lastRun.survivalMs >= 60000 ? "Storm survived" : "Run ended");
  text("final-score", lastRun.score.toLocaleString());
  text("final-time", `${(lastRun.survivalMs / 1000).toFixed(1)}s`);
  text("final-kills", `${lastRun.kills} kills`);
  text("final-threat", `Threat ${lastRun.maxThreatLevel}`);
  text("run-seed", lastRun.seed);
  renderRunSummary(lastRun);
  renderRunStyle(lastRun);
  renderRunDamage(lastRun);
  renderRunUpgradePath(lastRun);
  renderRunAdvice(lastRun);
  renderRunBreakdown(lastRun);
  renderRunComparison(lastRun, previousRecords);
  submitStatus.textContent = `Progress saved. Gained ${currentProgression.lastReward} shards.`;
  submitButton.disabled = false;
  renderProgressionPanel();
  renderRecordsPanel();
  renderRecentRunsPanel();
  renderAchievementsPanel();
  show(gameOver);
  hideHud();
  hideBossHud();
  hide(debugToggle);
  hide(pauseButton);
  hide(debugPanel);
  refreshCheckpointUi();
});

gameEvents.addEventListener("boss-hud", (event) => {
  const detail = (event as CustomEvent<BossHudPayload>).detail;
  currentBossHudState = detail;
  if (!detail.active) {
    hideBossHud();
    if (runPaused) renderPauseSnapshot();
    return;
  }

  bossName.textContent = detail.name;
  bossPhase.textContent = `Phase ${detail.phase}`;
  bossPattern.textContent = detail.patternId ? `Pattern ${formatBossPattern(detail.patternId)}` : "Pattern idle";
  bossHealthFill.style.width = `${Math.max(0, Math.min(100, (detail.hp / detail.maxHp) * 100))}%`;
  show(bossHud);
  if (runPaused) renderPauseSnapshot();
});

gameEvents.addEventListener("debug-stats", (event) => {
  const detail = (event as CustomEvent<DebugStats>).detail;
  debugControls.time.value = Math.floor(detail.elapsedMs / 1000).toString();
  dangerHistory = [...dangerHistory.slice(-7), detail.danger];
  renderDebugStats(detail);
  if (runPaused) renderPauseSnapshot();
});

gameEvents.addEventListener("automation-complete", (event) => {
  const detail = (event as CustomEvent<AutomationCompletePayload>).detail;
  if (!automationConfig.active || !detail.run) return;
  currentTelemetryArchive = saveTelemetryRun(detail.run);
  renderTelemetryArchive();
  renderTelemetryTimeline();
  renderRunFeed();
  renderSyncStatusPanel();
  publishAutomationResult(detail.run, true);
});

gameEvents.addEventListener("automation-snapshot", (event) => {
  const detail = (event as CustomEvent<AutomationSnapshotPayload>).detail;
  if (!automationConfig.active) return;
  publishAutomationResult(detail.run, false);
});

renderLeaderboardModeButtons();
void refreshLeaderboard(leaderboardMode);
renderProgressionPanel();
renderRecordsPanel();
renderRecentRunsPanel();
renderAchievementsPanel();
renderSyncStatusPanel();
renderTelemetryTimeline();
renderRunFeed();
refreshCheckpointUi();
renderTelemetryArchive();
profileBackup.value = JSON.stringify(exportProfileBackup(), null, 2);
refreshTutorialUi();
if (automationConfig.active) {
  queueMicrotask(() => startRun(automationConfig.mode));
} else if (debugControls.autoplayer.checked) {
  queueMicrotask(() => startRun("endless"));
} else if (!currentTutorial.seen) {
  queueMicrotask(() => showTutorial());
}

function startRun(mode: GameMode, checkpoint: ReturnType<typeof readCheckpoint> = null, seedOverride?: string, startMsOverride?: number) {
  if (!automationConfig.active) void unlockAudio();
  if (!checkpoint) clearCheckpoint();
  currentMode = mode;
  lastRun = null;
  dangerHistory = [];
  hide(menu);
  hide(gameOver);
  hide(upgradeScreen);
  hide(tutorialScreen);
  hide(pauseScreen);
  hide(debugPanel);
  show(debugToggle);
  show(pauseButton);
  showHud();
  hideBossHud();
  runPaused = false;
  game.scene.start("game", {
    mode,
    seed: checkpoint?.seed || seedOverride || automationConfig.seed || (mode === "daily" ? dailySeed() : Date.now().toString(36)),
    debugSettings: checkpoint?.debug || getDebugSettingsFromControls(),
    startMs: startMsOverride ?? automationConfig.startMs,
    telemetryConfig: checkpoint?.telemetryConfig || getTelemetryConfig(),
    progression: currentProgression,
    checkpoint,
    keybinds: currentKeybinds,
  });
  if (!checkpoint) applyDebugControls();
}

async function showMenu() {
  hide(gameOver);
  hide(upgradeScreen);
  hide(tutorialScreen);
  hide(pauseScreen);
  hide(debugToggle);
  hide(pauseButton);
  hide(debugPanel);
  hideHud();
  hideBossHud();
  runPaused = false;
  show(menu);
  renderProgressionPanel();
  game.scene.stop("game");
  refreshCheckpointUi();
  refreshTutorialUi();
  await refreshLeaderboard(leaderboardMode);
}

function chooseUpgrade(id: string) {
  hide(upgradeScreen);
  currentUpgradeOptions = [];
  const scene = game.scene.getScene("game") as GameScene;
  scene.applyUpgrade(id);
}

function purchaseProgressionUpgrade(id: string) {
  currentProgression = buyUpgrade(id as ProgressionUpgradeId);
  renderProgressionPanel();
}

function applyDebugControls() {
  updateDebugLabels();
  localStorage.setItem(AUTOPLAYER_KEY, debugControls.autoplayer.checked ? "true" : "false");
  const scene = getGameScene();
  if (!scene) return;

  scene.applyDebugSettings(getDebugSettingsFromControls());
}

function getDebugSettingsFromControls(): Partial<DebugSettings> {
  const enabled = debugControls.enabled.checked;
  return {
    enabled,
    threatOverride: enabled ? Number(debugControls.threat.value) : 0,
    timeScale: Number(debugControls.timeScale.value),
    spawnMultiplier: enabled ? Number(debugControls.spawn.value) : 1,
    enemySpeedMultiplier: enabled ? Number(debugControls.enemySpeed.value) : 1,
    enemyBulletSpeedMultiplier: enabled ? Number(debugControls.bulletSpeed.value) : 1,
    enemyHealthMultiplier: enabled ? Number(debugControls.health.value) : 1,
    enemyFireRateMultiplier: enabled ? Number(debugControls.fireRate.value) : 1,
    playerFireRateMultiplier: enabled ? Number(debugControls.playerFire.value) : 1,
    playerProjectileSpeed: enabled ? Number(debugControls.projectileSpeed.value) : 620,
    enemyCap: enabled ? Number(debugControls.enemyCap.value) : 120,
    invulnerable: debugControls.invulnerable.checked,
    autoplayer: debugControls.autoplayer.checked,
  };
}

function getTelemetryConfig(): Partial<TelemetryConfig> {
  return {
    enabled: automationConfig.active,
    sampleIntervalMs: automationConfig.sampleIntervalMs,
    snapshotIntervalMs: automationConfig.snapshotIntervalMs,
    maxRunMs: automationConfig.maxRunMs,
    runId: automationConfig.runId,
    exportToDom: automationConfig.active,
  };
}

function updateDebugLabels() {
  text("debug-threat-value", debugControls.threat.value);
  text("debug-time-scale-value", `${Number(debugControls.timeScale.value).toFixed(1)}x`);
  text("debug-spawn-value", `${Number(debugControls.spawn.value).toFixed(1)}x`);
  text("debug-enemy-speed-value", `${Number(debugControls.enemySpeed.value).toFixed(1)}x`);
  text("debug-bullet-speed-value", `${Number(debugControls.bulletSpeed.value).toFixed(1)}x`);
  text("debug-health-value", `${Number(debugControls.health.value).toFixed(1)}x`);
  text("debug-fire-rate-value", `${Number(debugControls.fireRate.value).toFixed(1)}x`);
  text("debug-player-fire-value", `${Number(debugControls.playerFire.value).toFixed(1)}x`);
  text("debug-projectile-speed-value", debugControls.projectileSpeed.value);
  text("debug-enemy-cap-value", debugControls.enemyCap.value);
}

function renderDebugStats(stats: DebugStats) {
  debugStats.innerHTML = "";
  const rows: Record<string, string | number> = {
    time: `${(stats.elapsedMs / 1000).toFixed(1)}s`,
    threat: stats.threat,
    score: stats.score,
    hp: stats.health,
    kills: stats.kills,
    enemies: stats.enemies,
    shots: stats.playerShots,
    bullets: stats.enemyBullets,
    pickups: stats.pickups,
    spawn: `${stats.nextSpawnMs.toFixed(0)}ms`,
    upgrade: `${(stats.nextUpgradeMs / 1000).toFixed(1)}s`,
    dash: `${stats.dashCooldownMs.toFixed(0)}ms`,
    seed: stats.seed,
  };

  for (const [label, value] of Object.entries(rows)) {
    const item = document.createElement("div");
    item.className = "debug-stat";
    item.innerHTML = `<span class="block uppercase tracking-wider text-slate-500">${label}</span><strong class="block truncate text-white">${escapeHtml(String(value))}</strong>`;
    debugStats.append(item);
  }
}

function getGameScene(): GameScene | null {
  const scene = game.scene.getScene("game");
  return scene instanceof GameScene ? scene : null;
}

async function submitCurrentRun() {
  if (!lastRun) return;

  submitButton.disabled = true;
  submitStatus.textContent = "Submitting...";
  const result = await submitRun(lastRun, playerNameInput.value);
  if (lastRun.mode === leaderboardMode) renderLeaderboard(result);
  else void refreshLeaderboard(leaderboardMode);
  renderRecentRunsPanel();
  submitStatus.textContent = result.error || `Submitted to ${result.source === "remote" ? "online" : "local"} leaderboard.`;
}

async function refreshLeaderboard(mode: GameMode) {
  renderLeaderboard(await getLeaderboard(mode));
}

function renderLeaderboardModeButtons() {
  leaderboardModeEndless.className = leaderboardMode === "endless" ? "btn-primary px-3 py-2" : "btn-secondary px-3 py-2";
  leaderboardModeDaily.className = leaderboardMode === "daily" ? "btn-primary px-3 py-2" : "btn-secondary px-3 py-2";
}

function renderLeaderboard(result: LeaderboardResult) {
  leaderboardSource.textContent = result.source === "remote" ? "Online" : "Local";
  currentLeaderboardRows = [...result.rows];
  leaderboardList.innerHTML = "";

  const rows = filterRuns(result.rows).slice(0, 10);
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "rounded-md border border-line bg-slate-950/60 px-3 py-4 text-sm text-slate-400";
    empty.textContent = runSearchValue ? "No leaderboard runs match the search." : "No runs yet.";
    leaderboardList.append(empty);
    selectedBoardRun = null;
    renderSelectedBoardPanel();
    return;
  }

  rows.forEach((run, index) => leaderboardList.append(createLeaderboardRow(run, index)));
  if (!selectedBoardRun || !rows.some((run) => run.id === selectedBoardRun?.id)) {
    selectedBoardRun = rows[0] || null;
  }
  renderSelectedBoardPanel();
}

async function exportLeaderboardCsv() {
  const rows = currentLeaderboardRows.length > 0 ? currentLeaderboardRows : await getLeaderboard(leaderboardMode).then((result) => result.rows);
  if (rows.length === 0) {
    showToast("No leaderboard rows to export.", "error");
    return;
  }

  const csv = [
    ["player", "mode", "survivalMs", "score", "kills", "threat", "seed", "synced", "createdAt"],
    ...rows.map((run) => [
      run.playerName,
      run.mode,
      String(run.survivalMs),
      String(run.score),
      String(run.kills),
      String(run.maxThreatLevel),
      run.seed,
      run.synced ? "yes" : "no",
      run.createdAt,
    ]),
  ].map((row) => row.map(escapeCsv).join(",")).join("\n");

  try {
    await navigator.clipboard.writeText(csv);
    showToast("Leaderboard CSV copied.", "success");
  } catch {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `leaderboard-${leaderboardMode}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("Leaderboard CSV downloaded.", "success");
  }
}

function renderProgressionPanel() {
  progressionShards.textContent = `${currentProgression.shards} shards`;
  progressionSummary.textContent = formatProgressionSummary(currentProgression);
  progressionStats.innerHTML = "";

  const stats: Record<string, string | number> = {
    runs: currentProgression.totalRuns,
    score: currentProgression.totalScore.toLocaleString(),
    survival: `${(currentProgression.totalSurvivalMs / 1000).toFixed(1)}s`,
    highest: currentProgression.highestThreat,
  };

  for (const [label, value] of Object.entries(stats)) {
    const stat = document.createElement("div");
    stat.className = "debug-stat";
    stat.innerHTML = `<span class="block uppercase tracking-wider text-slate-500">${label}</span><strong class="block truncate text-white">${escapeHtml(String(value))}</strong>`;
    progressionStats.append(stat);
  }

  progressionUpgrades.innerHTML = "";
  for (const upgrade of PROGRESSION_UPGRADES) {
    const level = currentProgression.upgrades[upgrade.id];
    const costValue = getUpgradeCost(upgrade.id, level);
    const cost = level >= upgrade.maxLevel ? "max" : `${costValue} shards`;
    const button = document.createElement("button");
    button.className = "progression-card";
    button.disabled = level >= upgrade.maxLevel || currentProgression.shards < costValue;
    button.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <strong class="text-sm font-black text-white">${upgrade.title}</strong>
        <span class="rounded-full border border-line px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-pulse">Lv ${level}/${upgrade.maxLevel}</span>
      </div>
      <p class="mt-2 text-left text-xs leading-5 text-slate-300">${upgrade.description}</p>
      <div class="mt-3 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
        <span>${cost}</span>
        <span>${level >= upgrade.maxLevel ? "Unlocked" : "Buy"}</span>
      </div>
    `;
    if (level < upgrade.maxLevel) {
      button.addEventListener("click", () => {
        purchaseProgressionUpgrade(upgrade.id);
      });
    }
    progressionUpgrades.append(button);
  }
}

function renderRecordsPanel() {
  recordsSummary.textContent = formatRecordsSummary(currentRecords);
  recordsStats.innerHTML = "";

  const stats: Record<string, string | number> = {
    score: currentRecords.bestScore.toLocaleString(),
    survival: `${(currentRecords.bestSurvivalMs / 1000).toFixed(1)}s`,
    kills: currentRecords.bestKills,
    threat: currentRecords.bestThreat,
    accuracy: `${(currentRecords.bestAccuracy * 100).toFixed(0)}%`,
    bosses: currentRecords.bestBosses,
  };

  for (const [label, value] of Object.entries(stats)) {
    const stat = document.createElement("div");
    stat.className = "debug-stat";
    stat.innerHTML = `<span class="block uppercase tracking-wider text-slate-500">${label}</span><strong class="block truncate text-white">${escapeHtml(String(value))}</strong>`;
    recordsStats.append(stat);
  }
}

function renderSelectedRunPanel() {
  const run = selectedRecentRun;
  selectedRunSync.textContent = run?.synced ? "Synced" : run ? "Local" : "None";
  selectedRunPin.textContent = run ? (isRunPinned(run.id) ? "Unpin" : "Pin") : "Pin";
  selectedRunPin.disabled = !run;
  selectedRunSummary.innerHTML = "";
  selectedRunComparison.innerHTML = "";

  const rows: Record<string, string | number> = run
    ? {
        mode: run.mode.toUpperCase(),
        time: `${(run.survivalMs / 1000).toFixed(1)}s`,
        score: run.score.toLocaleString(),
        kills: run.kills,
        threat: run.maxThreatLevel,
        seed: run.seed,
      }
    : {
        mode: "None",
        time: "-",
        score: "-",
        kills: "-",
        threat: "-",
        seed: "-",
      };

  for (const [label, value] of Object.entries(rows)) {
    const item = document.createElement("div");
    item.className = "debug-stat";
    item.innerHTML = `<span class="block uppercase tracking-wider text-slate-500">${label}</span><strong class="block truncate text-white">${escapeHtml(String(value))}</strong>`;
    selectedRunSummary.append(item);
  }

  renderRunComparisonGrid(selectedRunComparison, run);
}

function renderRecentRunsPanel() {
  const allRuns = readRuns();
  const runs = filterRuns(sortRunsForView(allRuns));
  recentRunsCount.textContent = runSearchValue ? `${runs.length}/${allRuns.length} run${allRuns.length === 1 ? "" : "s"}` : `${runs.length} run${runs.length === 1 ? "" : "s"}`;
  recentRunsSummary.textContent = runs.length > 0
    ? runSearchValue
      ? `Filtered to "${runSearchValue}". Recently submitted runs are stored locally and mirrored to the leaderboard when possible.`
      : "Recently submitted runs are stored locally and mirrored to the leaderboard when possible."
    : runSearchValue
      ? `No local runs match "${runSearchValue}".`
      : "Recently submitted runs are stored locally on this device.";
  recentRunsList.innerHTML = "";

  if (runs.length === 0) {
    const item = document.createElement("li");
    item.className = "rounded-md border border-line bg-slate-950/60 px-3 py-4 text-sm text-slate-400";
    item.textContent = runSearchValue ? "No recent runs match the search." : "No recent runs yet.";
    recentRunsList.append(item);
    selectedRecentRun = null;
    renderSelectedRunPanel();
    return;
  }

  runs.slice(0, 5).forEach((run) => {
    const item = document.createElement("li");
    const selected = selectedRecentRun?.id === run.id;
    item.className = selected
      ? "rounded-md border border-pulse bg-slate-900/90 px-3 py-3 text-sm text-slate-100"
      : "rounded-md border border-line bg-slate-950/60 px-3 py-3 text-sm text-slate-300";
    item.dataset.runId = run.id;
    item.innerHTML = `
      <strong class="block truncate text-white">${isRunPinned(run.id) ? "★ " : ""}${escapeHtml(run.playerName)}</strong>
      <span class="mt-1 block text-xs leading-5 text-slate-400">${run.mode.toUpperCase()} · ${(run.survivalMs / 1000).toFixed(1)}s · ${run.score.toLocaleString()} pts</span>
    `;
    recentRunsList.append(item);
  });

  if (!selectedRecentRun || !runs.some((run) => run.id === selectedRecentRun?.id)) {
    selectedRecentRun = runs[0] || null;
  }
  renderSelectedRunPanel();
}

function renderSelectedBoardPanel() {
  const run = selectedBoardRun;
  selectedBoardSync.textContent = run?.synced ? "Synced" : run ? "Local" : "None";
  selectedBoardPin.textContent = run ? (isRunPinned(run.id) ? "Unpin" : "Pin") : "Pin";
  selectedBoardPin.disabled = !run;
  selectedBoardSummary.innerHTML = "";
  selectedBoardComparison.innerHTML = "";

  const rows: Record<string, string | number> = run
    ? {
        player: run.playerName,
        mode: run.mode.toUpperCase(),
        time: `${(run.survivalMs / 1000).toFixed(1)}s`,
        score: run.score.toLocaleString(),
        kills: run.kills,
        seed: run.seed,
      }
    : {
        player: "None",
        mode: "None",
        time: "-",
        score: "-",
        kills: "-",
        seed: "-",
      };

  for (const [label, value] of Object.entries(rows)) {
    const item = document.createElement("div");
    item.className = "debug-stat";
    item.innerHTML = `<span class="block uppercase tracking-wider text-slate-500">${label}</span><strong class="block truncate text-white">${escapeHtml(String(value))}</strong>`;
    selectedBoardSummary.append(item);
  }

  renderRunComparisonGrid(selectedBoardComparison, run);
}

function renderRunComparisonGrid(container: HTMLElement, run: RunRecord | null) {
  container.innerHTML = "";
  const rows: Array<[string, string]> = run
    ? [
        ["vs survival", formatDelta(run.survivalMs, currentRecords.bestSurvivalMs)],
        ["vs score", formatDelta(run.score, currentRecords.bestScore)],
        ["vs kills", formatDelta(run.kills, currentRecords.bestKills)],
        ["vs threat", formatDelta(run.maxThreatLevel, currentRecords.bestThreat)],
      ]
    : [
        ["vs survival", "-"],
        ["vs score", "-"],
        ["vs kills", "-"],
        ["vs threat", "-"],
      ];

  for (const [label, value] of rows) {
    const item = document.createElement("div");
    item.className = "debug-stat";
    item.innerHTML = `<span class="block uppercase tracking-wider text-slate-500">${label}</span><strong class="block truncate text-white">${escapeHtml(value)}</strong>`;
    container.append(item);
  }
}

function filterRuns(runs: RunRecord[]): RunRecord[] {
  if (!runSearchValue) return runs;
  return runs.filter((run) => matchesRunSearch(run));
}

function sortRunsForView(runs: RunRecord[]): RunRecord[] {
  const copy = [...runs];
  switch (runSortValue) {
    case "newest":
      return copy.sort((a, b) => {
        const aTime = Date.parse(a.createdAt || "");
        const bTime = Date.parse(b.createdAt || "");
        if (bTime !== aTime) return bTime - aTime;
        return compareLocalRuns(a, b);
      });
    case "score":
      return sortPinnedThen(copy, (a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.survivalMs !== a.survivalMs) return b.survivalMs - a.survivalMs;
        return b.kills - a.kills;
      });
    case "kills":
      return sortPinnedThen(copy, (a, b) => {
        if (b.kills !== a.kills) return b.kills - a.kills;
        if (b.score !== a.score) return b.score - a.score;
        return b.survivalMs - a.survivalMs;
      });
    case "survival":
      return sortPinnedThen(copy, (a, b) => {
        if (b.survivalMs !== a.survivalMs) return b.survivalMs - a.survivalMs;
        if (b.score !== a.score) return b.score - a.score;
        return b.kills - a.kills;
      });
    case "best":
    default:
      return sortRunsWithPinned(copy);
  }
}

function sortPinnedThen(runs: RunRecord[], compare: (a: RunRecord, b: RunRecord) => number): RunRecord[] {
  const pinned = new Set(readPinnedRunIds());
  return [...runs].sort((a, b) => {
    const aPinned = pinned.has(a.id);
    const bPinned = pinned.has(b.id);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return compare(a, b);
  });
}

function compareLocalRuns(a: RunRecord, b: RunRecord): number {
  if (b.survivalMs !== a.survivalMs) return b.survivalMs - a.survivalMs;
  if (b.score !== a.score) return b.score - a.score;
  return b.kills - a.kills;
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function matchesRunSearch(run: RunRecord): boolean {
  const filter = runSearchValue;
  if (!filter) return true;
  const haystack = [
    run.id,
    run.playerName,
    run.mode,
    run.seed,
    run.score.toString(),
    run.kills.toString(),
    run.maxThreatLevel.toString(),
    `${(run.survivalMs / 1000).toFixed(1)}s`,
  ].join(" ").toLowerCase();
  return haystack.includes(filter);
}

function renderAchievementsPanel() {
  const achievementDefs = listAchievements();
  const unlocked = Object.values(currentAchievements.unlocked).filter(Boolean).length;
  achievementsCount.textContent = `${unlocked}/${achievementDefs.length}`;
  achievementsSummary.textContent = formatAchievementsSummary(currentAchievements);
  achievementsList.innerHTML = "";

  for (const achievement of achievementDefs) {
    const unlockedAt = currentAchievements.unlocked[achievement.id];
    const item = document.createElement("li");
    item.className = unlockedAt
      ? "rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-3 text-sm text-emerald-100"
      : "rounded-md border border-line bg-slate-950/60 px-3 py-3 text-sm text-slate-400";
    item.innerHTML = `
      <strong class="block truncate ${unlockedAt ? "text-emerald-100" : "text-white"}">${escapeHtml(achievement.title)}</strong>
      <span class="mt-1 block text-xs leading-5 ${unlockedAt ? "text-emerald-200/80" : "text-slate-500"}">${escapeHtml(achievement.description)}</span>
    `;
    achievementsList.append(item);
  }
}

function renderSyncStatusPanel() {
  const pending = getPendingRuns();
  const online = navigator.onLine;
  syncStatusPill.textContent = online ? "Online" : "Offline";
  syncStatusSummary.textContent = online
    ? "Local runs will sync automatically when the network is available."
    : "Runs are saved locally and will sync after reconnecting.";

  syncStatusStats.innerHTML = "";
  const stats: Record<string, string | number> = {
    pending: pending.length,
    localRuns: readRuns().length,
    archive: readTelemetryArchive().length,
    network: online ? "ready" : "blocked",
  };

  for (const [label, value] of Object.entries(stats)) {
    const stat = document.createElement("div");
    stat.className = "debug-stat";
    stat.innerHTML = `<span class="block uppercase tracking-wider text-slate-500">${label}</span><strong class="block truncate text-white">${escapeHtml(String(value))}</strong>`;
    syncStatusStats.append(stat);
  }
}

function applyPreferenceControls() {
  currentPreferences = updatePreferences({
    soundVolume: Number(prefsVolume.value),
    screenShake: prefsScreenShake.checked,
    screenShakeStrength: Number(prefsScreenShakeStrength.value),
    reducedMotion: prefsReducedMotion.checked,
    highContrast: prefsHighContrast.checked,
    combatText: prefsCombatText.checked,
  });
  currentSettingsPreset = "custom";
  writeSelectedSettingsPreset("custom");
  applyPreferencesToUi(currentPreferences);
  renderSettingsPresetPanel();
}

function applyPreferencesToUi(state: PreferencesState) {
  prefsVolume.value = String(state.soundVolume);
  prefsVolumeValue.textContent = `${Math.round(state.soundVolume * 100)}%`;
  prefsScreenShake.checked = state.screenShake;
  prefsScreenShakeStrength.value = String(state.screenShakeStrength);
  prefsScreenShakeStrengthValue.textContent = `${state.screenShakeStrength.toFixed(1)}x`;
  prefsReducedMotion.checked = state.reducedMotion;
  prefsHighContrast.checked = state.highContrast;
  prefsCombatText.checked = state.combatText;
  preferencesSummary.textContent = formatPreferencesSummary(state);
}

function renderSettingsPresetPanel() {
  settingsPresetSummary.textContent = formatSettingsPresetSummary(currentSettingsPreset, currentPreferences);
  settingsPresetList.innerHTML = "";

  const buttons: Array<{ id: SettingsPresetId; label: string; active: boolean }> = [
    ...SETTINGS_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.title,
      active: currentSettingsPreset === preset.id,
    })),
    {
      id: "custom",
      label: "Custom",
      active: currentSettingsPreset === "custom",
    },
  ];

  for (const item of buttons) {
    const button = document.createElement("button");
    button.className = item.active ? "btn-primary px-3 py-2 text-left" : "btn-secondary px-3 py-2 text-left";
    button.textContent = item.label;
    button.addEventListener("click", () => {
      if (item.id === "custom") {
        currentSettingsPreset = "custom";
        writeSelectedSettingsPreset("custom");
        renderSettingsPresetPanel();
        return;
      }
      currentPreferences = applySettingsPreset(item.id);
      currentSettingsPreset = item.id;
      applyPreferencesToUi(currentPreferences);
      renderSettingsPresetPanel();
      profileBackup.value = JSON.stringify(exportProfileBackup(), null, 2);
    });
    settingsPresetList.append(button);
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } finally {
    renderFullscreenUi();
  }
}

function renderFullscreenUi() {
  const active = Boolean(document.fullscreenElement);
  fullscreenSummary.textContent = active ? "Fullscreen mode active." : "Windowed mode.";
  fullscreenToggle.textContent = active ? "Exit Fullscreen" : "Fullscreen";
}

function beginKeybindCapture(action: KeybindAction) {
  pendingKeybindAction = action;
  keybindsSummary.textContent = `Press a key for ${action}.`;
}

function renderKeybindsPanel() {
  bindUp.textContent = `Up: ${currentKeybinds.moveUp}`;
  bindDown.textContent = `Down: ${currentKeybinds.moveDown}`;
  bindLeft.textContent = `Left: ${currentKeybinds.moveLeft}`;
  bindRight.textContent = `Right: ${currentKeybinds.moveRight}`;
  bindDash.textContent = `Dash: ${currentKeybinds.dash}`;
  keybindsSummary.textContent = pendingKeybindAction
    ? `Press a key for ${pendingKeybindAction}.`
    : formatKeybindSummary(currentKeybinds);
}

function togglePause() {
  if (runPaused) {
    resumeRun();
    return;
  }
  pauseRun();
}

function pauseRun() {
  const scene = getGameScene();
  if (!scene || runPaused) return;
  scene.pauseRun();
  runPaused = true;
  renderPauseSnapshot();
  show(pauseScreen);
}

function resumeRun() {
  const scene = getGameScene();
  if (!scene || !runPaused) return;
  scene.resumeRun();
  runPaused = false;
  hide(pauseScreen);
}

function renderRunSummary(run: RunSummary) {
  runSummary.innerHTML = "";
  const rows: Record<string, string | number> = {
    damage: run.playerDamage ?? 1,
    projectiles: run.playerProjectiles ?? 1,
    fireRate: `${run.playerFireRate ?? 0}ms`,
    pierce: run.playerPierce ?? 0,
    projectileSpeed: run.playerProjectileSpeed ?? 0,
    shots: run.shotsFired ?? 0,
    accuracy: `${((run.shotAccuracy ?? 0) * 100).toFixed(0)}%`,
    upgrades: run.upgradesTaken ?? 0,
    bosses: run.bossesDefeated ?? 0,
    maxHp: run.maxHealth ?? 0,
    moveSpeed: run.speed ?? 0,
    threatPeak: run.finalThreat ?? run.maxThreatLevel,
  };

  for (const [label, value] of Object.entries(rows)) {
    const item = document.createElement("div");
    item.className = "debug-stat";
    item.innerHTML = `<span class="block uppercase tracking-wider text-slate-500">${label}</span><strong class="block truncate text-white">${escapeHtml(String(value))}</strong>`;
    runSummary.append(item);
  }
}

function renderRunStyle(run: RunSummary) {
  const style = describeRunStyle(run);
  runStyle.textContent = `${style.title} · ${style.note}`;
}

function renderRunDamage(run: RunSummary) {
  runDamage.innerHTML = "";
  const rows: Record<string, string | number> = {
    total: run.damageTaken ?? 0,
    attrition: run.damageAttrition ?? 0,
    burst: run.damageBurst ?? 0,
    cornered: run.damageCornered ?? 0,
    boss: run.damageBossContact ?? 0,
  };

  for (const [label, value] of Object.entries(rows)) {
    const item = document.createElement("div");
    item.className = "debug-stat";
    item.innerHTML = `<span class="block uppercase tracking-wider text-slate-500">${label}</span><strong class="block truncate text-white">${escapeHtml(String(value))}</strong>`;
    runDamage.append(item);
  }
}

function renderRunUpgradePath(run: RunSummary) {
  runUpgradePath.innerHTML = "";
  const path = run.upgradePath || [];
  if (path.length === 0) {
    const item = document.createElement("li");
    item.className = "rounded-full border border-line bg-slate-950/70 px-3 py-2 text-slate-400";
    item.textContent = "No upgrades taken";
    runUpgradePath.append(item);
    return;
  }

  for (const upgrade of path) {
    const item = document.createElement("li");
    item.className = "rounded-full border border-pulse/40 bg-slate-900/80 px-3 py-2 text-slate-100";
    item.textContent = upgrade;
    runUpgradePath.append(item);
  }
}

function renderRunAdvice(run: RunSummary) {
  const advice = getRunAdvice(run);
  runAdvice.textContent = advice;
}

function renderRunBreakdown(run: RunSummary) {
  runBreakdown.innerHTML = "";
  const breakdown = getBuildBreakdown(run);
  for (const [label, value] of Object.entries(breakdown)) {
    const item = document.createElement("div");
    item.className = "debug-stat";
    item.innerHTML = `<span class="block uppercase tracking-wider text-slate-500">${label}</span><strong class="block truncate text-white">${escapeHtml(value)}</strong>`;
    runBreakdown.append(item);
  }
}

function renderRunComparison(run: RunSummary, previous: RecordsState) {
  runComparison.innerHTML = "";
  const rows: Array<[string, string | number]> = [
    ["vs survival", formatDelta(run.survivalMs, previous.bestSurvivalMs)],
    ["vs score", formatDelta(run.score, previous.bestScore)],
    ["vs kills", formatDelta(run.kills, previous.bestKills)],
    ["vs threat", formatDelta(run.maxThreatLevel, previous.bestThreat)],
  ];

  for (const [label, value] of rows) {
    const item = document.createElement("div");
    item.className = "debug-stat";
    item.innerHTML = `<span class=\"block uppercase tracking-wider text-slate-500\">${label}</span><strong class=\"block truncate text-white\">${escapeHtml(String(value))}</strong>`;
    runComparison.append(item);
  }
}

function refreshDailySeedUi() {
  dailySeedPreview.textContent = dailySeed();
}

function formatDelta(current: number, best: number): string {
  const delta = current - best;
  const sign = delta > 0 ? "+" : "";
  const suffix = Math.abs(best) >= 1000 || Math.abs(current) >= 1000 ? "" : "";
  return `${current.toLocaleString()} (${sign}${delta.toLocaleString()})${suffix}`;
}

function renderPauseSnapshot() {
  const hud = currentHudState;
  pauseTime.textContent = hud ? `${(hud.timeMs / 1000).toFixed(1)}s` : "0.0s";
  pauseScore.textContent = hud ? Math.floor(hud.score).toString() : "0";
  pauseThreat.textContent = hud ? hud.threat.toString() : "1";
  pauseHp.textContent = hud ? hud.health.toString() : "3";
  if (currentBossHudState?.active) {
    pauseBoss.textContent = `${currentBossHudState.name} · Phase ${currentBossHudState.phase} · ${Math.max(0, Math.min(100, Math.round((currentBossHudState.hp / currentBossHudState.maxHp) * 100)))}%`;
  } else {
    pauseBoss.textContent = "none";
  }
  pauseDangerLabel.textContent = dangerHistory.length > 0 ? dangerHistory[dangerHistory.length - 1].toFixed(1) : "0.0";
  pauseDangerTrace.innerHTML = "";
  const max = Math.max(1, ...dangerHistory, 1);
  for (const value of dangerHistory.slice(-8)) {
    const bar = document.createElement("span");
    bar.className = "block rounded-sm bg-pulse/80";
    bar.style.height = `${Math.max(8, Math.round((value / max) * 100))}%`;
    pauseDangerTrace.append(bar);
  }
  while (pauseDangerTrace.childElementCount < 8) {
    const bar = document.createElement("span");
    bar.className = "block rounded-sm bg-slate-800/70";
    bar.style.height = "8%";
    pauseDangerTrace.append(bar);
  }
}

function showTutorial() {
  tutorialDontShow.checked = !currentTutorial.seen;
  refreshTutorialUi();
  show(tutorialScreen);
}

function renderTelemetryArchive() {
  const entries = telemetryFilterValue
    ? currentTelemetryArchive.filter((entry) => matchesTelemetryEntry(entry, telemetryFilterValue))
    : currentTelemetryArchive;
  const selected = getSelectedTelemetryEntry(entries);
  telemetryArchiveCount.textContent = `${entries.length} log${entries.length === 1 ? "" : "s"}`;
  telemetryArchiveSummary.textContent = entries.length > 0
    ? `${formatTelemetryArchiveEntry(selected || entries[0])}${telemetryFilterValue ? ` · filter "${telemetryFilterValue}"` : ""}`
    : "The latest completed telemetry run is saved locally for review.";
  telemetryArchiveList.innerHTML = "";

  if (entries.length === 0) {
    const item = document.createElement("li");
    item.className = "rounded-md border border-line bg-slate-950/60 px-3 py-4 text-sm text-slate-400";
    item.textContent = telemetryFilterValue ? "No telemetry logs match the filter." : "No telemetry logs saved yet.";
    telemetryArchiveList.append(item);
    return;
  }

  entries.slice(0, 3).forEach((entry) => {
    const item = document.createElement("li");
    const selected = selectedTelemetryRunId === entry.runId;
    item.className = selected
      ? "rounded-md border border-pulse bg-slate-900/90 px-3 py-3 text-sm text-slate-100"
      : "rounded-md border border-line bg-slate-950/60 px-3 py-3 text-sm text-slate-300";
    item.dataset.telemetryRunId = entry.runId;
    item.innerHTML = `
      <strong class="block truncate text-white">${escapeHtml(entry.runId)}</strong>
      <span class="mt-1 block text-xs leading-5 text-slate-400">${escapeHtml(formatTelemetryArchiveEntry(entry))}</span>
    `;
    telemetryArchiveList.append(item);
  });
}

function renderTelemetryTimeline() {
  const entries = telemetryFilterValue
    ? currentTelemetryArchive.filter((item) => matchesTelemetryEntry(item, telemetryFilterValue))
    : currentTelemetryArchive;
  const entry = getSelectedTelemetryEntry(entries);
  if (!entry) {
    telemetryTimelineCount.textContent = "0 lines";
    telemetryTimelineSummary.textContent = "The latest telemetry run is summarized into readable snapshots.";
    telemetryTimelineList.innerHTML = `<li class="rounded-md border border-line bg-slate-950/60 px-3 py-4 text-sm text-slate-400">${telemetryFilterValue ? "No telemetry timeline matches the filter." : "No telemetry timeline yet."}</li>`;
    return;
  }

  const lines = entry.logText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => (line.includes("SNAP") || line.includes("EVENT")) && (!telemetryFilterValue || line.toLowerCase().includes(telemetryFilterValue)));
  const slice = lines.slice(-6);
  telemetryTimelineCount.textContent = `${slice.length} lines`;
  telemetryTimelineSummary.textContent = `${selectedTelemetryRunId === entry.runId ? "Selected run" : "Latest run"}: ${formatTelemetryArchiveEntry(entry)}${telemetryFilterValue ? ` · filter "${telemetryFilterValue}"` : ""}`;
  telemetryTimelineList.innerHTML = "";

  if (slice.length === 0) {
    const empty = document.createElement("li");
    empty.className = "rounded-md border border-line bg-slate-950/60 px-3 py-4 text-sm text-slate-400";
    empty.textContent = telemetryFilterValue ? "Telemetry run has no matching snapshots." : "Telemetry run has no readable snapshots yet.";
    telemetryTimelineList.append(empty);
    return;
  }

  for (const line of slice) {
    const item = document.createElement("li");
    item.className = "rounded-md border border-line bg-slate-950/60 px-3 py-3 text-xs leading-5 text-slate-300";
    item.textContent = line;
    telemetryTimelineList.append(item);
  }
}

function renderRunFeed() {
  const entries = telemetryFilterValue
    ? currentTelemetryArchive.filter((item) => matchesTelemetryEntry(item, telemetryFilterValue))
    : currentTelemetryArchive;
  const entry = getSelectedTelemetryEntry(entries);
  if (!entry) {
    runFeedCount.textContent = "0 events";
    runFeedSummary.textContent = "Major run milestones from the latest saved telemetry log.";
    runFeedList.innerHTML = `<li class="rounded-md border border-line bg-slate-950/60 px-3 py-4 text-sm text-slate-400">${telemetryFilterValue ? "No event feed matches the filter." : "No event feed yet."}</li>`;
    return;
  }

  const events = entry.logText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("EVENT") && (!telemetryFilterValue || line.toLowerCase().includes(telemetryFilterValue)))
    .map((line) => formatTelemetryEventLine(line))
    .filter((line): line is string => Boolean(line));

  const slice = events.slice(-8);
  runFeedCount.textContent = `${slice.length} event${slice.length === 1 ? "" : "s"}`;
  runFeedSummary.textContent = `${selectedTelemetryRunId === entry.runId ? "Selected run" : "Latest run"}: ${formatTelemetryArchiveEntry(entry)}${telemetryFilterValue ? ` · filter "${telemetryFilterValue}"` : ""}`;
  runFeedList.innerHTML = "";

  if (slice.length === 0) {
    const empty = document.createElement("li");
    empty.className = "rounded-md border border-line bg-slate-950/60 px-3 py-4 text-sm text-slate-400";
    empty.textContent = telemetryFilterValue ? "No readable events match the filter." : "No readable events yet.";
    runFeedList.append(empty);
    return;
  }

  for (const event of slice) {
    const item = document.createElement("li");
    item.className = "rounded-md border border-line bg-slate-950/60 px-3 py-3 text-xs leading-5 text-slate-300";
    item.textContent = event;
    runFeedList.append(item);
  }
}

function matchesTelemetryEntry(entry: TelemetryArchiveEntry, filter: string): boolean {
  if (!filter) return true;
  return entry.runId.toLowerCase().includes(filter)
    || entry.seed.toLowerCase().includes(filter)
    || entry.mode.toLowerCase().includes(filter)
    || entry.logText.toLowerCase().includes(filter)
    || Object.entries(entry.summary || {}).some(([key, value]) => `${key} ${value}`.toLowerCase().includes(filter));
}

function getSelectedTelemetryEntry(entries: TelemetryArchiveEntry[]): TelemetryArchiveEntry | null {
  if (entries.length === 0) return null;
  if (selectedTelemetryRunId) {
    const selected = entries.find((entry) => entry.runId === selectedTelemetryRunId);
    if (selected) return selected;
  }
  selectedTelemetryRunId = entries[0].runId;
  return entries[0];
}

function formatTelemetryEventLine(line: string): string | null {
  const match = line.match(/^\[(?<time>[^\]]+)\]\s+EVENT\s+(?<type>\S+)(?<rest>.*)$/);
  if (!match?.groups) return null;
  const time = match.groups.time.trim();
  const type = match.groups.type.trim();
  const rest = match.groups.rest.trim();
  const data: Record<string, string> = {};
  for (const part of rest.split(" ").map((value) => value.trim()).filter(Boolean)) {
    const [key, ...values] = part.split("=");
    if (!key || values.length === 0) continue;
    data[key] = values.join("=");
  }

  if (type === "boss-spawn") {
    return `${time} Boss spawned ${describeBossEvent(data)}`;
  }
  if (type === "boss-phase") {
    return `${time} Boss phase ${data.phase ?? "?"}`;
  }
  if (type === "boss-defeat") {
    return `${time} Boss defeated${data.durationMs ? ` in ${Math.round(Number(data.durationMs) / 1000)}s` : ""}`;
  }
  if (type === "upgrade-picked") {
    return `${time} Upgrade taken ${data.upgrade ?? ""}`.trim();
  }
  if (type === "pickup") {
    return `${time} Pickup collected`;
  }
  if (type === "damage") {
    return `${time} Player hit`;
  }
  if (type === "dash") {
    return `${time} Dash used`;
  }
  return `${time} ${type.replace(/-/g, " ")}`;
}

function describeBossEvent(data: Record<string, string>): string {
  const bossId = data.bossId ? Number(data.bossId) : 0;
  const names: Record<number, string> = { 1: "Vector Regent", 2: "Lane Warden", 3: "Apex Engine" };
  const name = names[bossId] || `Boss ${bossId || "?"}`;
  const apex = data.finalApex === "true" ? "final apex" : "";
  return [name, apex].filter(Boolean).join(" ");
}

function formatBossPattern(patternId: string): string {
  const suffix = patternId.split("-").slice(2).join("-");
  return suffix.replace(/-/g, " ");
}

async function syncNow() {
  syncStatusPill.textContent = "Syncing";
  syncStatusSummary.textContent = "Trying to sync pending runs now.";
  await syncPendingRuns();
  renderSyncStatusPanel();
  showToast("Sync complete.", "success");
}

function resetAllLocalData() {
  const ok = window.confirm("Reset all local progress, settings, telemetry, and run history?");
  if (!ok) return;

  [
    "storm_progression_v1",
    "storm_preferences_v1",
    "storm_records_v1",
    "storm_achievements_v1",
    "storm_tutorial_seen_v1",
    "storm_keybinds_v1",
    "storm_runs_v1",
    "storm_pinned_runs_v1",
    "storm_run_search_v1",
    "storm_run_sort_v1",
    "storm_telemetry_filter_v1",
    "storm_telemetry_archive_v1",
    "storm_checkpoint_v1",
    "storm_player_name_v1",
  ].forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  });

  currentProgression = readProgression();
  currentPreferences = readPreferences();
  currentSettingsPreset = readSelectedSettingsPreset();
  currentRecords = readRecords();
  currentAchievements = readAchievements();
  currentKeybinds = readKeybinds();
  currentTelemetryArchive = readTelemetryArchive();
  currentTutorial = readTutorialState();
  selectedTelemetryRunId = null;
  telemetryFilterValue = "";
  runSearchValue = "";
  runSortValue = "best";
  playerNameInput.value = getSavedName();
  telemetryFilter.value = "";
  runSearch.value = "";
  runSort.value = "best";
  applyPreferencesToUi(currentPreferences);
  renderSettingsPresetPanel();
  renderProgressionPanel();
  renderRecordsPanel();
  renderRecentRunsPanel();
  renderAchievementsPanel();
  renderSyncStatusPanel();
  renderTelemetryTimeline();
  renderTelemetryArchive();
  refreshTutorialUi();
  renderKeybindsPanel();
  refreshCheckpointUi();
  profileBackup.value = JSON.stringify(exportProfileBackup(), null, 2);
  renderBackupSavedAt(new Date().toISOString());
  profileBackupStatus.textContent = "All local data reset.";
}

function shouldAutoPause(): boolean {
  if (!getGameScene() || runPaused) return false;
  if (upgradeScreen.classList.contains("hidden") === false || tutorialScreen.classList.contains("hidden") === false || gameOver.classList.contains("hidden") === false || menu.classList.contains("hidden") === false) {
    return false;
  }
  return true;
}

function syncProfileFromStorage() {
  currentProgression = readProgression();
  currentPreferences = readPreferences();
  currentSettingsPreset = readSelectedSettingsPreset();
  currentRecords = readRecords();
  currentAchievements = readAchievements();
  currentKeybinds = readKeybinds();
  currentTutorial = readTutorialState();
  currentTelemetryArchive = readTelemetryArchive();
  telemetryFilterValue = readStoredText(TELEMETRY_FILTER_KEY);
  runSearchValue = readStoredText(RUN_SEARCH_KEY);
  runSortValue = readStoredText(RUN_SORT_KEY) || "best";
  selectedTelemetryRunId = null;
  playerNameInput.value = getSavedName();
  telemetryFilter.value = telemetryFilterValue;
  runSearch.value = runSearchValue;
  runSort.value = runSortValue;
  applyPreferencesToUi(currentPreferences);
  renderSettingsPresetPanel();
  renderProgressionPanel();
  renderRecordsPanel();
  renderRecentRunsPanel();
  renderAchievementsPanel();
  renderSyncStatusPanel();
  renderTelemetryTimeline();
  renderTelemetryArchive();
  refreshTutorialUi();
  renderKeybindsPanel();
  profileBackup.value = JSON.stringify(exportProfileBackup(), null, 2);
  renderBackupSavedAt(new Date().toISOString());
}

function refreshTutorialUi() {
  tutorialDontShow.checked = !currentTutorial.seen;
  tutorialSummary.textContent = formatTutorialSummary(currentTutorial);
}

function renderBackupSavedAt(savedAt?: string) {
  profileBackupSavedAt.textContent = savedAt ? `Last saved: ${new Date(savedAt).toLocaleString()}` : "Last saved: never";
}

async function copyLatestTelemetryLog() {
  const entry = getSelectedTelemetryEntry(getFilteredTelemetryEntries());
  if (!entry) return;
  try {
    await navigator.clipboard.writeText(entry.logText);
    telemetryArchiveSummary.textContent = telemetryFilterValue ? "Filtered telemetry log copied." : "Latest telemetry log copied.";
    showToast(telemetryFilterValue ? "Filtered telemetry log copied." : "Latest telemetry log copied.", "success");
  } catch {
    telemetryArchiveSummary.textContent = entry.logText;
    showToast("Telemetry log copy failed.", "error");
  }
}

function downloadLatestTelemetryLog() {
  const entry = getSelectedTelemetryEntry(getFilteredTelemetryEntries());
  if (!entry) return;
  const blob = new Blob([entry.logText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = telemetryFilterValue ? `${entry.runId}.filtered.log` : `${entry.runId}.log`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast(telemetryFilterValue ? "Filtered telemetry log downloaded." : "Latest telemetry log downloaded.", "success");
}

function showToast(message: string, tone: "info" | "success" | "error" = "info") {
  const toast = document.createElement("div");
  const toneClass = tone === "success"
    ? "border-emerald-400/40 bg-emerald-950/95 text-emerald-100"
    : tone === "error"
      ? "border-rose-400/40 bg-rose-950/95 text-rose-100"
      : "border-line bg-slate-950/95 text-slate-100";
  toast.className = `pointer-events-auto rounded-md border px-3 py-2 text-sm font-semibold shadow-2xl backdrop-blur ${toneClass}`;
  toast.textContent = message;
  const id = ++toastId;
  toast.dataset.toastId = String(id);
  toastStack.prepend(toast);
  window.setTimeout(() => {
    const current = toastStack.querySelector(`[data-toast-id="${id}"]`);
    if (current) current.remove();
  }, 2600);
}

function buildReplayLink(run: Pick<RunSummary, "mode" | "seed">) {
  const url = new URL(window.location.href);
  url.searchParams.set("autorun", "1");
  url.searchParams.set("mode", run.mode);
  url.searchParams.set("seed", run.seed);
  url.searchParams.set("maxMs", "300000");
  return url.toString();
}

function buildRunLink(run: Pick<RunRecord, "mode" | "seed">) {
  return buildReplayLink(run);
}

function buildRunReport(run: RunSummary): string {
  const style = describeRunStyle(run);
  const lines = [
    `mode: ${run.mode}`,
    `seed: ${run.seed}`,
    `survival: ${(run.survivalMs / 1000).toFixed(1)}s`,
    `score: ${run.score}`,
    `kills: ${run.kills}`,
    `threat: ${run.maxThreatLevel}`,
    `shots: ${run.shotsFired ?? 0}`,
    `accuracy: ${((run.shotAccuracy ?? 0) * 100).toFixed(0)}%`,
    `upgrades: ${run.upgradesTaken ?? 0}`,
    `bosses: ${run.bossesDefeated ?? 0}`,
    `buildStyle: ${style.title}`,
    `buildNote: ${style.note}`,
    `damageTaken: ${run.damageTaken ?? 0}`,
    `damageAttrition: ${run.damageAttrition ?? 0}`,
    `damageBurst: ${run.damageBurst ?? 0}`,
    `damageCornered: ${run.damageCornered ?? 0}`,
    `damageBossContact: ${run.damageBossContact ?? 0}`,
    `upgradePath: ${(run.upgradePath || []).join(" > ") || "none"}`,
    `advice: ${getRunAdvice(run)}`,
    `breakdown: ${Object.entries(getBuildBreakdown(run)).map(([label, value]) => `${label}=${value}`).join(" ")}`,
    `build: dmg=${run.playerDamage ?? 0} proj=${run.playerProjectiles ?? 0} rate=${run.playerFireRate ?? 0} pierce=${run.playerPierce ?? 0} speed=${run.playerProjectileSpeed ?? 0}`,
  ];
  return lines.join("\n");
}

function getBuildBreakdown(run: RunSummary): Record<string, string> {
  const damage = run.playerDamage ?? 1;
  const projectiles = run.playerProjectiles ?? 1;
  const fireRate = run.playerFireRate ?? 0;
  const pierce = run.playerPierce ?? 0;
  const speed = run.speed ?? 0;
  const health = run.maxHealth ?? 3;
  const pickup = (run.upgradePath || []).some((entry) => /Collector|Vacuum|Patch/.test(entry));

  const offense = damage >= 5 || projectiles >= 4 || fireRate <= 140
    ? "High"
    : damage >= 3 || projectiles >= 2
      ? "Mid"
      : "Low";
  const mobility = speed >= 300 || (run.upgradePath || []).some((entry) => /Thrusters|Blink/.test(entry))
    ? "High"
    : speed >= 250
      ? "Mid"
      : "Low";
  const defense = health >= 5 || (run.damageTaken ?? 0) <= 2
    ? "High"
    : health >= 4
      ? "Mid"
      : "Low";
  const utility = pickup || pierce >= 2
    ? "High"
    : pierce > 0
      ? "Mid"
      : "Low";

  return { offense, mobility, defense, utility };
}

function getRunAdvice(run: RunSummary): string {
  const damageTaken = run.damageTaken ?? 0;
  const bosses = run.bossesDefeated ?? 0;
  const projectiles = run.playerProjectiles ?? 1;
  const fireRate = run.playerFireRate ?? 0;
  const speed = run.speed ?? 0;
  const upgradePath = run.upgradePath || [];

  if (damageTaken >= 6 && (run.damageBurst ?? 0) >= damageTaken / 2) {
    return "You are taking too many burst hits. Prioritize projectile count, pierce, and a safer route through open lanes.";
  }
  if ((run.damageCornered ?? 0) > (run.damageAttrition ?? 0)) {
    return "Corner pressure is the issue. Faster movement or more pickup range will help you stay out of dead lanes.";
  }
  if (bosses > 0 && fireRate > 180 && projectiles <= 2) {
    return "Boss damage is low. Add fire rate or projectile count earlier so boss phases collapse faster.";
  }
  if (upgradePath.length > 0 && !upgradePath.includes("Repair Kit") && !upgradePath.includes("Patch Job") && (run.maxHealth ?? 3) <= 3) {
    return "This build is fragile. Mix in one health or heal pick before threat climbs again.";
  }
  if (speed < 300 && projectiles >= 4) {
    return "Your damage is ahead of your movement. Use one speed or dash upgrade to keep the build safe.";
  }
  return "Balanced build. Keep steering toward either cleaner damage or more movement, but not both at the expense of survivability.";
}

function buildRunRecordReport(run: RunRecord): string {
  const lines = [
    `player: ${run.playerName}`,
    `mode: ${run.mode}`,
    `seed: ${run.seed}`,
    `survival: ${(run.survivalMs / 1000).toFixed(1)}s`,
    `score: ${run.score}`,
    `kills: ${run.kills}`,
    `threat: ${run.maxThreatLevel}`,
    `synced: ${run.synced ? "yes" : "no"}`,
    `pinned: ${isRunPinned(run.id) ? "yes" : "no"}`,
    `id: ${run.id}`,
  ];
  return lines.join("\n");
}

function describeRunStyle(run: RunSummary): { title: string; note: string } {
  const damage = run.playerDamage ?? 1;
  const projectiles = run.playerProjectiles ?? 1;
  const fireRate = run.playerFireRate ?? 0;
  const pierce = run.playerPierce ?? 0;
  const projectileSpeed = run.playerProjectileSpeed ?? 0;
  const speed = run.speed ?? 0;
  const maxHealth = run.maxHealth ?? 0;

  if (projectiles >= 5 || damage >= 4) {
    return {
      title: "Glass Cannon",
      note: "High output and aggressive scaling. Better at clearing waves than soaking pressure.",
    };
  }
  if (maxHealth >= 6 || speed <= 1.1) {
    return {
      title: "Anchor Build",
      note: "Safer and sturdier, with more room to survive bad space control.",
    };
  }
  if (speed >= 2.5 && projectileSpeed <= 700) {
    return {
      title: "Skirmisher",
      note: "Relies on movement and spacing more than raw damage.",
    };
  }
  if (pierce >= 3 || projectileSpeed >= 900 || fireRate <= 150) {
    return {
      title: "Precision Build",
      note: "Covers lanes cleanly and rewards tighter positioning.",
    };
  }

  return {
    title: "Balanced Build",
    note: "Evenly distributed stats and steady survival pressure.",
  };
}

function getFilteredTelemetryEntries(): TelemetryArchiveEntry[] {
  return telemetryFilterValue
    ? currentTelemetryArchive.filter((entry) => matchesTelemetryEntry(entry, telemetryFilterValue))
    : currentTelemetryArchive;
}

function readStoredText(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStoredText(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function readLeaderboardMode(): GameMode {
  try {
    const raw = localStorage.getItem(LEADERBOARD_MODE_KEY);
    return raw === "daily" ? "daily" : "endless";
  } catch {
    return "endless";
  }
}

function writeLeaderboardMode(mode: GameMode): void {
  try {
    localStorage.setItem(LEADERBOARD_MODE_KEY, mode);
  } catch {
    // Ignore storage failures.
  }
}

function refreshCheckpointUi() {
  const checkpoint = readCheckpoint();
  resumeButton.disabled = !checkpoint;
  checkpointSummary.textContent = describeCheckpoint(checkpoint);
}

function createLeaderboardRow(run: RunRecord, index: number) {
  const row = document.createElement("li");
  row.className = "leaderboard-row cursor-pointer";
  row.dataset.boardRunId = run.id;
  const time = (run.survivalMs / 1000).toFixed(1);
  row.innerHTML = `
    <span class="font-black text-pulse">${index + 1}</span>
    <span class="min-w-0">
      <strong class="block truncate text-white">${escapeHtml(run.playerName)}</strong>
      <span class="text-xs text-slate-400">${time}s · ${run.kills} kills</span>
    </span>
    <strong class="text-gold">${run.score.toLocaleString()}</strong>
  `;
  return row;
}

function dailySeed() {
  const date = new Date();
  return `daily-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function show(element: HTMLElement) {
  element.classList.remove("hidden");
}

function hide(element: HTMLElement) {
  element.classList.add("hidden");
}

function showHud() {
  hud.classList.remove("hidden");
  hud.classList.add("grid");
}

function hideHud() {
  hud.classList.add("hidden");
  hud.classList.remove("grid");
}

function hideBossHud() {
  hide(bossHud);
}

function text(id: string, value: string) {
  mustGet(id).textContent = value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

function mustGet(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element;
}

function mustGetButton(id: string): HTMLButtonElement {
  return mustGet(id) as HTMLButtonElement;
}

function mustGetInput(id: string): HTMLInputElement {
  return mustGet(id) as HTMLInputElement;
}

function getAutomationConfig() {
  const active = query.get("autorun") === "1";
  const mode = query.get("mode") === "daily" ? "daily" : "endless";
  const seed = query.get("seed");
  const startMs = Math.max(0, Number(query.get("startMs") || 0));
  const autoplayer = query.get("autoplayer") === "1" || active;
  const sampleIntervalMs = Math.max(100, Number(query.get("sampleMs") || 250));
  const snapshotIntervalMs = Math.max(1000, Number(query.get("snapshotMs") || 3000));
  const maxRunMs = Math.max(1000, Number(query.get("maxMs") || 300000));
  const timeScaleParam = query.get("timeScale");
  const timeScale = timeScaleParam ? Math.max(0.1, Math.min(20, Number(timeScaleParam))) : null;
  return {
    active,
    mode: mode as GameMode,
    seed,
    autoplayer,
    sampleIntervalMs,
    snapshotIntervalMs,
    maxRunMs,
    timeScale,
    startMs,
    runId: query.get("runId") || `${mode}-${seed || Date.now().toString(36)}`,
  };
}

function publishAutomationResult(run: TelemetryRun, complete: boolean) {
  const payload = JSON.stringify(run);
  let output = document.getElementById("telemetry-output");
  if (!output) {
    output = document.createElement("script");
    output.id = "telemetry-output";
    output.setAttribute("type", "application/json");
    document.body.append(output);
  }
  output.textContent = payload;
  window.__stormAutomationResult = run;
  document.documentElement.setAttribute("data-automation-complete", complete ? "true" : "false");
}

declare global {
  interface Window {
    __stormAutomationResult?: TelemetryRun;
  }
}
