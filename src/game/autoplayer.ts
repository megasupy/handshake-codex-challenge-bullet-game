import Phaser from "phaser";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  AUTOPLAYER_BULLET_SCAN_LIMIT,
  AUTOPLAYER_DECISION_INTERVAL_MS,
  AUTOPLAYER_DIRECTIONS,
  AUTOPLAYER_ENEMY_SCAN_LIMIT,
  AUTOPLAYER_PICKUP_SCAN_LIMIT,
} from "./constants";
import type { AutoplayerTelemetry, EnemyData } from "./gameTypes";

export class Autoplayer {
  private direction = new Phaser.Math.Vector2(0, 0);
  private pickupTarget: Phaser.Physics.Arcade.Image | null = null;
  private nextDecisionAt = 0;
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
  };

  chooseDirection(args: {
    elapsedMs: number;
    player: Phaser.GameObjects.Shape;
    enemies: Phaser.Physics.Arcade.Group;
    enemyBullets: Phaser.Physics.Arcade.Group;
    pickups: Phaser.Physics.Arcade.Group;
    speed: number;
    timeScale: number;
  }): Phaser.Math.Vector2 {
    if (args.elapsedMs < this.nextDecisionAt) return this.direction.clone();

    const startedAt = performance.now();
    const scale = Math.max(0.1, args.timeScale);
    const horizons = [0.14, 0.3, 0.5, 0.75, 1.05].map((value) => value / scale);
    const activeBulletCount = args.enemyBullets.countActive(true);
    const activeEnemyCount = args.enemies.countActive(true);
    const pickupTarget = this.choosePickupTarget(args.player, args.pickups, args.enemyBullets, args.enemies, scale);
    const directPickupDirection = pickupTarget
      ? new Phaser.Math.Vector2(pickupTarget.x - args.player.x, pickupTarget.y - args.player.y).normalize()
      : null;
    const currentDanger = this.getHazardScoreAt(args.player.x, args.player.y, args.enemies, args.enemyBullets, args.player, scale);
    const nearestEnemyDistance = this.getNearestEnemyDistance(args.player.x, args.player.y, args.enemies);
    const nearestPickupDistance = pickupTarget ? Phaser.Math.Distance.Between(args.player.x, args.player.y, pickupTarget.x, pickupTarget.y) : Number.POSITIVE_INFINITY;
    const edgeDistance = Math.min(args.player.x, ARENA_WIDTH - args.player.x, args.player.y, ARENA_HEIGHT - args.player.y);
    const prioritizeSurvival = currentDanger >= 1.8 || activeBulletCount >= 8 || activeEnemyCount >= 8;
    const activePickupTarget = prioritizeSurvival ? null : pickupTarget;

    if (
      pickupTarget &&
      directPickupDirection &&
      this.shouldMoveDirectlyToPickup(args.player, pickupTarget, args.enemies, args.enemyBullets, scale) &&
      activeBulletCount < 10 &&
      activeEnemyCount < 9 &&
      !prioritizeSurvival
    ) {
      this.direction.copy(directPickupDirection);
      this.finishDecision("pickup-direct", currentDanger, currentDanger, nearestPickupDistance, nearestEnemyDistance, pickupTarget, startedAt);
      this.nextDecisionAt = args.elapsedMs + AUTOPLAYER_DECISION_INTERVAL_MS;
      return this.direction.clone();
    }
    let bestDirection = AUTOPLAYER_DIRECTIONS[0];
    let bestScore = Number.POSITIVE_INFINITY;

    for (const direction of AUTOPLAYER_DIRECTIONS) {
      let score = 0;
      for (const horizon of horizons) {
        const weight = horizon < 0.2 ? 2.1 : horizon < 0.55 ? 1.35 : 0.72;
        const x = Phaser.Math.Clamp(args.player.x + direction.x * args.speed * horizon, 22, ARENA_WIDTH - 22);
        const y = Phaser.Math.Clamp(args.player.y + direction.y * args.speed * horizon, 22, ARENA_HEIGHT - 22);
        score += this.scorePosition(x, y, horizon, args.enemies, args.enemyBullets, activePickupTarget, args.player, scale) * weight;
      }

      if (direction.lengthSq() > 0 && direction.dot(this.direction) < -0.25) {
        score += 0.35;
      }
      if (direction.lengthSq() === 0) {
        if (nearestEnemyDistance < 240) score += 36;
        else if (activeEnemyCount > 4) score += 14;
      }
      if (activePickupTarget && direction.lengthSq() === 0 && this.getHazardScoreAt(args.player.x, args.player.y, args.enemies, args.enemyBullets, args.player, scale) < 2.5) {
        score += 8;
      }
      if (activePickupTarget && directPickupDirection && direction.lengthSq() > 0) {
        const pickupBias = activeBulletCount > 12 ? 1.8 : 4.5;
        score -= Math.max(0, direction.dot(directPickupDirection)) * pickupBias;
      }

      if (score < bestScore) {
        bestScore = score;
        bestDirection = direction;
      }
    }

    this.direction.copy(bestDirection.lengthSq() > 0 ? bestDirection.clone().normalize() : Phaser.Math.Vector2.ZERO);
    if (edgeDistance < 130 && currentDanger < 9 && nearestPickupDistance > 170) {
      const centerDirection = new Phaser.Math.Vector2(ARENA_WIDTH / 2 - args.player.x, ARENA_HEIGHT / 2 - args.player.y).normalize();
      this.direction.copy(centerDirection);
      this.finishDecision("edge-reset", currentDanger, currentDanger, nearestPickupDistance, nearestEnemyDistance, pickupTarget, startedAt);
      this.nextDecisionAt = args.elapsedMs + AUTOPLAYER_DECISION_INTERVAL_MS;
      return this.direction.clone();
    }
    const projectedHorizon = 0.28 / scale;
    const projectedX = Phaser.Math.Clamp(args.player.x + this.direction.x * args.speed * projectedHorizon, 22, ARENA_WIDTH - 22);
    const projectedY = Phaser.Math.Clamp(args.player.y + this.direction.y * args.speed * projectedHorizon, 22, ARENA_HEIGHT - 22);
    const projectedDanger = this.getHazardScoreAt(projectedX, projectedY, args.enemies, args.enemyBullets, args.player, scale);
    this.finishDecision(activePickupTarget ? "scored-pickup" : "scored-survival", currentDanger, projectedDanger, nearestPickupDistance, nearestEnemyDistance, pickupTarget, startedAt);
    this.nextDecisionAt = args.elapsedMs + AUTOPLAYER_DECISION_INTERVAL_MS;
    return this.direction.clone();
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
    timeScale: number;
  }): boolean {
    if (args.direction.lengthSq() === 0) return false;
    const scale = Math.max(0.1, args.timeScale);
    const horizon = 0.32 / scale;
    const currentRisk = this.scorePosition(args.player.x, args.player.y, horizon, args.enemies, args.enemyBullets, null, args.player, scale);
    const dashX = Phaser.Math.Clamp(args.player.x + args.direction.x * args.dashSpeed * (0.25 / scale), 22, ARENA_WIDTH - 22);
    const dashY = Phaser.Math.Clamp(args.player.y + args.direction.y * args.dashSpeed * (0.25 / scale), 22, ARENA_HEIGHT - 22);
    const dashRisk = this.scorePosition(dashX, dashY, horizon, args.enemies, args.enemyBullets, null, args.player, scale);
    return currentRisk > 38 && dashRisk + 16 < currentRisk;
  }

  private scorePosition(
    x: number,
    y: number,
    horizonSeconds: number,
    enemies: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
    pickupTarget: Phaser.Physics.Arcade.Image | null,
    player: Phaser.GameObjects.Shape,
    timeScale: number,
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

    score += this.getBulletRiskAt(x, y, horizonSeconds, enemyBullets, timeScale);
    score += this.getEnemyRiskAt(x, y, horizonSeconds, enemies, player);
    score += this.getEscapePenaltyAt(x, y, enemies, enemyBullets, player, timeScale);
    const immediateHazard = this.getHazardScoreAt(x, y, enemies, enemyBullets, player, timeScale);

    if (!pickupTarget || immediateHazard > 3.5) {
      const centerDistance = Phaser.Math.Distance.Between(x, y, ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
      score += Math.max(0, centerDistance - 185) / 95;
    }

    if (pickupTarget) {
      const pickupRisk = this.getHazardScoreAt(pickupTarget.x, pickupTarget.y, enemies, enemyBullets, player, timeScale);
      if (pickupRisk < 4.2) {
        score -= Phaser.Math.Clamp(pickupProgress, -0.8, 1) * 18;
        score += pickupDistance / 90;
        if (pickupDistance < 220) score -= ((220 - pickupDistance) / 220) * 10;
        if (pickupDistance < 48) score -= 22;
      }
    }

    return score;
  }

  private choosePickupTarget(
    player: Phaser.GameObjects.Shape,
    pickups: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
    enemies: Phaser.Physics.Arcade.Group,
    timeScale: number,
  ): Phaser.Physics.Arcade.Image | null {
    if (this.pickupTarget && (!this.pickupTarget.active || !pickups.contains(this.pickupTarget))) {
      this.pickupTarget = null;
    }

    const currentScore = this.pickupTarget ? this.scorePickupTarget(this.pickupTarget, player, pickups, enemyBullets, enemies, timeScale) : Number.POSITIVE_INFINITY;
    let best: Phaser.Physics.Arcade.Image | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    const entries = pickups.children.entries as Phaser.Physics.Arcade.Image[];
    const step = Math.max(1, Math.ceil(entries.length / AUTOPLAYER_PICKUP_SCAN_LIMIT));
    for (let i = 0; i < entries.length; i += step) {
      const pickup = entries[i];
      if (!pickup?.active) continue;
      const score = this.scorePickupTarget(pickup, player, pickups, enemyBullets, enemies, timeScale);
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
    timeScale: number,
  ): number {
    const hazard = this.getHazardScoreAt(pickup.x, pickup.y, enemies, enemyBullets, player, timeScale);
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
    timeScale: number,
  ): boolean {
    const currentHazard = this.getHazardScoreAt(player.x, player.y, enemies, enemyBullets, player, timeScale);
    const pickupHazard = this.getHazardScoreAt(pickup.x, pickup.y, enemies, enemyBullets, player, timeScale);
    if (currentHazard > 2.2 || pickupHazard > 3.8) return false;

    const distance = Phaser.Math.Distance.Between(player.x, player.y, pickup.x, pickup.y);
    const samples = Math.max(2, Math.ceil(distance / 110));
    for (let i = 1; i <= samples; i += 1) {
      const t = i / samples;
      const x = Phaser.Math.Linear(player.x, pickup.x, t);
      const y = Phaser.Math.Linear(player.y, pickup.y, t);
      if (this.getHazardScoreAt(x, y, enemies, enemyBullets, player, timeScale) > 3.2) return false;
    }

    return true;
  }

  private getPickupClusterBonus(target: Phaser.Physics.Arcade.Image, pickups: Phaser.Physics.Arcade.Group): number {
    let bonus = 0;
    const entries = pickups.children.entries as Phaser.Physics.Arcade.Image[];
    const step = Math.max(1, Math.ceil(entries.length / AUTOPLAYER_PICKUP_SCAN_LIMIT));
    for (let i = 0; i < entries.length; i += step) {
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
    timeScale: number,
  ): number {
    const horizon = 0.45 / Math.max(0.1, timeScale);
    return this.getBulletRiskAt(x, y, horizon, enemyBullets, timeScale) / 24 + this.getEnemyRiskAt(x, y, horizon, enemies, player) / 42;
  }

  private getBulletRiskAt(x: number, y: number, horizonSeconds: number, enemyBullets: Phaser.Physics.Arcade.Group, timeScale: number): number {
    let risk = 0;
    const entries = enemyBullets.children.entries as Phaser.Physics.Arcade.Image[];
    const step = Math.max(1, Math.ceil(entries.length / AUTOPLAYER_BULLET_SCAN_LIMIT));
    const scale = Math.max(0.1, timeScale);

    for (let i = 0; i < entries.length; i += step) {
      const bullet = entries[i];
      if (!bullet?.active) continue;
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      const vx = body.velocity.x;
      const vy = body.velocity.y;
      const dx = x - bullet.x;
      const dy = y - bullet.y;
      const speedSq = vx * vx + vy * vy;
      const secondsToClosest = speedSq > 0 ? Phaser.Math.Clamp((dx * vx + dy * vy) / speedSq, 0, horizonSeconds + 0.35 / scale) : 0;
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

  private getEnemyRiskAt(x: number, y: number, horizonSeconds: number, enemies: Phaser.Physics.Arcade.Group, player: Phaser.GameObjects.Shape): number {
    let risk = 0;
    const entries = enemies.children.entries as Phaser.GameObjects.Shape[];
    const step = Math.max(1, Math.ceil(entries.length / AUTOPLAYER_ENEMY_SCAN_LIMIT));
    for (let i = 0; i < entries.length; i += step) {
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
    timeScale: number,
  ): number {
    let safeDirections = 0;
    const probeDistance = 82;

    for (const direction of AUTOPLAYER_DIRECTIONS) {
      if (direction.lengthSq() === 0) continue;
      const probeX = Phaser.Math.Clamp(x + direction.x * probeDistance, 22, ARENA_WIDTH - 22);
      const probeY = Phaser.Math.Clamp(y + direction.y * probeDistance, 22, ARENA_HEIGHT - 22);
      const probeHorizon = 0.38 / Math.max(0.1, timeScale);
      const risk = this.getBulletRiskAt(probeX, probeY, probeHorizon, enemyBullets, timeScale) + this.getEnemyRiskAt(probeX, probeY, probeHorizon, enemies, player);
      if (risk < 18) safeDirections += 1;
    }

    if (safeDirections <= 1) return 42;
    if (safeDirections <= 3) return 16;
    if (safeDirections <= 5) return 5;
    return 0;
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
    };
  }

  private getNearestEnemyDistance(x: number, y: number, enemies: Phaser.Physics.Arcade.Group): number {
    let best = Number.POSITIVE_INFINITY;
    const entries = enemies.children.entries as Phaser.GameObjects.Shape[];
    const step = Math.max(1, Math.ceil(entries.length / AUTOPLAYER_ENEMY_SCAN_LIMIT));
    for (let i = 0; i < entries.length; i += step) {
      const enemy = entries[i];
      if (!enemy?.active) continue;
      const distance = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
      if (distance < best) best = distance;
    }
    return best;
  }
}
