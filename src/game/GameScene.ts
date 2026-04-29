import Phaser from "phaser";
import type { GameMode, RunSummary } from "../types";
import { createArenaBackground, createGameTextures } from "./arena";
import { Autoplayer } from "./autoplayer";
import { playSound } from "./audio";
import { BOSS_RESPAWN_DELAY_MS, Boss1Controller, FIRST_BOSS_AT_MS, SECOND_BOSS_AT_MS } from "./boss1";
import { ARENA_HEIGHT, ARENA_WIDTH, DEFAULT_DEBUG_SETTINGS, DEFAULT_PLAYER_STATS, TELEMETRY_SAMPLE_INTERVAL_MS, UPGRADE_INTERVAL_MS } from "./constants";
import { applyDebugSettings as mergeDebugSettings } from "./debug";
import { dashTrail, enemyDeathBurst, flashEnemy, pickupCollectBurst, playerHitBurst, upgradePulse } from "./effects";
import { createPickup, firePattern, spawnEnemyIfReady, updateEnemies } from "./enemies";
import { emitAutomationComplete, emitAutomationSnapshot, emitBossHud, emitDebugStats, emitGameOver, emitHud, emitUpgrade, type DebugSettings } from "./events";
import type { EnemyData } from "./gameTypes";
import { magnetPickups } from "./pickups";
import { firePlayerShot, updateProjectiles } from "./projectiles";
import { TelemetryRecorder, toAutoplayerSample, type TelemetryConfig } from "./telemetry";
import { applyUpgrade as applyUpgradeToStats, chooseAutoplayerUpgrade, chooseUpgradeOptions } from "./upgrades";

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private dashIndicator!: Phaser.GameObjects.Rectangle;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
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
  private pausedForUpgrade = false;
  private nextUpgradeAt = UPGRADE_INTERVAL_MS;
  private nextBossAt = FIRST_BOSS_AT_MS;
  private bossEncountersSpawned = 0;
  private maxThreatLevel = 1;
  private debug: DebugSettings = { ...DEFAULT_DEBUG_SETTINGS };
  private stats = { ...DEFAULT_PLAYER_STATS };
  private telemetryConfig: TelemetryConfig = { enabled: false, sampleIntervalMs: TELEMETRY_SAMPLE_INTERVAL_MS, snapshotIntervalMs: 3000, maxRunMs: 0, runId: "", exportToDom: false };
  private telemetry: TelemetryRecorder | null = null;
  private lastFrameMs = 0;
  private activeBossStartedAt: number | null = null;
  private initialElapsedMs = 0;

  constructor() {
    super("game");
  }

  init(data: { mode?: GameMode; seed?: string; debugSettings?: Partial<DebugSettings>; telemetryConfig?: Partial<TelemetryConfig>; startMs?: number }) {
    this.mode = data.mode || "endless";
    this.seed = data.seed || Date.now().toString(36);
    this.initialElapsedMs = Math.max(0, Number(data.startMs || 0));
    this.debug = mergeDebugSettings({ ...DEFAULT_DEBUG_SETTINGS }, data.debugSettings || {});
    this.telemetryConfig = {
      enabled: data.telemetryConfig?.enabled ?? false,
      sampleIntervalMs: data.telemetryConfig?.sampleIntervalMs ?? TELEMETRY_SAMPLE_INTERVAL_MS,
      snapshotIntervalMs: data.telemetryConfig?.snapshotIntervalMs ?? 3000,
      maxRunMs: data.telemetryConfig?.maxRunMs ?? 0,
      runId: data.telemetryConfig?.runId ?? `${this.mode}-${this.seed}`,
      exportToDom: data.telemetryConfig?.exportToDom ?? false,
    };
  }

  create() {
    this.resetRunState();
    if (this.initialElapsedMs > 0) this.setElapsedSeconds(this.initialElapsedMs / 1000);
    this.rng = new Phaser.Math.RandomDataGenerator([this.seed]);

    createArenaBackground(this);
    createGameTextures(this);
    this.createGroups();
    this.createPlayer();
    this.createInput();
    this.syncTimeScale();
    this.createCollisions();
    this.telemetry = this.telemetryConfig.enabled
      ? new TelemetryRecorder(this.telemetryConfig.runId, this.seed, this.mode, {
          autoplayer: this.debug.autoplayer,
          sampleIntervalMs: this.telemetryConfig.sampleIntervalMs,
          snapshotIntervalMs: this.telemetryConfig.snapshotIntervalMs,
          maxRunMs: this.telemetryConfig.maxRunMs,
          timeScale: this.debug.timeScale,
        })
      : null;
    this.telemetry?.logEvent(0, "run-start", { seed: this.seed, mode: this.mode });

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
    if (!this.boss) {
      this.spawnAt = spawnEnemyIfReady({
        scene: this,
        enemies: this.enemies,
        rng: this.rng,
        player: this.player,
        elapsedMs: this.elapsedMs,
        spawnAt: this.spawnAt,
        threat,
        debug: this.debug,
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
    });
    updateProjectiles(this.playerShots);
    updateProjectiles(this.enemyBullets);
    magnetPickups(this.pickups, this.player, this.stats, this.physics, this.debug.timeScale);

    if (this.elapsedMs >= this.nextUpgradeAt && !this.boss) this.openUpgradeChoice();
    if (this.telemetryConfig.maxRunMs > 0 && this.elapsedMs >= this.telemetryConfig.maxRunMs) {
      this.endRun("timeout");
      return;
    }

    emitHud(this.getHud());
    this.emitBossState();
    emitDebugStats(this.getDebugStats());
    this.recordTelemetrySample();
  }

  applyDebugSettings(settings: Partial<DebugSettings>) {
    this.debug = mergeDebugSettings(this.debug, settings);
    this.syncTimeScale();
  }

  setElapsedSeconds(seconds: number) {
    this.elapsedMs = Math.max(0, seconds * 1000);
    this.nextUpgradeAt = Math.max(this.elapsedMs + 1000, Math.ceil(this.elapsedMs / UPGRADE_INTERVAL_MS) * UPGRADE_INTERVAL_MS);
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
      this.nextBossAt = this.bossEncountersSpawned < 2 ? SECOND_BOSS_AT_MS : this.elapsedMs + 3000;
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
    this.pausedForUpgrade = false;
    this.nextUpgradeAt = UPGRADE_INTERVAL_MS;
    this.nextBossAt = FIRST_BOSS_AT_MS;
    this.bossEncountersSpawned = 0;
    this.maxThreatLevel = 1;
    this.boss = null;
    this.activeBossStartedAt = null;
    this.stats = { ...DEFAULT_PLAYER_STATS };
  }

  private syncTimeScale() {
    this.time.timeScale = this.debug.timeScale;
    this.tweens.timeScale = this.debug.timeScale;
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
    this.playerBody.setSize(9, 9).setOffset(7.5, 7.5).setCollideWorldBounds(true);
  }

  private createInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D,SPACE,ESC") as Record<string, Phaser.Input.Keyboard.Key>;
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
      this.boss = new Boss1Controller(this, this.elapsedMs, threat);
      this.bossEncountersSpawned += 1;
      this.activeBossStartedAt = this.elapsedMs;
      this.telemetry?.logEvent(this.elapsedMs, "boss-spawn", { threat });
      this.cameras.main.shake(240, 0.004);
      playSound("upgrade");
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
    const speed = (isDashing ? 760 : this.stats.speed) * this.debug.timeScale;

    this.playerBody.setVelocity(activeDirection.x * speed, activeDirection.y * speed);
    if (direction.lengthSq() > 0) this.player.rotation = direction.angle();

    const visible = this.elapsedMs > this.invulnerableUntil || Math.floor(this.elapsedMs / 90) % 2 === 0;
    this.player.setVisible(visible);
    this.player.setFillStyle(0x5eead4);
    this.dashIndicator.setPosition(this.player.x, this.player.y);
    const dashReady = this.elapsedMs >= this.dashAt;
    this.dashIndicator.setVisible(visible);
    this.dashIndicator.setFillStyle(dashReady ? 0xfde047 : 0x475569, dashReady ? 1 : 0.9);
    this.dashIndicator.setStrokeStyle(1, dashReady ? 0xffffff : 0x94a3b8, dashReady ? 0.9 : 0.45);
    this.dashIndicator.setAlpha(dashReady ? 1 : 0.55);
    this.playerBody.setMaxVelocity(speed + delta);
  }

  private getManualDirection() {
    const x = Number(this.cursors.right.isDown || this.wasd.D.isDown) - Number(this.cursors.left.isDown || this.wasd.A.isDown);
    const y = Number(this.cursors.down.isDown || this.wasd.S.isDown) - Number(this.cursors.up.isDown || this.wasd.W.isDown);
    return new Phaser.Math.Vector2(x, y).normalize();
  }

  private getAutoplayerDirection() {
    const speed = (this.elapsedMs < this.dashUntil ? 760 : this.stats.speed) * this.debug.timeScale;
    return this.autoplayer.chooseDirection({
      elapsedMs: this.elapsedMs,
      player: this.player,
      enemies: this.enemies,
      enemyBullets: this.enemyBullets,
      pickups: this.pickups,
      speed,
    });
  }

  private shouldDash(direction: Phaser.Math.Vector2) {
    if (this.elapsedMs < this.dashAt || direction.lengthSq() === 0) return false;
    if (!this.debug.autoplayer) return Phaser.Input.Keyboard.JustDown(this.wasd.SPACE);
    const dashSpeed = 760 * this.debug.timeScale;
    return this.autoplayer.shouldDash({
      player: this.player,
      direction,
      enemies: this.enemies,
      enemyBullets: this.enemyBullets,
      dashSpeed,
    });
  }

  private startDash(direction: Phaser.Math.Vector2) {
    this.dashVector.copy(direction);
    this.dashUntil = this.elapsedMs + 155;
    this.dashAt = this.elapsedMs + this.stats.dashCooldown;
    this.telemetry?.logEvent(this.elapsedMs, "dash", { x: round(this.player.x), y: round(this.player.y) });
    this.tweens.add({ targets: this.player, alpha: 0.35, yoyo: true, duration: 80 });
    dashTrail(this, this.player);
    playSound("dash");
  }

  private autoShoot() {
    if (this.elapsedMs < this.shootAt) return;

    const target = this.boss || this.findNearestEnemy();
    if (!target) return;

    this.shootAt = this.elapsedMs + this.stats.fireRate * this.debug.playerFireRateMultiplier;
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, target.x, target.y);
    const spread = 0.17;
    const start = -((this.stats.projectiles - 1) * spread) / 2;

    for (let i = 0; i < this.stats.projectiles; i += 1) {
      firePlayerShot(
        this,
        this.playerShots,
        this.player.x,
        this.player.y,
        angle + start + i * spread,
        this.getScaledPlayerDamage(),
        this.stats.projectileSpeed,
        this.stats.pierce,
        this.debug,
      );
    }
    playSound("shoot");
  }

  private onShotHitsEnemy(shotObject: object, enemyObject: object) {
    const shot = shotObject as Phaser.Physics.Arcade.Image;
    const enemy = enemyObject as Phaser.GameObjects.Shape & { setFillStyle: (color: number, alpha?: number) => unknown };
    const data = enemy.getData("enemy") as EnemyData;
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
      this.telemetry?.logEvent(this.elapsedMs, "boss-hit", { hpRatio: round(this.boss.hp / this.boss.maxHp) });
      playSound(result.phaseChanged ? "upgrade" : "enemy-hit");
      if (result.phaseChanged) {
        this.telemetry?.logEvent(this.elapsedMs, "boss-phase", { phase: this.boss.phase });
        this.cameras.main.shake(180, 0.003);
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
    this.nextBossAt = this.bossEncountersSpawned < 2 ? SECOND_BOSS_AT_MS : this.elapsedMs + BOSS_RESPAWN_DELAY_MS;
    this.spawnAt = this.elapsedMs + 1200;
    playSound("enemy-death");
    this.emitBossState();
  }

  private killEnemy(enemy: Phaser.GameObjects.Shape, data: EnemyData) {
    if (data.kind === "bomber") {
      firePattern(this, this.enemyBullets, enemy, "spinner", this.getThreatLevel(), this.debug, this.player);
    }

    this.kills += 1;
    this.score += data.kind === "spinner" || data.kind === "bomber" ? 24 : 12;
    enemyDeathBurst(this, enemy.x, enemy.y, (enemy.getData("color") as number | undefined) ?? 0xfb7185);
    playSound("enemy-death");
    if (this.rng.frac() > 0.2) createPickup(this, this.pickups, enemy.x, enemy.y, this.rng, this.debug.timeScale);
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
    this.telemetry?.logEvent(this.elapsedMs, "upgrade-offered", { options: options.map((option) => option.id).join(",") });

    if (this.debug.autoplayer) {
      this.applyUpgrade(chooseAutoplayerUpgrade(options, this.stats, this.health));
      return;
    }

    emitUpgrade(options);
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
    const summary: RunSummary = {
      survivalMs: Math.floor(this.elapsedMs),
      score: Math.floor(this.score),
      kills: this.kills,
      maxThreatLevel: this.maxThreatLevel,
      seed: this.seed,
      mode: this.mode,
    };

    this.scene.pause();
    this.emitBossState();
    emitGameOver(summary);
    if (this.telemetry) {
      this.telemetry.logEvent(this.elapsedMs, "run-end", { reason, score: summary.score, survivalMs: summary.survivalMs });
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
    this.telemetry?.logEvent(this.elapsedMs, "damage", { health: this.health, threat: this.getThreatLevel() });
    this.invulnerableUntil = this.elapsedMs + 1200;
    this.cameras.main.shake(120, 0.006);
    playerHitBurst(this, this.player);
    playSound("player-hit");
    if (this.health <= 0) this.endRun();
  }

  private recordTelemetrySample() {
    if (!this.telemetry) return;
    const autoplayer = this.autoplayer.getTelemetrySnapshot();
    const body = this.player.body as Phaser.Physics.Arcade.Body;
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
      ...toAutoplayerSample(autoplayer),
    });
    if (this.telemetryConfig.exportToDom) {
      emitAutomationSnapshot({ run: this.telemetry.snapshot() });
    }
  }

  applyUpgrade(id: string) {
    this.pausedForUpgrade = false;
    this.physics.resume();
    const result = applyUpgradeToStats(this.stats, this.health, id);
    this.stats = result.stats;
    this.health = result.health;
    this.nextUpgradeAt += UPGRADE_INTERVAL_MS;
    this.telemetry?.logEvent(this.elapsedMs, "upgrade-picked", { id });
    upgradePulse(this, this.player);
    playSound("upgrade");
  }

}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
