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
  private targetPosition = new Phaser.Math.Vector2(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
  private pickupTarget: Phaser.Physics.Arcade.Image | null = null;
  private nextDecisionAt = 0;
  private bulletSampleOffset = 0;
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

  reset(): void {
    this.direction.set(0, 0);
    this.targetPosition.set(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
    this.pickupTarget = null;
    this.nextDecisionAt = 0;
    this.bulletSampleOffset = 0;
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
    };
  }

  chooseTargetPosition(args: {
    elapsedMs: number;
    player: Phaser.GameObjects.Shape;
    enemies: Phaser.Physics.Arcade.Group;
    enemyBullets: Phaser.Physics.Arcade.Group;
    pickups: Phaser.Physics.Arcade.Group;
    speed: number;
  }): Phaser.Math.Vector2 {
    if (args.elapsedMs < this.nextDecisionAt) return this.targetPosition.clone();

    const startedAt = performance.now();
    this.bulletSampleOffset += 1;
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
    const prioritizeSurvival = currentDanger >= 1.05 || activeBulletCount >= 5 || activeEnemyCount >= 6;
    const activePickupTarget = prioritizeSurvival ? null : pickupTarget;

    if (
      pickupTarget &&
      directPickupDirection &&
      this.shouldMoveDirectlyToPickup(args.player, pickupTarget, args.enemies, args.enemyBullets) &&
      activeBulletCount < 8 &&
      activeEnemyCount < 8 &&
      !prioritizeSurvival
    ) {
      this.direction.copy(directPickupDirection);
      this.targetPosition.set(args.player.x + this.direction.x * args.speed * 0.3, args.player.y + this.direction.y * args.speed * 0.3);
      this.finishDecision("pickup-direct", currentDanger, currentDanger, nearestPickupDistance, nearestEnemyDistance, pickupTarget, startedAt);
      this.nextDecisionAt = args.elapsedMs + AUTOPLAYER_DECISION_INTERVAL_MS;
      return this.targetPosition.clone();
    }
    let bestDirection = AUTOPLAYER_DIRECTIONS[0];
    let bestScore = Number.POSITIVE_INFINITY;

    for (const direction of AUTOPLAYER_DIRECTIONS) {
      let score = 0;
      for (const horizon of horizons) {
        const weight = horizon < 0.12 ? 3.8 : horizon < 0.25 ? 2.5 : horizon < 0.6 ? 1.45 : 0.75;
        const x = Phaser.Math.Clamp(args.player.x + direction.x * args.speed * horizon, 22, ARENA_WIDTH - 22);
        const y = Phaser.Math.Clamp(args.player.y + direction.y * args.speed * horizon, 22, ARENA_HEIGHT - 22);
        score += this.scorePosition(x, y, horizon, args.enemies, args.enemyBullets, activePickupTarget, args.player) * weight;
      }
      score += this.getImmediateInterceptRisk(args.player, direction, args.speed, args.enemyBullets) * 0.72;

      if (direction.lengthSq() > 0 && direction.dot(this.direction) < -0.25) {
        score += 0.35;
      }
      if (direction.lengthSq() > 0) {
        const nextX = Phaser.Math.Clamp(args.player.x + direction.x * 42, 22, ARENA_WIDTH - 22);
        const nextY = Phaser.Math.Clamp(args.player.y + direction.y * 42, 22, ARENA_HEIGHT - 22);
        const nextEdge = Math.min(nextX, ARENA_WIDTH - nextX, nextY, ARENA_HEIGHT - nextY);
        if (nextEdge < 72) score += ((72 - nextEdge) / 72) * 22;
      }
      if (direction.lengthSq() === 0) {
        if (nearestEnemyDistance < 240) score += 36;
        else if (activeEnemyCount > 4) score += 14;
        if (!activePickupTarget && currentDanger < 1.15 && activeBulletCount < 10) score += 12;
      }
      if (activePickupTarget && direction.lengthSq() === 0 && this.getHazardScoreAt(args.player.x, args.player.y, args.enemies, args.enemyBullets, args.player) < 2.5) {
        score += 8;
      }
      if (activePickupTarget && directPickupDirection && direction.lengthSq() > 0) {
        const pickupBias = activeBulletCount > 10 ? 1.2 : 2.8;
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
  }): boolean {
    if (args.direction.lengthSq() === 0) return false;
    const horizon = 0.4;
    const currentRisk = this.scorePosition(args.player.x, args.player.y, horizon, args.enemies, args.enemyBullets, null, args.player);
    const dashX = Phaser.Math.Clamp(args.player.x + args.direction.x * args.dashSpeed * 0.25, 22, ARENA_WIDTH - 22);
    const dashY = Phaser.Math.Clamp(args.player.y + args.direction.y * args.dashSpeed * 0.25, 22, ARENA_HEIGHT - 22);
    const dashRisk = this.scorePosition(dashX, dashY, horizon, args.enemies, args.enemyBullets, null, args.player);
    const immediateRisk = this.getImmediateInterceptRisk(args.player, args.direction, args.dashSpeed * 0.5, args.enemyBullets);
    return (currentRisk > 28 && dashRisk + 10 < currentRisk) || (immediateRisk > 170 && dashRisk + 20 < currentRisk + immediateRisk * 0.08);
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
    score -= this.getOpenAreaScore(x, y, enemies, enemyBullets, player) * 1.8;
    const immediateHazard = this.getHazardScoreAt(x, y, enemies, enemyBullets, player);

    if (!pickupTarget || immediateHazard > 3.5) {
      const centerDistance = Phaser.Math.Distance.Between(x, y, ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
      score += Math.max(0, centerDistance - 185) / 95;
    }

    if (pickupTarget) {
      const pickupRisk = this.getHazardScoreAt(pickupTarget.x, pickupTarget.y, enemies, enemyBullets, player);
      if (pickupRisk < 4.2) {
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
    const step = Math.max(1, Math.ceil(entries.length / AUTOPLAYER_PICKUP_SCAN_LIMIT));
    for (let i = 0; i < entries.length; i += step) {
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
    if (currentHazard > 1.6 || pickupHazard > 2.7) return false;

    const distance = Phaser.Math.Distance.Between(player.x, player.y, pickup.x, pickup.y);
    const samples = Math.max(2, Math.ceil(distance / 110));
    for (let i = 1; i <= samples; i += 1) {
      const t = i / samples;
      const x = Phaser.Math.Linear(player.x, pickup.x, t);
      const y = Phaser.Math.Linear(player.y, pickup.y, t);
      if (this.getHazardScoreAt(x, y, enemies, enemyBullets, player) > 2.35) return false;
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
  ): number {
    const horizon = 0.45;
    return this.getBulletRiskAt(x, y, horizon, enemyBullets) / 24 + this.getEnemyRiskAt(x, y, horizon, enemies, player) / 42;
  }

  private getBulletRiskAt(x: number, y: number, horizonSeconds: number, enemyBullets: Phaser.Physics.Arcade.Group): number {
    let risk = 0;
    const entries = enemyBullets.children.entries as Phaser.Physics.Arcade.Image[];
    const step = entries.length <= AUTOPLAYER_BULLET_SCAN_LIMIT ? 1 : Math.ceil(entries.length / AUTOPLAYER_BULLET_SCAN_LIMIT);
    const start = step > 1 ? this.bulletSampleOffset % step : 0;

    for (let i = start; i < entries.length; i += step) {
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
    const step = entries.length <= AUTOPLAYER_BULLET_SCAN_LIMIT ? 1 : Math.ceil(entries.length / AUTOPLAYER_BULLET_SCAN_LIMIT);
    const start = step > 1 ? (this.bulletSampleOffset + 1) % step : 0;

    for (let i = start; i < entries.length; i += step) {
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
