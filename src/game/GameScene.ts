import Phaser from "phaser";
import type { GameMode, RunSummary } from "../types";
import { createArenaBackground, createGameTextures } from "./arena";
import { Autoplayer } from "./autoplayer";
import { playSound } from "./audio";
import { BOSS_RESPAWN_DELAY_MS, Boss1Controller, FIRST_BOSS_AT_MS, SECOND_BOSS_AT_MS, THIRD_BOSS_AT_MS } from "./boss1";
import { ARENA_HEIGHT, ARENA_WIDTH, DEFAULT_DEBUG_SETTINGS, DEFAULT_PLAYER_STATS, TELEMETRY_SAMPLE_INTERVAL_MS, UPGRADE_INTERVAL_MS } from "./constants";
import { applyDebugSettings as mergeDebugSettings } from "./debug";
import { dashTrail, enemyDeathBurst, flashEnemy, pickupCollectBurst, playerHitBurst, upgradePulse } from "./effects";
import { createPickup, firePattern, getEnemyWaveStep, restoreEnemyFromState, spawnEnemyIfReady, updateEnemies } from "./enemies";
import { emitAutomationComplete, emitAutomationSnapshot, emitBossHud, emitDebugStats, emitGameOver, emitHud, emitUpgrade, type DebugSettings, type UpgradeOption } from "./events";
import type { EnemyData } from "./gameTypes";
import { magnetPickups, restorePickup } from "./pickups";
import { firePlayerShot, restoreEnemyBullet, restorePlayerShot, updateProjectiles } from "./projectiles";
import { TelemetryRecorder, toAutoplayerSample, type TelemetryConfig } from "./telemetry";
import { applyUpgrade as applyUpgradeToStats, chooseAutoplayerUpgrade, chooseUpgradeOptions } from "./upgrades";
import { applyProgression, type ProgressionState } from "../services/progression";
import { clearCheckpoint, writeCheckpoint, type CheckpointState } from "../services/checkpoint";
import { readPreferences } from "../services/preferences";
import { DEFAULT_KEYBINDS, normalizeKeyName, type KeybindState } from "../services/keybinds";

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private dashIndicator!: Phaser.GameObjects.Rectangle;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private inputKeys!: Record<string, Phaser.Input.Keyboard.Key>;
  private dashQueued = false;
  private enemies!: Phaser.Physics.Arcade.Group;
  private playerShots!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private pickups!: Phaser.Physics.Arcade.Group;
  private boss: Boss1Controller | null = null;
  private rng!: Phaser.Math.RandomDataGenerator;
  private autoplayer = new Autoplayer();
  private mode: GameMode = "endless";
  private seed = "";
  private elapsedMs = 0;
  private score = 0;
  private kills = 0;
  private health = 3;
  private invulnerableUntil = 0;
  private spawnAt = 0;
  private shootAt = 0;
  private dashAt = 0;
  private dashUntil = 0;
  private dashVector = new Phaser.Math.Vector2(1, 0);
  private lastManualDirection = new Phaser.Math.Vector2(1, 0);
  private pausedForUpgrade = false;
  private pendingUpgradeOptions: UpgradeOption[] | null = null;
  private nextUpgradeAt = UPGRADE_INTERVAL_MS;
  private nextBossAt = FIRST_BOSS_AT_MS;
  private bossEncountersSpawned = 0;
  private finalApexActive = false;
  private maxThreatLevel = 1;
  private debug: DebugSettings = { ...DEFAULT_DEBUG_SETTINGS };
  private stats = { ...DEFAULT_PLAYER_STATS };
  private telemetryConfig: TelemetryConfig = { enabled: false, sampleIntervalMs: TELEMETRY_SAMPLE_INTERVAL_MS, snapshotIntervalMs: 3000, maxRunMs: 0, runId: "", exportToDom: false };
  private telemetry: TelemetryRecorder | null = null;
  private lastFrameMs = 0;
  private activeBossStartedAt: number | null = null;
  private initialElapsedMs = 0;
  private initialProgression: ProgressionState | null = null;
  private resumeCheckpoint: CheckpointState | null = null;
  private keybinds: KeybindState = { ...DEFAULT_KEYBINDS };
  private playerShotsFired = 0;
  private playerShotsHit = 0;
  private upgradesTaken = 0;
  private bossesDefeated = 0;
  private checkpointSaveAt = 0;
  private runEnded = false;

  constructor() {
    super("game");
  }

  init(data: { mode?: GameMode; seed?: string; debugSettings?: Partial<DebugSettings>; telemetryConfig?: Partial<TelemetryConfig>; startMs?: number; progression?: ProgressionState; checkpoint?: CheckpointState; keybinds?: KeybindState }) {
    this.mode = data.mode || "endless";
    this.seed = data.checkpoint?.seed || data.seed || Date.now().toString(36);
    this.initialElapsedMs = data.checkpoint?.elapsedMs ?? Math.max(0, Number(data.startMs || 0));
    this.initialProgression = data.checkpoint?.initialProgression || data.progression || null;
    this.resumeCheckpoint = data.checkpoint || null;
    this.keybinds = data.keybinds ? { ...data.keybinds } : { ...DEFAULT_KEYBINDS };
    this.inputKeys = {} as Record<string, Phaser.Input.Keyboard.Key>;
    this.debug = mergeDebugSettings({ ...DEFAULT_DEBUG_SETTINGS }, data.debugSettings || {});
    this.telemetryConfig = {
      enabled: data.checkpoint?.telemetryConfig.enabled ?? data.telemetryConfig?.enabled ?? false,
      sampleIntervalMs: data.checkpoint?.telemetryConfig.sampleIntervalMs ?? data.telemetryConfig?.sampleIntervalMs ?? TELEMETRY_SAMPLE_INTERVAL_MS,
      snapshotIntervalMs: data.checkpoint?.telemetryConfig.snapshotIntervalMs ?? data.telemetryConfig?.snapshotIntervalMs ?? 3000,
      maxRunMs: data.checkpoint?.telemetryConfig.maxRunMs ?? data.telemetryConfig?.maxRunMs ?? 0,
      runId: data.checkpoint?.telemetryConfig.runId ?? data.telemetryConfig?.runId ?? `${this.mode}-${this.seed}`,
      exportToDom: data.checkpoint?.telemetryConfig.exportToDom ?? data.telemetryConfig?.exportToDom ?? false,
    };
  }

  create() {
    this.resetRunState();
    this.rng = new Phaser.Math.RandomDataGenerator([this.seed]);

    createArenaBackground(this);
    createGameTextures(this);
    this.createGroups();
    this.createPlayer();
    this.createInput();
    this.syncTimeScale();
    this.createCollisions();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

    if (this.resumeCheckpoint) this.restoreCheckpoint(this.resumeCheckpoint);
    else if (this.initialElapsedMs > 0) this.setElapsedSeconds(this.initialElapsedMs / 1000);

    this.telemetry = this.telemetryConfig.enabled
      ? new TelemetryRecorder(this.telemetryConfig.runId, this.seed, this.mode, {
          autoplayer: this.debug.autoplayer,
          sampleIntervalMs: this.telemetryConfig.sampleIntervalMs,
          snapshotIntervalMs: this.telemetryConfig.snapshotIntervalMs,
          maxRunMs: this.telemetryConfig.maxRunMs,
          timeScale: this.debug.timeScale,
        })
      : null;
    this.telemetry?.logEvent(this.elapsedMs, "run-start", { seed: this.seed, mode: this.mode, resumed: Boolean(this.resumeCheckpoint) });

    emitHud(this.getHud());
  }

  update(_time: number, delta: number) {
    if (this.pausedForUpgrade) return;

    const scaledDelta = delta * this.debug.timeScale;
    this.elapsedMs += scaledDelta;
    this.lastFrameMs = delta;
    this.score += scaledDelta / 1000;

    const threat = this.getThreatLevel();
    this.maxThreatLevel = Math.max(this.maxThreatLevel, threat);

    this.movePlayer(delta);
    this.autoShoot();
    this.updateBossFlow(threat);
    if (!this.boss && this.finalApexActive) this.finalApexActive = false;
    if (!this.boss || this.finalApexActive) {
      const phaseId = this.getEnemyPhaseId();
      const reducedFinalApexSpawns = this.finalApexActive && Boolean(this.boss);
      this.spawnAt = spawnEnemyIfReady({
        scene: this,
        enemies: this.enemies,
        rng: this.rng,
        player: this.player,
        elapsedMs: this.elapsedMs,
        elapsedInPhaseMs: this.getEnemyPhaseElapsedMs(),
        phaseId,
        spawnAt: this.spawnAt,
        threat,
        debug: this.debug,
        spawnRateScale: reducedFinalApexSpawns ? 5 : 1,
      });
    }
    updateEnemies({
      scene: this,
      enemies: this.enemies,
      enemyBullets: this.enemyBullets,
      player: this.player,
      elapsedMs: this.elapsedMs,
      threat,
      debug: this.debug,
      rng: this.rng,
    });
    updateProjectiles(this.playerShots);
    updateProjectiles(this.enemyBullets);
    magnetPickups(this.pickups, this.player, this.stats, this.physics, 1);

    if (this.elapsedMs >= this.nextUpgradeAt && !this.boss) this.openUpgradeChoice();
    if (this.telemetryConfig.maxRunMs > 0 && this.elapsedMs >= this.telemetryConfig.maxRunMs) {
      this.endRun("timeout");
      return;
    }

    emitHud(this.getHud());
    this.emitBossState();
    emitDebugStats(this.getDebugStats());
    this.recordTelemetrySample();
    if (this.elapsedMs >= this.checkpointSaveAt) this.saveCheckpoint();
  }

  applyDebugSettings(settings: Partial<DebugSettings>) {
    this.debug = mergeDebugSettings(this.debug, settings);
    this.syncTimeScale();
  }

  setElapsedSeconds(seconds: number) {
    this.elapsedMs = Math.max(0, seconds * 1000);
    this.nextUpgradeAt = Math.max(this.elapsedMs + 1000, Math.ceil(this.elapsedMs / UPGRADE_INTERVAL_MS) * UPGRADE_INTERVAL_MS);
    this.checkpointSaveAt = this.elapsedMs + 2000;
  }

  clearThreats() {
    this.enemies.clear(true, true);
    this.enemyBullets.clear(true, true);
    this.playerShots.clear(true, true);
    this.pickups.clear(true, true);
    if (this.boss) {
      this.boss.destroy();
      this.boss = null;
      this.activeBossStartedAt = null;
      this.finalApexActive = false;
      this.nextBossAt =
        this.bossEncountersSpawned === 1 ? SECOND_BOSS_AT_MS :
          this.bossEncountersSpawned === 2 ? THIRD_BOSS_AT_MS :
            this.elapsedMs + 3000;
      this.emitBossState();
    }
  }

  forceEndRun() {
    this.endRun();
  }

  private resetRunState() {
    this.elapsedMs = 0;
    this.score = 0;
    this.kills = 0;
    this.health = 3;
    this.invulnerableUntil = 0;
    this.spawnAt = 500;
    this.shootAt = 0;
    this.dashAt = 0;
    this.dashUntil = 0;
    this.dashVector.set(1, 0);
    this.lastManualDirection.set(1, 0);
    this.dashQueued = false;
    this.pausedForUpgrade = false;
    this.nextUpgradeAt = UPGRADE_INTERVAL_MS;
    this.nextBossAt = FIRST_BOSS_AT_MS;
    this.bossEncountersSpawned = 0;
    this.finalApexActive = false;
    this.maxThreatLevel = 1;
    this.boss = null;
    this.activeBossStartedAt = null;
    this.playerShotsFired = 0;
    this.playerShotsHit = 0;
    this.upgradesTaken = 0;
    this.bossesDefeated = 0;
    this.checkpointSaveAt = 2000;
    this.runEnded = false;
    this.stats = this.initialProgression ? applyProgression({ ...DEFAULT_PLAYER_STATS }, this.initialProgression) : { ...DEFAULT_PLAYER_STATS };
    this.autoplayer.reset();
  }

  private syncTimeScale() {
    this.time.timeScale = this.debug.timeScale;
    this.tweens.timeScale = this.debug.timeScale;
    this.physics.world.timeScale = 1 / Math.max(0.1, this.debug.timeScale);
  }

  private createGroups() {
    this.enemies = this.physics.add.group();
    this.playerShots = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();
    this.pickups = this.physics.add.group();
  }

  private createPlayer() {
    this.player = this.add.rectangle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 24, 24, 0x5eead4, 1);
    this.player.setStrokeStyle(2, 0xffffff, 0.9);
    this.player.setDepth(1);
    this.dashIndicator = this.add.rectangle(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 8, 8, 0x64748b, 1);
    this.dashIndicator.setStrokeStyle(1, 0xffffff, 0.65);
    this.dashIndicator.setDepth(2);
    this.physics.add.existing(this.player);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setSize(7, 7).setOffset(8.5, 8.5).setCollideWorldBounds(true);
  }

  private createInput() {
    this.inputKeys = this.input.keyboard!.addKeys({
      moveUp: this.keybinds.moveUp,
      moveDown: this.keybinds.moveDown,
      moveLeft: this.keybinds.moveLeft,
      moveRight: this.keybinds.moveRight,
      dash: this.keybinds.dash,
    }) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.on(`keydown-${normalizeKeyName(this.keybinds.dash)}`, () => {
      if (this.elapsedMs >= this.dashAt) this.dashQueued = true;
    });
  }

  private createCollisions() {
    this.physics.add.overlap(this.playerShots, this.enemies, this.onShotHitsEnemy, undefined, this);
    this.physics.add.overlap(this.player, this.enemyBullets, this.onPlayerHit, undefined, this);
    this.physics.add.overlap(this.player, this.enemies, this.onPlayerHit, undefined, this);
    this.physics.add.overlap(this.player, this.pickups, this.onPickup, undefined, this);
  }

  private updateBossFlow(threat: number) {
    if (!this.boss && this.elapsedMs >= this.nextBossAt) {
      this.enemies.clear(true, true);
      this.physics.resume();
      this.pausedForUpgrade = false;
      const encounterNumber = this.bossEncountersSpawned + 1;
      const bossId = Math.min(3, encounterNumber) as 1 | 2 | 3;
      const finalApex = encounterNumber === 4 && bossId === 3;
      this.finalApexActive = finalApex;
      this.boss = new Boss1Controller(this, this.elapsedMs, threat, bossId, finalApex ? 4 : 1);
      this.bossEncountersSpawned += 1;
      this.activeBossStartedAt = this.elapsedMs;
      this.telemetry?.logEvent(this.elapsedMs, "boss-spawn", { threat, bossId, finalApex });
      if (readPreferences().screenShake) this.cameras.main.shake(240, 0.004);
      playSound("upgrade");
      this.saveCheckpoint();
    }

    if (this.boss) {
      this.boss.update(this.elapsedMs, this.player, this.enemyBullets, this.debug);
      this.resolveBossCombat();
    }
  }

  private movePlayer(delta: number) {
    const direction = this.debug.autoplayer ? this.getAutoplayerDirection() : this.getManualDirection();
    if (this.shouldDash(direction)) this.startDash(direction);

    const isDashing = this.elapsedMs < this.dashUntil;
    const activeDirection = isDashing ? this.dashVector : direction;
    const speed = isDashing ? 760 : this.stats.speed;

    this.playerBody.setVelocity(activeDirection.x * speed, activeDirection.y * speed);
    if (direction.lengthSq() > 0) this.player.rotation = direction.angle();

    const visible = this.elapsedMs > this.invulnerableUntil || Math.floor(this.elapsedMs / 70) % 2 === 0;
    this.player.setVisible(visible);
    this.player.setFillStyle(isDashing ? 0xf8fafc : 0x5eead4);
    this.player.setStrokeStyle(2, isDashing ? 0xfacc15 : 0xffffff, isDashing ? 1 : 0.9);
    this.dashIndicator.setPosition(this.player.x, this.player.y);
    const dashReady = this.elapsedMs >= this.dashAt;
    this.dashIndicator.setVisible(visible);
    if (isDashing) {
      this.dashIndicator.setFillStyle(0xfacc15, 1);
      this.dashIndicator.setStrokeStyle(1, 0xffffff, 1);
      this.dashIndicator.setAlpha(1);
    } else {
      this.dashIndicator.setFillStyle(dashReady ? 0xfde047 : 0x475569, dashReady ? 1 : 0.9);
      this.dashIndicator.setStrokeStyle(1, dashReady ? 0xffffff : 0x94a3b8, dashReady ? 0.9 : 0.45);
      this.dashIndicator.setAlpha(dashReady ? 1 : 0.55);
    }
    this.playerBody.setMaxVelocity(speed + delta);
  }

  private getManualDirection() {
    const x = Number(this.isKeyDown("moveRight")) - Number(this.isKeyDown("moveLeft"));
    const y = Number(this.isKeyDown("moveDown")) - Number(this.isKeyDown("moveUp"));
    const direction = new Phaser.Math.Vector2(x, y).normalize();
    if (direction.lengthSq() > 0) this.lastManualDirection.copy(direction);
    return direction;
  }

  private getAutoplayerDirection() {
    const speed = this.elapsedMs < this.dashUntil ? 760 : this.stats.speed;
    const target = this.autoplayer.chooseTargetPosition({
      elapsedMs: this.elapsedMs,
      player: this.player,
      enemies: this.enemies,
      enemyBullets: this.enemyBullets,
      pickups: this.pickups,
      speed,
    });
    const dx = target.x - this.player.x;
    const dy = target.y - this.player.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < 16) return Phaser.Math.Vector2.ZERO.clone();
    return new Phaser.Math.Vector2(dx, dy).normalize();
  }

  private shouldDash(direction: Phaser.Math.Vector2) {
    if (this.elapsedMs < this.dashAt) return false;
    if (!this.debug.autoplayer) {
      if (!this.dashQueued) return false;
      return direction.lengthSq() > 0 || this.lastManualDirection.lengthSq() > 0;
    }
    if (direction.lengthSq() === 0) return false;
    const dashSpeed = 760;
    return this.autoplayer.shouldDash({
      player: this.player,
      direction,
      enemies: this.enemies,
      enemyBullets: this.enemyBullets,
      dashSpeed,
    });
  }

  private startDash(direction: Phaser.Math.Vector2) {
    this.dashQueued = false;
    if (!this.debug.autoplayer && direction.lengthSq() === 0) this.dashVector.copy(this.lastManualDirection);
    else this.dashVector.copy(direction);
    this.dashUntil = this.elapsedMs + 155;
    this.invulnerableUntil = Math.max(this.invulnerableUntil, this.dashUntil);
    this.dashAt = this.elapsedMs + this.stats.dashCooldown;
    this.telemetry?.logEvent(this.elapsedMs, "dash", { x: round(this.player.x), y: round(this.player.y) });
    this.tweens.add({ targets: this.player, alpha: 0.35, yoyo: true, duration: 80 });
    dashTrail(this, this.player);
    playSound("dash");
  }

  private isKeyDown(action: keyof KeybindState): boolean {
    return Boolean(this.inputKeys[action]?.isDown);
  }

  private autoShoot() {
    if (this.elapsedMs < this.shootAt) return;

    const target = this.boss || this.findNearestEnemy();
    if (!target) return;

    this.shootAt = this.elapsedMs + this.stats.fireRate * this.debug.playerFireRateMultiplier;
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, target.x, target.y);
    const spread = 0.17;
    const shots = this.getPlayerShotAngles(angle, spread);

    for (const shotAngle of shots) {
      this.playerShotsFired += 1;
      firePlayerShot(
        this,
        this.playerShots,
        this.player.x,
        this.player.y,
        shotAngle,
        this.getScaledPlayerDamage(),
        this.stats.projectileSpeed,
        this.stats.pierce,
        this.debug,
      );
    }
    playSound("shoot");
  }

  private getPlayerShotAngles(baseAngle: number, spread: number): number[] {
    const count = Math.max(1, this.stats.projectiles);
    if (count % 2 === 1) {
      const half = (count - 1) / 2;
      return Array.from({ length: count }, (_, index) => baseAngle + (index - half) * spread);
    }

    const shots: number[] = [];
    const half = count / 2;
    const centerOffset = spread * 0.08;
    for (let i = 0; i < half; i += 1) {
      const lane = half - i - 0.5;
      const offset = lane * spread;
      if (i === half - 1) {
        shots.push(baseAngle - centerOffset, baseAngle + centerOffset);
      } else {
        shots.push(baseAngle - offset, baseAngle + offset);
      }
    }
    return shots;
  }

  private onShotHitsEnemy(shotObject: object, enemyObject: object) {
    const shot = shotObject as Phaser.Physics.Arcade.Image;
    const enemy = enemyObject as Phaser.GameObjects.Shape & { setFillStyle: (color: number, alpha?: number) => unknown };
    const data = enemy.getData("enemy") as EnemyData;
    this.playerShotsHit += 1;
    data.hp -= shot.getData("damage") as number;
    const pierce = shot.getData("pierce") as number;
    if (pierce > 0) {
      shot.setData("pierce", pierce - 1);
    } else {
      shot.destroy();
    }

    flashEnemy(this, enemy);
    playSound("enemy-hit");

    if (data.hp <= 0) this.killEnemy(enemy, data);
  }

  private resolveBossCombat() {
    if (!this.boss) return;
    this.playerShots.children.each((child) => {
      if (!this.boss) return false;
      const shot = child as Phaser.Physics.Arcade.Image;
      if (!shot.active) return true;
      const result = this.boss.hitByShot(shot, this.elapsedMs);
      if (!result.hit) return true;
      this.playerShotsHit += 1;
      this.telemetry?.logEvent(this.elapsedMs, "boss-hit", { hpRatio: round(this.boss.hp / this.boss.maxHp) });
      playSound(result.phaseChanged ? "upgrade" : "enemy-hit");
      if (result.phaseChanged) {
        this.telemetry?.logEvent(this.elapsedMs, "boss-phase", { phase: this.boss.phase });
        if (readPreferences().screenShake) this.cameras.main.shake(180, 0.003);
      }
      if (result.defeated) {
        this.defeatBoss();
        return false;
      }
      return true;
    });

    if (!this.boss) return;
    if (this.boss.overlapsPlayer(this.player.x, this.player.y, 7)) {
      this.applyPlayerDamage();
    }
  }

  private defeatBoss() {
    if (!this.boss) return;
    const bossTime = this.activeBossStartedAt === null ? null : Math.floor(this.elapsedMs - this.activeBossStartedAt);
    this.telemetry?.logEvent(this.elapsedMs, "boss-defeat", { durationMs: bossTime, phase: this.boss.phase });
    this.boss.destroy();
    this.boss = null;
    this.activeBossStartedAt = null;
    this.score += 250;
    this.bossesDefeated += 1;
    if (this.finalApexActive) {
      this.nextBossAt = Number.POSITIVE_INFINITY;
      this.finalApexActive = false;
    } else {
      this.nextBossAt =
        this.bossEncountersSpawned === 1 ? SECOND_BOSS_AT_MS :
          this.bossEncountersSpawned === 2 ? THIRD_BOSS_AT_MS :
            this.elapsedMs + BOSS_RESPAWN_DELAY_MS;
    }
    this.spawnAt = this.elapsedMs + 1200;
    playSound("enemy-death");
    this.emitBossState();
    this.saveCheckpoint();
  }

  private killEnemy(enemy: Phaser.GameObjects.Shape, data: EnemyData) {
    if (data.kind === "bomber") {
      firePattern(this, this.enemyBullets, enemy, "spinner", this.getThreatLevel(), this.debug, this.player);
    }

    this.kills += 1;
    this.score += data.kind === "spinner" || data.kind === "bomber" ? 24 : 12;
    enemyDeathBurst(this, enemy.x, enemy.y, (enemy.getData("color") as number | undefined) ?? 0xfb7185);
    playSound("enemy-death");
    if (this.rng.frac() > 0.2) createPickup(this, this.pickups, enemy.x, enemy.y, this.rng, 1);
    enemy.destroy();
  }

  private onPlayerHit(_playerObject: object, hazardObject: object) {
    if (this.elapsedMs < this.invulnerableUntil || this.debug.invulnerable) return;

    const hazard = hazardObject as Phaser.GameObjects.GameObject;
    if (this.enemyBullets.contains(hazard)) hazard.destroy();
    this.applyPlayerDamage();
  }

  private onPickup(_playerObject: object, pickupObject: object) {
    const pickup = pickupObject as Phaser.GameObjects.GameObject & { x: number; y: number; getData: (key: string) => unknown };
    const value = Number(pickup.getData("value") || 1);
    pickupCollectBurst(this, pickup.x, pickup.y);
    pickup.destroy();
    this.score += 8 * value;
    this.telemetry?.logEvent(this.elapsedMs, "pickup", { value, x: round(pickup.x), y: round(pickup.y) });
    playSound("pickup");
  }

  private openUpgradeChoice() {
    this.pausedForUpgrade = true;
    this.physics.pause();
    const options = chooseUpgradeOptions();
    this.pendingUpgradeOptions = options;
    this.telemetry?.logEvent(this.elapsedMs, "upgrade-offered", { options: options.map((option) => option.id).join(",") });

    if (this.debug.autoplayer) {
      this.applyUpgrade(chooseAutoplayerUpgrade(options, this.stats, this.health));
      return;
    }

    emitUpgrade(options);
    this.saveCheckpoint();
  }

  private findNearestEnemy(): Phaser.GameObjects.Shape | null {
    let nearest: Phaser.GameObjects.Shape | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    this.enemies.children.each((child) => {
      const enemy = child as Phaser.GameObjects.Shape;
      const distance = Phaser.Math.Distance.Squared(this.player.x, this.player.y, enemy.x, enemy.y);
      if (distance < nearestDistance) {
        nearest = enemy;
        nearestDistance = distance;
      }
      return true;
    });
    return nearest;
  }

  private getThreatLevel(): number {
    if (this.debug.threatOverride > 0) return this.debug.threatOverride;
    return Math.max(1, Math.floor(this.elapsedMs / 7500) + 1);
  }

  private getEnemyPhaseId(): 1 | 2 | 3 {
    if (this.bossEncountersSpawned <= 0) return 1;
    if (this.bossEncountersSpawned === 1) return 2;
    return 3;
  }

  private getEnemyPhaseElapsedMs(): number {
    const phaseId = this.getEnemyPhaseId();
    if (phaseId === 1) return this.elapsedMs;
    if (phaseId === 2) return Math.max(0, this.elapsedMs - FIRST_BOSS_AT_MS);
    return Math.max(0, this.elapsedMs - SECOND_BOSS_AT_MS);
  }

  private getScaledPlayerDamage(): number {
    return this.stats.damage + Math.floor(Math.max(0, this.getThreatLevel() - 1) / 3);
  }

  private getHud() {
    return {
      timeMs: this.elapsedMs,
      score: Math.floor(this.score),
      health: this.health,
      threat: this.getThreatLevel(),
    };
  }

  private emitBossState() {
    if (!this.boss) {
      emitBossHud({ active: false, name: "", hp: 0, maxHp: 1, phase: 1 });
      return;
    }

    emitBossHud({
      active: true,
      name: this.boss.name,
      hp: this.boss.hp,
      maxHp: this.boss.maxHp,
      phase: this.boss.phase,
    });
  }

  private getDebugStats() {
    return {
      elapsedMs: this.elapsedMs,
      threat: this.getThreatLevel(),
      score: Math.floor(this.score),
      health: this.health,
      kills: this.kills,
      enemies: this.enemies.countActive(true),
      playerShots: this.playerShots.countActive(true),
      enemyBullets: this.enemyBullets.countActive(true),
      pickups: this.pickups.countActive(true),
      nextSpawnMs: Math.max(0, this.spawnAt - this.elapsedMs),
      nextUpgradeMs: Math.max(0, this.nextUpgradeAt - this.elapsedMs),
      dashCooldownMs: Math.max(0, this.dashAt - this.elapsedMs),
      seed: this.seed,
    };
  }

  private endRun(reason: "death" | "timeout" = "death") {
    this.runEnded = true;
    clearCheckpoint();
    const summary: RunSummary = {
      survivalMs: Math.floor(this.elapsedMs),
      score: Math.floor(this.score),
      kills: this.kills,
      maxThreatLevel: this.maxThreatLevel,
      seed: this.seed,
      mode: this.mode,
      playerDamage: this.stats.damage,
      playerProjectiles: this.stats.projectiles,
      playerFireRate: this.stats.fireRate,
      playerPierce: this.stats.pierce,
      playerProjectileSpeed: this.stats.projectileSpeed,
      shotsFired: this.playerShotsFired,
      shotsHit: this.playerShotsHit,
      shotAccuracy: this.playerShotsFired > 0 ? Math.round((this.playerShotsHit / this.playerShotsFired) * 100) / 100 : 0,
      upgradesTaken: this.upgradesTaken,
      bossesDefeated: this.bossesDefeated,
      maxHealth: this.health,
      speed: this.stats.speed,
      finalThreat: this.getThreatLevel(),
    };

    this.scene.pause();
    this.emitBossState();
    emitGameOver(summary);
    if (this.telemetry) {
      const autoplayer = this.autoplayer.getTelemetrySnapshot();
      this.telemetry.logEvent(this.elapsedMs, "run-end", {
        reason,
        score: summary.score,
        survivalMs: summary.survivalMs,
        threat: this.getThreatLevel(),
        bullets: this.enemyBullets.countActive(true),
        enemies: this.enemies.countActive(true),
        pickups: this.pickups.countActive(true),
        bossActive: Boolean(this.boss),
        bossPhase: this.boss?.phase ?? 0,
        bossHpRatio: this.boss ? round(this.boss.hp / this.boss.maxHp) : 0,
        danger: round(autoplayer.danger),
        projectedDanger: round(autoplayer.projectedDanger),
        reasonTag: autoplayer.reason,
        shotsFired: this.playerShotsFired,
        shotsHit: this.playerShotsHit,
        shotAccuracy: this.playerShotsFired > 0 ? round(this.playerShotsHit / this.playerShotsFired) : 0,
      });
      const run = this.telemetry.finalize({
        reason,
        survivalMs: summary.survivalMs,
        score: summary.score,
        kills: summary.kills,
        maxThreatLevel: summary.maxThreatLevel,
      });
      emitAutomationComplete({ run });
    } else {
      emitAutomationComplete({ run: null });
    }
  }

  private applyPlayerDamage() {
    if (this.elapsedMs < this.invulnerableUntil || this.debug.invulnerable) return;
    this.health -= 1;
    const autoplayer = this.autoplayer.getTelemetrySnapshot();
    const bullets = this.enemyBullets.countActive(true);
    const enemies = this.enemies.countActive(true);
    const edgeDistance = round(Math.min(this.player.x, ARENA_WIDTH - this.player.x, this.player.y, ARENA_HEIGHT - this.player.y));
    let context = "attrition";
    if (this.boss?.overlapsPlayer(this.player.x, this.player.y, 7)) context = "boss-contact";
    else if (bullets >= 120) context = "burst";
    else if (edgeDistance < 90) context = "cornered";
    this.telemetry?.logEvent(this.elapsedMs, "damage", {
      health: this.health,
      threat: this.getThreatLevel(),
      bullets,
      enemies,
      edgeDistance,
      bossActive: Boolean(this.boss),
      danger: round(autoplayer.danger),
      projectedDanger: round(autoplayer.projectedDanger),
      reasonTag: autoplayer.reason,
      context,
    });
    this.invulnerableUntil = this.elapsedMs + 1200;
    if (readPreferences().screenShake) this.cameras.main.shake(120, 0.006);
    playerHitBurst(this, this.player);
    playSound("player-hit");
    if (this.health <= 0) this.endRun();
  }

  private recordTelemetrySample() {
    if (!this.telemetry) return;
    const autoplayer = this.autoplayer.getTelemetrySnapshot();
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const phaseId = this.boss ? Math.min(6, this.bossEncountersSpawned * 2) : Math.min(5, this.bossEncountersSpawned * 2 + 1);
    const waveStep = this.boss ? this.boss.phase : getEnemyWaveStep(this.getEnemyPhaseId(), this.getEnemyPhaseElapsedMs());
    const bossPatternId = this.boss ? this.boss.getPatternId() : "none";
    this.telemetry.sample(this.elapsedMs, this.telemetryConfig.sampleIntervalMs, this.telemetryConfig.snapshotIntervalMs, {
      x: round(this.player.x),
      y: round(this.player.y),
      vx: round(body.velocity.x),
      vy: round(body.velocity.y),
      health: this.health,
      score: Math.floor(this.score),
      threat: this.getThreatLevel(),
      enemies: this.enemies.countActive(true),
      enemyBullets: this.enemyBullets.countActive(true),
      pickups: this.pickups.countActive(true),
      bossActive: Boolean(this.boss),
      bossHpRatio: this.boss ? round(this.boss.hp / this.boss.maxHp) : 0,
      bossPhase: this.boss?.phase ?? 0,
      dashReady: this.elapsedMs >= this.dashAt,
      frameMs: round(this.lastFrameMs),
      edgeDistance: round(Math.min(this.player.x, ARENA_WIDTH - this.player.x, this.player.y, ARENA_HEIGHT - this.player.y)),
      playerDamage: this.stats.damage,
      playerProjectiles: this.stats.projectiles,
      playerFireRate: this.stats.fireRate,
      playerPierce: this.stats.pierce,
      playerProjectileSpeed: this.stats.projectileSpeed,
      shotsFired: this.playerShotsFired,
      shotsHit: this.playerShotsHit,
      shotAccuracy: this.playerShotsFired > 0 ? round(this.playerShotsHit / this.playerShotsFired) : 0,
      phaseId,
      waveStep,
      bossPatternId,
      ...toAutoplayerSample(autoplayer),
    });
    if (this.telemetryConfig.exportToDom) {
      emitAutomationSnapshot({ run: this.telemetry.snapshot() });
    }
  }

  applyUpgrade(id: string) {
    this.pausedForUpgrade = false;
    this.pendingUpgradeOptions = null;
    this.physics.resume();
    const result = applyUpgradeToStats(this.stats, this.health, id);
    this.stats = result.stats;
    this.health = result.health;
    this.upgradesTaken += 1;
    this.nextUpgradeAt += UPGRADE_INTERVAL_MS;
    this.telemetry?.logEvent(this.elapsedMs, "upgrade-picked", {
      id,
      damage: this.stats.damage,
      projectiles: this.stats.projectiles,
      fireRate: this.stats.fireRate,
      pierce: this.stats.pierce,
      projectileSpeed: this.stats.projectileSpeed,
    });
    upgradePulse(this, this.player);
    playSound("upgrade");
    this.saveCheckpoint();
  }

  private handleShutdown() {
    if (!this.runEnded) this.saveCheckpoint();
  }

  private saveCheckpoint() {
    if (this.runEnded || !this.player?.body) return;
    this.checkpointSaveAt = this.elapsedMs + 2000;
    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    const checkpoint: CheckpointState = {
      version: 1,
      savedAt: new Date().toISOString(),
      mode: this.mode,
      seed: this.seed,
      elapsedMs: Math.floor(this.elapsedMs),
      score: Math.floor(this.score),
      kills: this.kills,
      health: this.health,
      invulnerableUntil: this.invulnerableUntil,
      spawnAt: this.spawnAt,
      shootAt: this.shootAt,
      dashAt: this.dashAt,
      dashUntil: this.dashUntil,
      dashVector: { x: this.dashVector.x, y: this.dashVector.y },
      lastManualDirection: { x: this.lastManualDirection.x, y: this.lastManualDirection.y },
      pausedForUpgrade: this.pausedForUpgrade,
      nextUpgradeAt: this.nextUpgradeAt,
      nextBossAt: this.nextBossAt,
      bossEncountersSpawned: this.bossEncountersSpawned,
      finalApexActive: this.finalApexActive,
      maxThreatLevel: this.maxThreatLevel,
      activeBossStartedAt: this.activeBossStartedAt,
      playerShotsFired: this.playerShotsFired,
      playerShotsHit: this.playerShotsHit,
      upgradesTaken: this.upgradesTaken,
      bossesDefeated: this.bossesDefeated,
      debug: { ...this.debug },
      stats: { ...this.stats },
      initialProgression: this.initialProgression ? { ...this.initialProgression, upgrades: { ...this.initialProgression.upgrades } } : null,
      telemetryConfig: { ...this.telemetryConfig },
      player: {
        x: this.player.x,
        y: this.player.y,
        rotation: this.player.rotation,
        visible: this.player.visible,
        velocityX: playerBody.velocity.x,
        velocityY: playerBody.velocity.y,
      },
      boss: this.boss?.toState() ?? null,
      enemies: [],
      enemyBullets: [],
      playerShots: [],
      pickups: [],
      upgradeOptions: this.pendingUpgradeOptions ? [...this.pendingUpgradeOptions] : null,
    };

    this.enemies.children.each((child) => {
      const enemy = child as Phaser.GameObjects.Shape;
      if (!enemy.active) return true;
      const data = enemy.getData("enemy") as EnemyData | undefined;
      if (!data) return true;
      const body = enemy.body as Phaser.Physics.Arcade.Body;
      checkpoint.enemies.push({
        kind: data.kind,
        x: enemy.x,
        y: enemy.y,
        hp: data.hp,
        speed: data.speed,
        fireAt: data.fireAt,
        casts: data.casts,
        vx: body.velocity.x,
        vy: body.velocity.y,
      });
      return true;
    });
    this.enemyBullets.children.each((child) => {
      const bullet = child as Phaser.Physics.Arcade.Image;
      if (!bullet.active) return true;
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      checkpoint.enemyBullets.push({
        x: bullet.x,
        y: bullet.y,
        vx: body.velocity.x,
        vy: body.velocity.y,
        lastX: (bullet.getData("lastX") as number | undefined) ?? bullet.x,
        lastY: (bullet.getData("lastY") as number | undefined) ?? bullet.y,
        radiusScale: Math.max(0.6, body.radius / 11),
        angle: bullet.rotation,
      });
      return true;
    });
    this.playerShots.children.each((child) => {
      const shot = child as Phaser.Physics.Arcade.Image;
      if (!shot.active) return true;
      const body = shot.body as Phaser.Physics.Arcade.Body;
      checkpoint.playerShots.push({
        x: shot.x,
        y: shot.y,
        vx: body.velocity.x,
        vy: body.velocity.y,
        lastX: (shot.getData("lastX") as number | undefined) ?? shot.x,
        lastY: (shot.getData("lastY") as number | undefined) ?? shot.y,
        damage: Number(shot.getData("damage") || 1),
        pierce: Number(shot.getData("pierce") || 0),
      });
      return true;
    });
    this.pickups.children.each((child) => {
      const pickup = child as Phaser.Physics.Arcade.Image;
      if (!pickup.active) return true;
      const body = pickup.body as Phaser.Physics.Arcade.Body;
      checkpoint.pickups.push({
        x: pickup.x,
        y: pickup.y,
        value: Number(pickup.getData("value") || 1),
        vx: body.velocity.x,
        vy: body.velocity.y,
        scale: pickup.scaleX,
      });
      return true;
    });

    writeCheckpoint(checkpoint);
  }

  private restoreCheckpoint(checkpoint: CheckpointState) {
    this.mode = checkpoint.mode;
    this.seed = checkpoint.seed;
    this.elapsedMs = checkpoint.elapsedMs;
    this.score = checkpoint.score;
    this.kills = checkpoint.kills;
    this.health = checkpoint.health;
    this.invulnerableUntil = checkpoint.invulnerableUntil;
    this.spawnAt = checkpoint.spawnAt;
    this.shootAt = checkpoint.shootAt;
    this.dashAt = checkpoint.dashAt;
    this.dashUntil = checkpoint.dashUntil;
    this.dashVector.set(checkpoint.dashVector.x, checkpoint.dashVector.y);
    this.lastManualDirection.set(checkpoint.lastManualDirection.x, checkpoint.lastManualDirection.y);
    this.pausedForUpgrade = checkpoint.pausedForUpgrade;
    this.pendingUpgradeOptions = checkpoint.upgradeOptions ? [...checkpoint.upgradeOptions] : null;
    this.nextUpgradeAt = checkpoint.nextUpgradeAt;
    this.nextBossAt = checkpoint.nextBossAt;
    this.bossEncountersSpawned = checkpoint.bossEncountersSpawned;
    this.finalApexActive = checkpoint.finalApexActive;
    this.maxThreatLevel = checkpoint.maxThreatLevel;
    this.activeBossStartedAt = checkpoint.activeBossStartedAt;
    this.playerShotsFired = checkpoint.playerShotsFired ?? 0;
    this.playerShotsHit = checkpoint.playerShotsHit ?? 0;
    this.upgradesTaken = checkpoint.upgradesTaken ?? 0;
    this.bossesDefeated = checkpoint.bossesDefeated ?? 0;
    this.debug = mergeDebugSettings({ ...DEFAULT_DEBUG_SETTINGS }, checkpoint.debug);
    this.stats = { ...checkpoint.stats };
    this.initialProgression = checkpoint.initialProgression ? { ...checkpoint.initialProgression, upgrades: { ...checkpoint.initialProgression.upgrades } } : null;
    this.telemetryConfig = { ...checkpoint.telemetryConfig };
    this.syncTimeScale();
    this.player.setPosition(checkpoint.player.x, checkpoint.player.y);
    this.player.rotation = checkpoint.player.rotation;
    this.player.setVisible(checkpoint.player.visible);
    this.playerBody.setVelocity(checkpoint.player.velocityX, checkpoint.player.velocityY);
    this.dashIndicator.setPosition(checkpoint.player.x, checkpoint.player.y);
    this.enemies.clear(true, true);
    this.enemyBullets.clear(true, true);
    this.playerShots.clear(true, true);
    this.pickups.clear(true, true);
    if (checkpoint.boss) {
      this.boss = Boss1Controller.fromState(this, checkpoint.boss);
    }
    for (const enemy of checkpoint.enemies) restoreEnemyFromState(this, this.enemies, enemy);
    for (const bullet of checkpoint.enemyBullets) restoreEnemyBullet(this, this.enemyBullets, bullet);
    for (const shot of checkpoint.playerShots) restorePlayerShot(this, this.playerShots, shot);
    for (const pickup of checkpoint.pickups) restorePickup(this, this.pickups, pickup);
    if (this.pausedForUpgrade && this.pendingUpgradeOptions) {
      this.physics.pause();
      emitUpgrade(this.pendingUpgradeOptions);
    }
    this.checkpointSaveAt = this.elapsedMs + 2000;
  }

}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
