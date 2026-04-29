import Phaser from "phaser";
import "./styles.css";
import { playTestSound, unlockAudio } from "./game/audio";
import { GameScene } from "./game/GameScene";
import { ARENA_HEIGHT, ARENA_WIDTH } from "./game/constants";
import { gameEvents, type AutomationCompletePayload, type AutomationSnapshotPayload, type BossHudPayload, type DebugSettings, type DebugStats, type HudPayload, type UpgradeOption } from "./game/events";
import { getLeaderboard, submitRun, syncPendingRuns } from "./services/leaderboard";
import { getSavedName } from "./services/localRuns";
import type { GameMode, LeaderboardResult, RunRecord, RunSummary } from "./types";
import type { TelemetryConfig, TelemetryRun } from "./game/telemetry";

const AUTOPLAYER_KEY = "storm_debug_autoplayer_v1";
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
const bossHealthFill = mustGet("boss-health-fill");
const upgradeScreen = mustGet("upgrade-screen");
const gameOver = mustGet("game-over");
const leaderboardList = mustGet("leaderboard-list");
const leaderboardSource = mustGet("leaderboard-source");
const playButton = mustGetButton("play-button");
const dailyButton = mustGetButton("daily-button");
const submitButton = mustGetButton("submit-button");
const restartButton = mustGetButton("restart-button");
const menuButton = mustGetButton("menu-button");
const playerNameInput = mustGetInput("player-name");
const submitStatus = mustGet("submit-status");
const debugToggle = mustGetButton("debug-toggle");
const debugClose = mustGetButton("debug-close");
const debugPanel = mustGet("debug-panel");
const debugStats = mustGet("debug-stats");

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
let lastRun: RunSummary | null = null;
let currentUpgradeOptions: UpgradeOption[] = [];

if (automationConfig.autoplayer) localStorage.setItem(AUTOPLAYER_KEY, "true");
playerNameInput.value = getSavedName();
debugControls.autoplayer.checked = automationConfig.autoplayer || localStorage.getItem(AUTOPLAYER_KEY) === "true";
if (automationConfig.timeScale !== null) debugControls.timeScale.value = automationConfig.timeScale.toString();

playButton.addEventListener("click", () => startRun("endless"));
dailyButton.addEventListener("click", () => startRun("daily"));
restartButton.addEventListener("click", () => startRun(currentMode));
menuButton.addEventListener("click", showMenu);
submitButton.addEventListener("click", submitCurrentRun);
debugToggle.addEventListener("click", () => debugPanel.classList.toggle("hidden"));
debugClose.addEventListener("click", () => hide(debugPanel));
mustGetButton("debug-apply-time").addEventListener("click", () => getGameScene()?.setElapsedSeconds(Number(debugControls.time.value) || 0));
mustGetButton("debug-clear").addEventListener("click", () => getGameScene()?.clearThreats());
mustGetButton("debug-kill").addEventListener("click", () => getGameScene()?.forceEndRun());
mustGetButton("debug-test-sound").addEventListener("click", async () => {
  const ok = await playTestSound();
  if (!ok) console.warn("Audio did not unlock. Check browser/site sound permissions.");
});
window.addEventListener("online", () => void syncPendingRuns());
window.addEventListener("pointerdown", () => void unlockAudio(), { once: true });
window.addEventListener("keydown", () => void unlockAudio(), { once: true });
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

Object.values(debugControls).forEach((control) => {
  control.addEventListener("input", applyDebugControls);
  control.addEventListener("change", applyDebugControls);
});

gameEvents.addEventListener("hud", (event) => {
  const detail = (event as CustomEvent<HudPayload>).detail;
  text("hud-time", `${(detail.timeMs / 1000).toFixed(1)}s`);
  text("hud-score", Math.floor(detail.score).toString());
  text("hud-threat", detail.threat.toString());
  text("hud-health", detail.health.toString());
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
  text("game-over-status", lastRun.survivalMs >= 60000 ? "Storm survived" : "Run ended");
  text("final-score", lastRun.score.toLocaleString());
  text("final-time", `${(lastRun.survivalMs / 1000).toFixed(1)}s`);
  text("final-kills", `${lastRun.kills} kills`);
  text("final-threat", `Threat ${lastRun.maxThreatLevel}`);
  submitStatus.textContent = "Score saved after submit. Local fallback is always available.";
  submitButton.disabled = false;
  show(gameOver);
  hideHud();
  hideBossHud();
  hide(debugToggle);
  hide(debugPanel);
});

gameEvents.addEventListener("boss-hud", (event) => {
  const detail = (event as CustomEvent<BossHudPayload>).detail;
  if (!detail.active) {
    hideBossHud();
    return;
  }

  bossName.textContent = detail.name;
  bossPhase.textContent = `Phase ${detail.phase}`;
  bossHealthFill.style.width = `${Math.max(0, Math.min(100, (detail.hp / detail.maxHp) * 100))}%`;
  show(bossHud);
});

gameEvents.addEventListener("debug-stats", (event) => {
  const detail = (event as CustomEvent<DebugStats>).detail;
  debugControls.time.value = Math.floor(detail.elapsedMs / 1000).toString();
  renderDebugStats(detail);
});

gameEvents.addEventListener("automation-complete", (event) => {
  const detail = (event as CustomEvent<AutomationCompletePayload>).detail;
  if (!automationConfig.active || !detail.run) return;
  publishAutomationResult(detail.run, true);
});

gameEvents.addEventListener("automation-snapshot", (event) => {
  const detail = (event as CustomEvent<AutomationSnapshotPayload>).detail;
  if (!automationConfig.active) return;
  publishAutomationResult(detail.run, false);
});

void refreshLeaderboard("endless");
if (automationConfig.active) {
  queueMicrotask(() => startRun(automationConfig.mode));
} else if (debugControls.autoplayer.checked) {
  queueMicrotask(() => startRun("endless"));
}

function startRun(mode: GameMode) {
  if (!automationConfig.active) void unlockAudio();
  currentMode = mode;
  lastRun = null;
  hide(menu);
  hide(gameOver);
  hide(upgradeScreen);
  hide(debugPanel);
  show(debugToggle);
  showHud();
  hideBossHud();
  game.scene.start("game", {
    mode,
    seed: automationConfig.seed || (mode === "daily" ? dailySeed() : Date.now().toString(36)),
    debugSettings: getDebugSettingsFromControls(),
    startMs: automationConfig.startMs,
    telemetryConfig: getTelemetryConfig(),
  });
  applyDebugControls();
}

async function showMenu() {
  hide(gameOver);
  hide(upgradeScreen);
  hide(debugToggle);
  hide(debugPanel);
  hideHud();
  hideBossHud();
  show(menu);
  game.scene.stop("game");
  await refreshLeaderboard(currentMode);
}

function chooseUpgrade(id: string) {
  hide(upgradeScreen);
  currentUpgradeOptions = [];
  const scene = game.scene.getScene("game") as GameScene;
  scene.applyUpgrade(id);
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
  renderLeaderboard(result);
  submitStatus.textContent = result.error || `Submitted to ${result.source === "remote" ? "online" : "local"} leaderboard.`;
}

async function refreshLeaderboard(mode: GameMode) {
  renderLeaderboard(await getLeaderboard(mode));
}

function renderLeaderboard(result: LeaderboardResult) {
  leaderboardSource.textContent = result.source === "remote" ? "Online" : "Local";
  leaderboardList.innerHTML = "";

  const rows = result.rows.slice(0, 10);
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "rounded-md border border-line bg-slate-950/60 px-3 py-4 text-sm text-slate-400";
    empty.textContent = "No runs yet.";
    leaderboardList.append(empty);
    return;
  }

  rows.forEach((run, index) => leaderboardList.append(createLeaderboardRow(run, index)));
}

function createLeaderboardRow(run: RunRecord, index: number) {
  const row = document.createElement("li");
  row.className = "leaderboard-row";
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
  const maxRunMs = Math.max(1000, Number(query.get("maxMs") || 90000));
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
