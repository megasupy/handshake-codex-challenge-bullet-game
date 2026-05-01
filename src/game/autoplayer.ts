import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH, AUTOPLAYER_DECISION_INTERVAL_MS, AUTOPLAYER_DIRECTIONS } from "./constants";
import type { AutoplayerTelemetry, EnemyData } from "./gameTypes";

export type AutoplayerPolicy = {
  horizonNearWeight: number;
  horizonMidWeight: number;
  horizonFarWeight: number;
  interceptRiskWeight: number;
  reverseDirectionPenalty: number;
  nearEdgePenaltyScale: number;
  idleEnemyPenalty: number;
  idleCalmPenalty: number;
  pickupBiasScale: number;
  centerPullScale: number;
  openAreaRewardScale: number;
  dashHighRiskThreshold: number;
  dashRiskGainRequired: number;
  idleBusyPenalty: number;
  pickupIdlePenalty: number;
  pickupSafetyHazardThreshold: number;
  edgeResetDistance: number;
  edgeResetDangerThreshold: number;
  directPickupBulletCap: number;
  directPickupEnemyCap: number;
  directPickupCurrentHazardThreshold: number;
  directPickupTargetHazardThreshold: number;
  directPickupPathHazardThreshold: number;
  emergencyCooldownBypass: number;
  emergencyBypassHazardThreshold: number;
  emergencyBypassInterceptThreshold: number;
  emergencyBypassIdleBulletRisk: number;
  emergencyBypassConsecutiveFrames: number;
};

const DEFAULT_POLICY: AutoplayerPolicy = {
  horizonNearWeight: 3.8,
  horizonMidWeight: 2.5,
  horizonFarWeight: 1.45,
  interceptRiskWeight: 0.72,
  reverseDirectionPenalty: 0.35,
  nearEdgePenaltyScale: 22,
  idleEnemyPenalty: 36,
  idleCalmPenalty: 12,
  pickupBiasScale: 2.8,
  centerPullScale: 1,
  openAreaRewardScale: 1.8,
  dashHighRiskThreshold: 28,
  dashRiskGainRequired: 10,
  idleBusyPenalty: 14,
  pickupIdlePenalty: 8,
  pickupSafetyHazardThreshold: 4.2,
  edgeResetDistance: 130,
  edgeResetDangerThreshold: 9,
  directPickupBulletCap: 8,
  directPickupEnemyCap: 8,
  directPickupCurrentHazardThreshold: 1.6,
  directPickupTargetHazardThreshold: 2.7,
  directPickupPathHazardThreshold: 2.35,
  emergencyCooldownBypass: 1,
  emergencyBypassHazardThreshold: 3.2,
  emergencyBypassInterceptThreshold: 128,
  emergencyBypassIdleBulletRisk: 125,
  emergencyBypassConsecutiveFrames: 2,
};

/** Extra cost tolerated before switching to a new move direction (lower score is better). */
const DIRECTION_HYSTERESIS = 14;
const BOSS_SURVIVAL_DANGER_BIAS = 0.08;
const BOSS_FAR_HORIZON_WEIGHT_MULT = 1.15;

export class Autoplayer {
  private direction = new Phaser.Math.Vector2(0, 0);
  private targetPosition = new Phaser.Math.Vector2(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
  private pickupTarget: Phaser.Physics.Arcade.Image | null = null;
  private nextDecisionAt = 0;
  private emergencyStreak = 0;
  private policy: AutoplayerPolicy = { ...DEFAULT_POLICY };
  private lastTelemetry: AutoplayerTelemetry = {
    directionX: 0,
    directionY: 0,
    reason: "idle",
    danger: 0,
    projectedDanger: 0,
    nearestPickupDistance: Number.POSITIVE_INFINITY,
    nearestEnemyDistance: Number.POSITIVE_INFINITY,
    pickupTargetX: null,
    pickupTargetY: null,
    pickupTargetValue: 0,
    decisionTimeMs: 0,
    lookaheadRisk: 0,
    dashCurrentRisk: 0,
    dashProjectedRisk: 0,
    dashImmediateRisk: 0,
    dashWouldUse: false,
    safeDirections: 0,
    selectedDirectionRisk: 0,
    bestAlternativeRisk: 0,
    riskGap: 0,
    incomingDensity: 0,
  };

  reset(): void {
    this.direction.set(0, 0);
    this.targetPosition.set(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
    this.pickupTarget = null;
    this.nextDecisionAt = 0;
    this.emergencyStreak = 0;
    this.lastTelemetry = {
      directionX: 0,
      directionY: 0,
      reason: "idle",
      danger: 0,
      projectedDanger: 0,
      nearestPickupDistance: Number.POSITIVE_INFINITY,
      nearestEnemyDistance: Number.POSITIVE_INFINITY,
      pickupTargetX: null,
      pickupTargetY: null,
      pickupTargetValue: 0,
      decisionTimeMs: 0,
      lookaheadRisk: 0,
      dashCurrentRisk: 0,
      dashProjectedRisk: 0,
      dashImmediateRisk: 0,
      dashWouldUse: false,
      safeDirections: 0,
      selectedDirectionRisk: 0,
      bestAlternativeRisk: 0,
      riskGap: 0,
      incomingDensity: 0,
    };
  }

  setPolicy(next: Partial<AutoplayerPolicy> | null | undefined): void {
    if (!next) {
      this.policy = { ...DEFAULT_POLICY };
      return;
    }
    this.policy = { ...DEFAULT_POLICY, ...next };
  }

  private shouldBypassDecisionCooldown(args: {
    player: Phaser.GameObjects.Shape;
    enemies: Phaser.Physics.Arcade.Group;
    enemyBullets: Phaser.Physics.Arcade.Group;
    speed: number;
  }): boolean {
    if (this.policy.emergencyCooldownBypass <= 0) {
      this.emergencyStreak = 0;
      return false;
    }

    const hazardThreshold = this.policy.emergencyBypassHazardThreshold;
    const interceptThreshold = this.policy.emergencyBypassInterceptThreshold;
    const idleBulletThreshold = this.policy.emergencyBypassIdleBulletRisk;
    const framesNeeded = Phaser.Math.Clamp(Math.round(this.policy.emergencyBypassConsecutiveFrames), 1, 8);

    let raw = false;
    const hazard = this.getHazardScoreAt(args.player.x, args.player.y, args.enemies, args.enemyBullets, args.player);
    if (hazard >= hazardThreshold) raw = true;

    if (!raw) {
      if (this.direction.lengthSq() > 0.01) {
        const intercept = this.getImmediateInterceptRisk(args.player, this.direction, args.speed, args.enemyBullets);
        if (intercept >= interceptThreshold) raw = true;
      } else {
        const bulletRisk = this.getBulletRiskAt(args.player.x, args.player.y, 0.22, args.enemyBullets);
        if (bulletRisk >= idleBulletThreshold) raw = true;
      }
    }

    if (raw) this.emergencyStreak += 1;
    else this.emergencyStreak = 0;

    return this.emergencyStreak >= framesNeeded;
  }

  chooseTargetPosition(args: {
    elapsedMs: number;
    player: Phaser.GameObjects.Shape;
    enemies: Phaser.Physics.Arcade.Group;
    enemyBullets: Phaser.Physics.Arcade.Group;
    pickups: Phaser.Physics.Arcade.Group;
    speed: number;
    bossActive?: boolean;
    velocityX?: number;
    velocityY?: number;
  }): Phaser.Math.Vector2 {
    if (args.elapsedMs < this.nextDecisionAt && !this.shouldBypassDecisionCooldown(args)) {
      return this.targetPosition.clone();
    }

    this.emergencyStreak = 0;

    const startedAt = performance.now();
    const bossActive = Boolean(args.bossActive);
    const lagSeconds = (AUTOPLAYER_DECISION_INTERVAL_MS * 0.5) / 1000;
    const vx = Number(args.velocityX) || 0;
    const vy = Number(args.velocityY) || 0;
    const evalX = Phaser.Math.Clamp(args.player.x + vx * lagSeconds, 22, ARENA_WIDTH - 22);
    const evalY = Phaser.Math.Clamp(args.player.y + vy * lagSeconds, 22, ARENA_HEIGHT - 22);
    const horizons = [0.08, 0.18, 0.34, 0.58, 0.9, 1.2];
    const activeBulletCount = args.enemyBullets.countActive(true);
    const activeEnemyCount = args.enemies.countActive(true);
    const pickupTarget = this.choosePickupTarget(args.player, args.pickups, args.enemyBullets, args.enemies);
    const directPickupDirection = pickupTarget
      ? new Phaser.Math.Vector2(pickupTarget.x - args.player.x, pickupTarget.y - args.player.y).normalize()
      : null;
    const currentDanger = this.getHazardScoreAt(args.player.x, args.player.y, args.enemies, args.enemyBullets, args.player);
    const nearestEnemyDistance = this.getNearestEnemyDistance(args.player.x, args.player.y, args.enemies);
    const nearestPickupDistance = pickupTarget ? Phaser.Math.Distance.Between(args.player.x, args.player.y, pickupTarget.x, pickupTarget.y) : Number.POSITIVE_INFINITY;
    const edgeDistance = Math.min(args.player.x, ARENA_WIDTH - args.player.x, args.player.y, ARENA_HEIGHT - args.player.y);
    const dangerForPrioritize = bossActive ? currentDanger + BOSS_SURVIVAL_DANGER_BIAS : currentDanger;
    const prioritizeSurvival =
      dangerForPrioritize >= 1.05 || activeBulletCount >= 5 || activeEnemyCount >= 6 || bossActive;
    const activePickupTarget = prioritizeSurvival ? null : pickupTarget;

    if (
      pickupTarget &&
      directPickupDirection &&
      this.shouldMoveDirectlyToPickup(args.player, pickupTarget, args.enemies, args.enemyBullets) &&
      activeBulletCount < this.policy.directPickupBulletCap &&
      activeEnemyCount < this.policy.directPickupEnemyCap &&
      !prioritizeSurvival
    ) {
      this.direction.copy(directPickupDirection);
      this.targetPosition.set(args.player.x + this.direction.x * args.speed * 0.3, args.player.y + this.direction.y * args.speed * 0.3);
      this.finishDecision("pickup-direct", currentDanger, currentDanger, nearestPickupDistance, nearestEnemyDistance, pickupTarget, startedAt);
      this.nextDecisionAt = args.elapsedMs + AUTOPLAYER_DECISION_INTERVAL_MS;
      return this.targetPosition.clone();
    }
    const scored: { direction: Phaser.Math.Vector2; score: number }[] = [];
    for (const direction of AUTOPLAYER_DIRECTIONS) {
      const score = this.scoreDirectionChoice(
        evalX,
        evalY,
        args.player,
        direction,
        horizons,
        args.speed,
        args.enemies,
        args.enemyBullets,
        activePickupTarget,
        activePickupTarget ? directPickupDirection : null,
        nearestEnemyDistance,
        currentDanger,
        activeBulletCount,
        activeEnemyCount,
        bossActive,
      );
      scored.push({ direction, score });
    }

    scored.sort((a, b) => a.score - b.score);
    const rolloutSeconds = AUTOPLAYER_DECISION_INTERVAL_MS / 1000;
    const finalists = scored.slice(0, 6);
    let bestRollout = Number.POSITIVE_INFINITY;
    let bestDirection = scored[0].direction;
    for (const entry of finalists) {
      const augmented = this.rolloutAugmentedScore(
        evalX,
        evalY,
        args.player,
        entry.direction,
        entry.score,
        args.speed,
        args.enemies,
        args.enemyBullets,
        activePickupTarget,
        rolloutSeconds,
      );
      if (augmented < bestRollout) {
        bestRollout = augmented;
        bestDirection = entry.direction;
      }
    }

    if (this.direction.lengthSq() > 0) {
      let incumbent: Phaser.Math.Vector2 | null = null;
      let bestDot = -2;
      for (const d of AUTOPLAYER_DIRECTIONS) {
        if (d.lengthSq() === 0) continue;
        const dot = d.x * this.direction.x + d.y * this.direction.y;
        if (dot > bestDot) {
          bestDot = dot;
          incumbent = d;
        }
      }
      if (incumbent && bestDot >= 0.88) {
        const incEntry = scored.find((e) => e.direction === incumbent);
        if (incEntry) {
          const incRoll = this.rolloutAugmentedScore(
            evalX,
            evalY,
            args.player,
            incumbent,
            incEntry.score,
            args.speed,
            args.enemies,
            args.enemyBullets,
            activePickupTarget,
            rolloutSeconds,
          );
          if (incRoll < bestRollout + DIRECTION_HYSTERESIS) {
            bestDirection = incumbent;
          }
        }
      }
    }

    this.direction.copy(bestDirection.lengthSq() > 0 ? bestDirection.clone().normalize() : Phaser.Math.Vector2.ZERO);
    if (edgeDistance < this.policy.edgeResetDistance && currentDanger < this.policy.edgeResetDangerThreshold && nearestPickupDistance > 170) {
      const centerDirection = new Phaser.Math.Vector2(ARENA_WIDTH / 2 - args.player.x, ARENA_HEIGHT / 2 - args.player.y).normalize();
      this.direction.copy(centerDirection);
      this.targetPosition.set(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
      this.finishDecision("edge-reset", currentDanger, currentDanger, nearestPickupDistance, nearestEnemyDistance, pickupTarget, startedAt);
      this.nextDecisionAt = args.elapsedMs + AUTOPLAYER_DECISION_INTERVAL_MS;
      return this.targetPosition.clone();
    }
    const projectedHorizon = 0.28;
    const projectedX = Phaser.Math.Clamp(args.player.x + this.direction.x * args.speed * projectedHorizon, 22, ARENA_WIDTH - 22);
    const projectedY = Phaser.Math.Clamp(args.player.y + this.direction.y * args.speed * projectedHorizon, 22, ARENA_HEIGHT - 22);
    this.targetPosition.set(projectedX, projectedY);
    const projectedDanger = this.getHazardScoreAt(projectedX, projectedY, args.enemies, args.enemyBullets, args.player);
    this.finishDecision(activePickupTarget ? "scored-pickup" : "scored-survival", currentDanger, projectedDanger, nearestPickupDistance, nearestEnemyDistance, pickupTarget, startedAt);
    this.nextDecisionAt = args.elapsedMs + AUTOPLAYER_DECISION_INTERVAL_MS;
    return this.targetPosition.clone();
  }

  getTelemetrySnapshot(): AutoplayerTelemetry {
    return { ...this.lastTelemetry };
  }

  shouldDash(args: {
    player: Phaser.GameObjects.Shape;
    direction: Phaser.Math.Vector2;
    enemies: Phaser.Physics.Arcade.Group;
    enemyBullets: Phaser.Physics.Arcade.Group;
    dashSpeed: number;
    walkSpeed?: number;
  }): boolean {
    if (args.direction.lengthSq() === 0) return false;
    const horizon = 0.4;
    const currentRisk = this.scorePosition(args.player.x, args.player.y, horizon, args.enemies, args.enemyBullets, null, args.player);
    const dashX = Phaser.Math.Clamp(args.player.x + args.direction.x * args.dashSpeed * 0.25, 22, ARENA_WIDTH - 22);
    const dashY = Phaser.Math.Clamp(args.player.y + args.direction.y * args.dashSpeed * 0.25, 22, ARENA_HEIGHT - 22);
    const dashRisk = this.scorePosition(dashX, dashY, horizon, args.enemies, args.enemyBullets, null, args.player);
    const immediateRisk = this.getImmediateInterceptRisk(args.player, args.direction, args.dashSpeed * 0.5, args.enemyBullets);
    const walkSpeed = args.walkSpeed ?? args.dashSpeed * 0.35;
    const walkX = Phaser.Math.Clamp(args.player.x + args.direction.x * walkSpeed * 0.075, 22, ARENA_WIDTH - 22);
    const walkY = Phaser.Math.Clamp(args.player.y + args.direction.y * walkSpeed * 0.075, 22, ARENA_HEIGHT - 22);
    const walkRisk = this.scorePosition(walkX, walkY, horizon, args.enemies, args.enemyBullets, null, args.player);
    const measuredPlan = currentRisk > this.policy.dashHighRiskThreshold
      && dashRisk + this.policy.dashRiskGainRequired < currentRisk
      && dashRisk <= walkRisk + 6;
    const emergency = immediateRisk > 170 && dashRisk + 20 < currentRisk + immediateRisk * 0.08;
    return measuredPlan || emergency;
  }

  private scoreDirectionChoice(
    evalX: number,
    evalY: number,
    player: Phaser.GameObjects.Shape,
    direction: Phaser.Math.Vector2,
    horizons: number[],
    speed: number,
    enemies: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
    activePickupTarget: Phaser.Physics.Arcade.Image | null,
    directPickupDirection: Phaser.Math.Vector2 | null,
    nearestEnemyDistance: number,
    currentDanger: number,
    activeBulletCount: number,
    activeEnemyCount: number,
    bossActive: boolean,
  ): number {
    let score = 0;
    for (const horizon of horizons) {
      let weight = horizon < 0.12
        ? this.policy.horizonNearWeight
        : horizon < 0.25
          ? this.policy.horizonMidWeight
          : horizon < 0.6
            ? this.policy.horizonFarWeight
            : this.policy.horizonFarWeight * 0.52;
      if (bossActive && horizon >= 0.58) weight *= BOSS_FAR_HORIZON_WEIGHT_MULT;
      const x = Phaser.Math.Clamp(evalX + direction.x * speed * horizon, 22, ARENA_WIDTH - 22);
      const y = Phaser.Math.Clamp(evalY + direction.y * speed * horizon, 22, ARENA_HEIGHT - 22);
      score += this.scorePosition(x, y, horizon, enemies, enemyBullets, activePickupTarget, player) * weight;
    }
    score += this.getImmediateInterceptRisk(player, direction, speed, enemyBullets) * this.policy.interceptRiskWeight;

    if (direction.lengthSq() > 0 && direction.dot(this.direction) < -0.25) {
      score += this.policy.reverseDirectionPenalty;
    }
    if (direction.lengthSq() > 0) {
      const nextX = Phaser.Math.Clamp(evalX + direction.x * 42, 22, ARENA_WIDTH - 22);
      const nextY = Phaser.Math.Clamp(evalY + direction.y * 42, 22, ARENA_HEIGHT - 22);
      const nextEdge = Math.min(nextX, ARENA_WIDTH - nextX, nextY, ARENA_HEIGHT - nextY);
      if (nextEdge < 72) score += ((72 - nextEdge) / 72) * this.policy.nearEdgePenaltyScale;
    }
    if (direction.lengthSq() === 0) {
      if (nearestEnemyDistance < 240) score += this.policy.idleEnemyPenalty;
      else if (activeEnemyCount > 4) score += this.policy.idleBusyPenalty;
      if (!activePickupTarget && currentDanger < 1.15 && activeBulletCount < 10) score += this.policy.idleCalmPenalty;
    }
    if (activePickupTarget && direction.lengthSq() === 0 && this.getHazardScoreAt(player.x, player.y, enemies, enemyBullets, player) < 2.5) {
      score += this.policy.pickupIdlePenalty;
    }
    if (activePickupTarget && directPickupDirection && direction.lengthSq() > 0) {
      const pickupBias = activeBulletCount > 10 ? this.policy.pickupBiasScale * 0.43 : this.policy.pickupBiasScale;
      score -= Math.max(0, direction.dot(directPickupDirection)) * pickupBias;
    }
    return score;
  }

  private rolloutAugmentedScore(
    evalX: number,
    evalY: number,
    player: Phaser.GameObjects.Shape,
    direction: Phaser.Math.Vector2,
    baseScore: number,
    speed: number,
    enemies: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
    pickupTarget: Phaser.Physics.Arcade.Image | null,
    rolloutSeconds: number,
  ): number {
    if (direction.lengthSq() === 0) return baseScore;
    let rollCost = baseScore;
    let px = evalX;
    let py = evalY;
    for (let s = 0; s < 2; s += 1) {
      px = Phaser.Math.Clamp(px + direction.x * speed * rolloutSeconds, 22, ARENA_WIDTH - 22);
      py = Phaser.Math.Clamp(py + direction.y * speed * rolloutSeconds, 22, ARENA_HEIGHT - 22);
      rollCost += this.scorePosition(px, py, 0.34, enemies, enemyBullets, pickupTarget, player) * (s === 0 ? 0.52 : 0.38);
    }
    return rollCost;
  }

  private scorePosition(
    x: number,
    y: number,
    horizonSeconds: number,
    enemies: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
    pickupTarget: Phaser.Physics.Arcade.Image | null,
    player: Phaser.GameObjects.Shape,
  ): number {
    let score = 0;
    const pickupDistance = pickupTarget ? Phaser.Math.Distance.Between(x, y, pickupTarget.x, pickupTarget.y) : 0;
    const currentPickupDistance = pickupTarget ? Phaser.Math.Distance.Between(player.x, player.y, pickupTarget.x, pickupTarget.y) : 0;
    const pickupProgress = pickupTarget ? (currentPickupDistance - pickupDistance) / Math.max(1, currentPickupDistance) : 0;
    const pickupEdge = pickupTarget ? Math.min(pickupTarget.x, ARENA_WIDTH - pickupTarget.x, pickupTarget.y, ARENA_HEIGHT - pickupTarget.y) : Number.POSITIVE_INFINITY;
    const edge = Math.min(x, ARENA_WIDTH - x, y, ARENA_HEIGHT - y);
    let edgePenalty = 0;
    if (edge < 54) edgePenalty = 140 + (54 - edge) * 4.5;
    else if (edge < 140) edgePenalty = ((140 - edge) / 140) * 18;

    if (pickupTarget && pickupEdge < 90 && (pickupDistance < 155 || pickupProgress > 0.18)) {
      edgePenalty *= 0.3;
    }
    if (edge < 160) score += ((160 - edge) / 160) * 12;
    score += edgePenalty;

    score += this.getBulletRiskAt(x, y, horizonSeconds, enemyBullets);
    score += this.getEnemyRiskAt(x, y, horizonSeconds, enemies, player);
    score += this.getEscapePenaltyAt(x, y, enemies, enemyBullets, player);
    score -= this.getOpenAreaScore(x, y, enemies, enemyBullets, player) * this.policy.openAreaRewardScale;
    const immediateHazard = this.getHazardScoreAt(x, y, enemies, enemyBullets, player);

    if (!pickupTarget || immediateHazard > 3.5) {
      const centerDistance = Phaser.Math.Distance.Between(x, y, ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
      score += (Math.max(0, centerDistance - 185) / 95) * this.policy.centerPullScale;
    }

    if (pickupTarget) {
      const pickupRisk = this.getHazardScoreAt(pickupTarget.x, pickupTarget.y, enemies, enemyBullets, player);
      if (pickupRisk < this.policy.pickupSafetyHazardThreshold) {
        score -= Phaser.Math.Clamp(pickupProgress, -0.8, 1) * 13;
        score += pickupDistance / 90;
        if (pickupDistance < 220) score -= ((220 - pickupDistance) / 220) * 7;
        if (pickupDistance < 48) score -= 14;
      }
    }

    return score;
  }

  private choosePickupTarget(
    player: Phaser.GameObjects.Shape,
    pickups: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
    enemies: Phaser.Physics.Arcade.Group,
  ): Phaser.Physics.Arcade.Image | null {
    if (this.pickupTarget && (!this.pickupTarget.active || !pickups.contains(this.pickupTarget))) {
      this.pickupTarget = null;
    }

    const currentScore = this.pickupTarget ? this.scorePickupTarget(this.pickupTarget, player, pickups, enemyBullets, enemies) : Number.POSITIVE_INFINITY;
    let best: Phaser.Physics.Arcade.Image | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    const entries = pickups.children.entries as Phaser.Physics.Arcade.Image[];
    for (let i = 0; i < entries.length; i += 1) {
      const pickup = entries[i];
      if (!pickup?.active) continue;
      const score = this.scorePickupTarget(pickup, player, pickups, enemyBullets, enemies);
      if (score < bestScore) {
        best = pickup;
        bestScore = score;
      }
    }

    if (!best || bestScore === Number.POSITIVE_INFINITY) {
      this.pickupTarget = null;
      return null;
    }

    if (!this.pickupTarget || bestScore + 70 < currentScore) {
      this.pickupTarget = best;
    }

    return this.pickupTarget;
  }

  private scorePickupTarget(
    pickup: Phaser.Physics.Arcade.Image,
    player: Phaser.GameObjects.Shape,
    pickups: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
    enemies: Phaser.Physics.Arcade.Group,
  ): number {
    const hazard = this.getHazardScoreAt(pickup.x, pickup.y, enemies, enemyBullets, player);
    if (hazard >= 5.2) return Number.POSITIVE_INFINITY;

    const distance = Phaser.Math.Distance.Between(player.x, player.y, pickup.x, pickup.y);
    const clusterBonus = this.getPickupClusterBonus(pickup, pickups);
    const value = Number(pickup.getData("value") || 1);
    return distance + hazard * 105 - clusterBonus - value * 26;
  }

  private shouldMoveDirectlyToPickup(
    player: Phaser.GameObjects.Shape,
    pickup: Phaser.Physics.Arcade.Image,
    enemies: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
  ): boolean {
    const currentHazard = this.getHazardScoreAt(player.x, player.y, enemies, enemyBullets, player);
    const pickupHazard = this.getHazardScoreAt(pickup.x, pickup.y, enemies, enemyBullets, player);
    if (currentHazard > this.policy.directPickupCurrentHazardThreshold || pickupHazard > this.policy.directPickupTargetHazardThreshold) return false;

    const distance = Phaser.Math.Distance.Between(player.x, player.y, pickup.x, pickup.y);
    const samples = Math.max(8, Math.ceil(distance / 48));
    for (let i = 1; i <= samples; i += 1) {
      const t = i / samples;
      const x = Phaser.Math.Linear(player.x, pickup.x, t);
      const y = Phaser.Math.Linear(player.y, pickup.y, t);
      if (this.getHazardScoreAt(x, y, enemies, enemyBullets, player) > this.policy.directPickupPathHazardThreshold) return false;
    }

    return true;
  }

  private getPickupClusterBonus(target: Phaser.Physics.Arcade.Image, pickups: Phaser.Physics.Arcade.Group): number {
    let bonus = 0;
    const entries = pickups.children.entries as Phaser.Physics.Arcade.Image[];
    for (let i = 0; i < entries.length; i += 1) {
      const pickup = entries[i];
      if (!pickup?.active || pickup === target) continue;
      const distance = Phaser.Math.Distance.Between(target.x, target.y, pickup.x, pickup.y);
      if (distance < 150) bonus += ((150 - distance) / 150) * Number(pickup.getData("value") || 1);
    }
    return Math.min(90, bonus * 24);
  }

  private getHazardScoreAt(
    x: number,
    y: number,
    enemies: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
    player: Phaser.GameObjects.Shape,
  ): number {
    const horizon = 0.45;
    return this.getBulletRiskAt(x, y, horizon, enemyBullets) / 24 + this.getEnemyRiskAt(x, y, horizon, enemies, player) / 42;
  }

  private getBulletRiskAt(x: number, y: number, horizonSeconds: number, enemyBullets: Phaser.Physics.Arcade.Group): number {
    let risk = 0;
    const entries = enemyBullets.children.entries as Phaser.Physics.Arcade.Image[];

    for (let i = 0; i < entries.length; i += 1) {
      const bullet = entries[i];
      if (!bullet?.active) continue;
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      const vx = body.velocity.x;
      const vy = body.velocity.y;
      const dx = x - bullet.x;
      const dy = y - bullet.y;
      const speedSq = vx * vx + vy * vy;
      const secondsToClosest = speedSq > 0 ? Phaser.Math.Clamp((dx * vx + dy * vy) / speedSq, 0, horizonSeconds + 0.35) : 0;
      const closestX = bullet.x + vx * secondsToClosest;
      const closestY = bullet.y + vy * secondsToClosest;
      const closestDistance = Phaser.Math.Distance.Between(x, y, closestX, closestY);
      const currentDistance = Phaser.Math.Distance.Between(x, y, bullet.x, bullet.y);
      const bulletRadius = 42;

      if (closestDistance < bulletRadius) risk += 340 + (bulletRadius - closestDistance) * 19;
      else if (closestDistance < 110) risk += ((110 - closestDistance) / 110) * 62;
      else if (currentDistance < 72) risk += ((72 - currentDistance) / 72) * 26;
    }

    return risk;
  }

  private getOpenAreaScore(
    x: number,
    y: number,
    enemies: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
    player: Phaser.GameObjects.Shape,
  ): number {
    let safe = 0;
    const probeDistance = 96;
    for (const direction of AUTOPLAYER_DIRECTIONS) {
      if (direction.lengthSq() === 0) continue;
      const probeX = Phaser.Math.Clamp(x + direction.x * probeDistance, 22, ARENA_WIDTH - 22);
      const probeY = Phaser.Math.Clamp(y + direction.y * probeDistance, 22, ARENA_HEIGHT - 22);
      const risk = this.getBulletRiskAt(probeX, probeY, 0.34, enemyBullets) + this.getEnemyRiskAt(probeX, probeY, 0.34, enemies, player);
      if (risk < 20) safe += 1;
    }
    return safe / 8;
  }

  private getEnemyRiskAt(x: number, y: number, horizonSeconds: number, enemies: Phaser.Physics.Arcade.Group, player: Phaser.GameObjects.Shape): number {
    let risk = 0;
    const entries = enemies.children.entries as Phaser.GameObjects.Shape[];
    for (let i = 0; i < entries.length; i += 1) {
      const enemy = entries[i];
      if (!enemy?.active) continue;
      const data = enemy.getData("enemy") as EnemyData;
      const body = enemy.body as Phaser.Physics.Arcade.Body | undefined;
      const hasVelocity = Boolean(body && Number.isFinite(body.velocity.x) && Number.isFinite(body.velocity.y));
      const velocityX = hasVelocity ? body!.velocity.x : Math.cos(Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y)) * data.speed;
      const velocityY = hasVelocity ? body!.velocity.y : Math.sin(Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y)) * data.speed;
      const projectedX = enemy.x + velocityX * horizonSeconds;
      const projectedY = enemy.y + velocityY * horizonSeconds;
      const distance = Phaser.Math.Distance.Between(x, y, projectedX, projectedY);

      if (distance < 34) risk += 220;
      else if (distance < 105) risk += ((105 - distance) / 105) * 42;
      else if (distance < 190 && data.kind === "chaser") risk += ((190 - distance) / 190) * 8;
    }
    return risk;
  }

  private getEscapePenaltyAt(
    x: number,
    y: number,
    enemies: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
    player: Phaser.GameObjects.Shape,
  ): number {
    let safeDirections = 0;
    const probeDistance = 82;

    for (const direction of AUTOPLAYER_DIRECTIONS) {
      if (direction.lengthSq() === 0) continue;
      const probeX = Phaser.Math.Clamp(x + direction.x * probeDistance, 22, ARENA_WIDTH - 22);
      const probeY = Phaser.Math.Clamp(y + direction.y * probeDistance, 22, ARENA_HEIGHT - 22);
      const probeHorizon = 0.38;
      const risk = this.getBulletRiskAt(probeX, probeY, probeHorizon, enemyBullets) + this.getEnemyRiskAt(probeX, probeY, probeHorizon, enemies, player);
      if (risk < 18) safeDirections += 1;
    }

    if (safeDirections <= 1) return 42;
    if (safeDirections <= 3) return 16;
    if (safeDirections <= 5) return 5;
    return 0;
  }

  private getImmediateInterceptRisk(
    player: Phaser.GameObjects.Shape,
    direction: Phaser.Math.Vector2,
    speed: number,
    enemyBullets: Phaser.Physics.Arcade.Group,
  ): number {
    if (direction.lengthSq() === 0) return 18;
    let risk = 0;
    const moveVx = direction.x * speed;
    const moveVy = direction.y * speed;
    const entries = enemyBullets.children.entries as Phaser.Physics.Arcade.Image[];

    for (let i = 0; i < entries.length; i += 1) {
      const bullet = entries[i];
      if (!bullet?.active) continue;
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      const rvx = body.velocity.x - moveVx;
      const rvy = body.velocity.y - moveVy;
      const rx = player.x - bullet.x;
      const ry = player.y - bullet.y;
      const relSpeedSq = rvx * rvx + rvy * rvy;
      const t = relSpeedSq > 0 ? Phaser.Math.Clamp((rx * rvx + ry * rvy) / relSpeedSq, 0, 0.28) : 0;
      const cx = bullet.x + body.velocity.x * t;
      const cy = bullet.y + body.velocity.y * t;
      const px = player.x + moveVx * t;
      const py = player.y + moveVy * t;
      const dist = Phaser.Math.Distance.Between(px, py, cx, cy);

      if (dist < 34) risk += 230 + (34 - dist) * 20;
      else if (dist < 76) risk += ((76 - dist) / 76) * 72;
    }
    return risk;
  }

  private finishDecision(
    reason: string,
    danger: number,
    projectedDanger: number,
    nearestPickupDistance: number,
    nearestEnemyDistance: number,
    pickupTarget: Phaser.Physics.Arcade.Image | null,
    startedAt: number,
  ) {
    this.lastTelemetry = {
      directionX: this.direction.x,
      directionY: this.direction.y,
      reason,
      danger,
      projectedDanger,
      nearestPickupDistance,
      nearestEnemyDistance,
      pickupTargetX: pickupTarget?.x ?? null,
      pickupTargetY: pickupTarget?.y ?? null,
      pickupTargetValue: Number(pickupTarget?.getData("value") || 0),
      decisionTimeMs: performance.now() - startedAt,
      lookaheadRisk: 0,
      dashCurrentRisk: 0,
      dashProjectedRisk: 0,
      dashImmediateRisk: 0,
      dashWouldUse: false,
      safeDirections: 0,
      selectedDirectionRisk: 0,
      bestAlternativeRisk: 0,
      riskGap: 0,
      incomingDensity: 0,
    };
  }

  private getNearestEnemyDistance(x: number, y: number, enemies: Phaser.Physics.Arcade.Group): number {
    let best = Number.POSITIVE_INFINITY;
    const entries = enemies.children.entries as Phaser.GameObjects.Shape[];
    for (let i = 0; i < entries.length; i += 1) {
      const enemy = entries[i];
      if (!enemy?.active) continue;
      const distance = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
      if (distance < best) best = distance;
    }
    return best;
  }
}
