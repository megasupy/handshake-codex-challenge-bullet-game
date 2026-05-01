import Phaser from "phaser";
import { ARENA_HEIGHT, ARENA_WIDTH, AUTOPLAYER_DECISION_INTERVAL_MS, AUTOPLAYER_DIRECTIONS } from "./constants";
import type { AutoplayerTelemetry, EnemyData } from "./gameTypes";

const PLAYER_RADIUS = 18;

type TacticalState = "NORMAL_SURVIVAL" | "COLLAPSING_SPACE_ESCAPE" | "CENTER_RECOVERY";

type ThreatPoint = {
  x: number;
  y: number;
  radius: number;
  weight: number;
  approachWeight: number;
};

type ThreatSnapshot = {
  danger: number;
  density: number;
  safeRays: number;
  corridorWidth: number;
  edgeEntrapment: number;
  gradientX: number;
  gradientY: number;
};

type RolloutResult = {
  direction: Phaser.Math.Vector2;
  score: number;
  danger: number;
  safeRays: number;
  corridorWidth: number;
  edgeEntrapment: number;
};

export type AutoplayerPolicy = {
  dangerWeight: number;
  densityWeight: number;
  approachWeight: number;
  edgeEntrapmentWeight: number;
  corridorCollapseWeight: number;
  safeRayPenaltyWeight: number;
  escapeOptionWeight: number;
  antiThrashWeight: number;
  centerRecoveryWeight: number;
  tacticalEscapeBoost: number;
  tacticalCenterBoost: number;
  collapseDangerThreshold: number;
  collapseSafeRayThreshold: number;
  collapseCorridorThreshold: number;
  centerRecoveryEdgeThreshold: number;
  centerRecoveryDangerTrend: number;
  tacticalHoldFrames: number;
  rolloutStepSeconds: number;
  rolloutSteps: number;
  nearHorizonSeconds: number;
  farHorizonSeconds: number;
  commitImprovementThreshold: number;
  commitFrames: number;
  dashRiskThreshold: number;
  dashRiskReductionRequired: number;
  dashImmediateRiskThreshold: number;
};

const DEFAULT_POLICY: AutoplayerPolicy = {
  dangerWeight: 1.6,
  densityWeight: 0.75,
  approachWeight: 1.4,
  edgeEntrapmentWeight: 2.1,
  corridorCollapseWeight: 1.8,
  safeRayPenaltyWeight: 1.55,
  escapeOptionWeight: 1.45,
  antiThrashWeight: 0.6,
  centerRecoveryWeight: 1.25,
  tacticalEscapeBoost: 1.35,
  tacticalCenterBoost: 1.45,
  collapseDangerThreshold: 5.1,
  collapseSafeRayThreshold: 2,
  collapseCorridorThreshold: 115,
  centerRecoveryEdgeThreshold: 0.68,
  centerRecoveryDangerTrend: 0.85,
  tacticalHoldFrames: 10,
  rolloutStepSeconds: 0.12,
  rolloutSteps: 6,
  nearHorizonSeconds: 0.2,
  farHorizonSeconds: 1.2,
  commitImprovementThreshold: 0.85,
  commitFrames: 6,
  dashRiskThreshold: 6.4,
  dashRiskReductionRequired: 1.65,
  dashImmediateRiskThreshold: 4.8,
};

const SAFE_RAY_DIRECTIONS = AUTOPLAYER_DIRECTIONS.filter((direction) => direction.lengthSq() > 0).map((direction) => direction.clone().normalize());

export class Autoplayer {
  private direction = new Phaser.Math.Vector2(0, 0);
  private targetPosition = new Phaser.Math.Vector2(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
  private pickupTarget: Phaser.Physics.Arcade.Image | null = null;
  private nextDecisionAt = 0;
  private policy: AutoplayerPolicy = { ...DEFAULT_POLICY };
  private tacticalState: TacticalState = "NORMAL_SURVIVAL";
  private tacticalHold = 0;
  private previousDanger = 0;
  private commitFramesLeft = 0;

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
    this.tacticalState = "NORMAL_SURVIVAL";
    this.tacticalHold = 0;
    this.previousDanger = 0;
    this.commitFramesLeft = 0;
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

  getTelemetrySnapshot(): AutoplayerTelemetry {
    return { ...this.lastTelemetry };
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
    if (args.elapsedMs < this.nextDecisionAt) return this.targetPosition.clone();
    const startedAt = performance.now();

    const current = this.evaluateThreatSnapshot(args.player.x, args.player.y, 0, args.player, args.enemies, args.enemyBullets);
    const dangerTrend = current.danger - this.previousDanger;
    this.previousDanger = current.danger;

    this.updateTacticalState(current, dangerTrend, args.player.x, args.player.y);

    const candidates = this.buildCandidateDirections(current);
    const rollouts = candidates.map((direction) => this.evaluateRollout(direction, args.player, args.speed, args.enemies, args.enemyBullets));
    rollouts.sort((a, b) => a.score - b.score);

    const best = rollouts[0];
    const second = rollouts[1] ?? best;
    let selected = best;

    if (this.commitFramesLeft > 0 && this.direction.lengthSq() > 0) {
      const incumbent = rollouts.find((r) => r.direction.dot(this.direction) > 0.93);
      if (incumbent && incumbent.score <= best.score + this.policy.commitImprovementThreshold) selected = incumbent;
      this.commitFramesLeft -= 1;
    } else if (second.score - best.score > this.policy.commitImprovementThreshold) {
      this.commitFramesLeft = Math.max(0, Math.round(this.policy.commitFrames));
    }

    if (selected.direction.lengthSq() > 0) this.direction.copy(selected.direction.clone().normalize());
    else this.direction.set(0, 0);

    const lookahead = Math.max(this.policy.nearHorizonSeconds, AUTOPLAYER_DECISION_INTERVAL_MS / 1000);
    const targetX = Phaser.Math.Clamp(args.player.x + this.direction.x * args.speed * lookahead, 22, ARENA_WIDTH - 22);
    const targetY = Phaser.Math.Clamp(args.player.y + this.direction.y * args.speed * lookahead, 22, ARENA_HEIGHT - 22);
    this.targetPosition.set(targetX, targetY);

    const nearestEnemyDistance = this.getNearestEnemyDistance(args.player.x, args.player.y, args.enemies);
    const nearestPickupDistance = this.getNearestPickupDistance(args.player.x, args.player.y, args.pickups);

    this.lastTelemetry = {
      directionX: this.direction.x,
      directionY: this.direction.y,
      reason: `trajectory-${this.tacticalState.toLowerCase()}`,
      danger: current.danger,
      projectedDanger: selected.danger,
      nearestPickupDistance,
      nearestEnemyDistance,
      pickupTargetX: null,
      pickupTargetY: null,
      pickupTargetValue: 0,
      decisionTimeMs: performance.now() - startedAt,
      lookaheadRisk: selected.score,
      dashCurrentRisk: 0,
      dashProjectedRisk: 0,
      dashImmediateRisk: 0,
      dashWouldUse: false,
      safeDirections: current.safeRays,
      selectedDirectionRisk: selected.score,
      bestAlternativeRisk: second.score,
      riskGap: second.score - selected.score,
      incomingDensity: current.density,
    };

    this.nextDecisionAt = args.elapsedMs + AUTOPLAYER_DECISION_INTERVAL_MS;
    return this.targetPosition.clone();
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
    const walkSpeed = args.walkSpeed ?? args.dashSpeed * 0.35;
    const dashStep = 0.18;
    const walkStep = 0.18;

    const current = this.evaluateThreatSnapshot(args.player.x, args.player.y, 0, args.player, args.enemies, args.enemyBullets);
    const walkX = Phaser.Math.Clamp(args.player.x + args.direction.x * walkSpeed * walkStep, 22, ARENA_WIDTH - 22);
    const walkY = Phaser.Math.Clamp(args.player.y + args.direction.y * walkSpeed * walkStep, 22, ARENA_HEIGHT - 22);
    const dashX = Phaser.Math.Clamp(args.player.x + args.direction.x * args.dashSpeed * dashStep, 22, ARENA_WIDTH - 22);
    const dashY = Phaser.Math.Clamp(args.player.y + args.direction.y * args.dashSpeed * dashStep, 22, ARENA_HEIGHT - 22);

    const walk = this.evaluateThreatSnapshot(walkX, walkY, this.policy.nearHorizonSeconds, args.player, args.enemies, args.enemyBullets);
    const dash = this.evaluateThreatSnapshot(dashX, dashY, this.policy.nearHorizonSeconds, args.player, args.enemies, args.enemyBullets);

    const immediateRisk = this.getImmediateInterceptRisk(args.player, args.direction, args.dashSpeed, args.enemyBullets);
    const reduction = walk.danger - dash.danger;
    const useDash =
      (walk.danger >= this.policy.dashRiskThreshold || immediateRisk >= this.policy.dashImmediateRiskThreshold)
      && reduction >= this.policy.dashRiskReductionRequired;

    this.lastTelemetry.dashCurrentRisk = current.danger;
    this.lastTelemetry.dashProjectedRisk = dash.danger;
    this.lastTelemetry.dashImmediateRisk = immediateRisk;
    this.lastTelemetry.dashWouldUse = useDash;

    return useDash;
  }

  private updateTacticalState(current: ThreatSnapshot, dangerTrend: number, x: number, y: number): void {
    const centerDist = Phaser.Math.Distance.Between(x, y, ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
    const maxCenterDist = Math.hypot(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
    const edgeRatio = centerDist / maxCenterDist;

    let next: TacticalState = "NORMAL_SURVIVAL";
    if (current.danger >= this.policy.collapseDangerThreshold && (current.safeRays <= this.policy.collapseSafeRayThreshold || current.corridorWidth <= this.policy.collapseCorridorThreshold)) {
      next = "COLLAPSING_SPACE_ESCAPE";
    } else if (current.edgeEntrapment >= this.policy.centerRecoveryEdgeThreshold && dangerTrend >= this.policy.centerRecoveryDangerTrend && edgeRatio > 0.58) {
      next = "CENTER_RECOVERY";
    }

    if (next !== this.tacticalState) {
      this.tacticalState = next;
      this.tacticalHold = Math.round(this.policy.tacticalHoldFrames);
      return;
    }

    if (this.tacticalState !== "NORMAL_SURVIVAL") {
      this.tacticalHold -= 1;
      if (this.tacticalHold <= 0 && current.danger < this.policy.collapseDangerThreshold * 0.74 && current.safeRays >= this.policy.collapseSafeRayThreshold + 2) {
        this.tacticalState = "NORMAL_SURVIVAL";
      }
    }
  }

  private buildCandidateDirections(snapshot: ThreatSnapshot): Phaser.Math.Vector2[] {
    const candidates: Phaser.Math.Vector2[] = [];
    for (const direction of AUTOPLAYER_DIRECTIONS) candidates.push(direction);

    const gradientEscape = new Phaser.Math.Vector2(-snapshot.gradientX, -snapshot.gradientY);
    if (gradientEscape.lengthSq() > 0.01) candidates.push(gradientEscape.normalize());

    const tangentA = new Phaser.Math.Vector2(-snapshot.gradientY, snapshot.gradientX);
    const tangentB = new Phaser.Math.Vector2(snapshot.gradientY, -snapshot.gradientX);
    if (tangentA.lengthSq() > 0.01) candidates.push(tangentA.normalize());
    if (tangentB.lengthSq() > 0.01) candidates.push(tangentB.normalize());

    return this.uniqueDirections(candidates);
  }

  private uniqueDirections(candidates: Phaser.Math.Vector2[]): Phaser.Math.Vector2[] {
    const unique: Phaser.Math.Vector2[] = [];
    for (const candidate of candidates) {
      const normal = candidate.lengthSq() > 0 ? candidate.clone().normalize() : candidate.clone();
      if (unique.some((entry) => entry.lengthSq() === normal.lengthSq() && entry.dot(normal) > 0.985)) continue;
      unique.push(normal);
    }
    return unique;
  }

  private evaluateRollout(
    direction: Phaser.Math.Vector2,
    player: Phaser.GameObjects.Shape,
    speed: number,
    enemies: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
  ): RolloutResult {
    const steps = Math.max(2, Math.round(this.policy.rolloutSteps));
    const dt = Phaser.Math.Clamp(this.policy.rolloutStepSeconds, 0.05, 0.24);
    let x = player.x;
    let y = player.y;
    let score = 0;
    let minSafeRays = 8;
    let minCorridorWidth = Number.POSITIVE_INFINITY;
    let maxEdgeEntrapment = 0;
    let lastDanger = 0;

    for (let step = 1; step <= steps; step += 1) {
      x = Phaser.Math.Clamp(x + direction.x * speed * dt, 22, ARENA_WIDTH - 22);
      y = Phaser.Math.Clamp(y + direction.y * speed * dt, 22, ARENA_HEIGHT - 22);
      const horizon = Phaser.Math.Clamp(dt * step, this.policy.nearHorizonSeconds, this.policy.farHorizonSeconds);
      const threat = this.evaluateThreatSnapshot(x, y, horizon, player, enemies, enemyBullets);
      const w = 1.1 - (step - 1) * (0.65 / Math.max(1, steps - 1));

      score += threat.danger * this.policy.dangerWeight * w;
      score += threat.density * this.policy.densityWeight * 0.1 * w;
      score += threat.edgeEntrapment * this.policy.edgeEntrapmentWeight * w;
      score += ((8 - threat.safeRays) / 8) * this.policy.safeRayPenaltyWeight * 5.6 * w;
      score += Math.max(0, 165 - threat.corridorWidth) * 0.02 * this.policy.corridorCollapseWeight * w;
      score -= threat.safeRays * this.policy.escapeOptionWeight * 0.12 * w;
      if (step >= 2) score += Math.max(0, threat.danger - lastDanger) * this.policy.approachWeight * 0.35;
      lastDanger = threat.danger;

      minSafeRays = Math.min(minSafeRays, threat.safeRays);
      minCorridorWidth = Math.min(minCorridorWidth, threat.corridorWidth);
      maxEdgeEntrapment = Math.max(maxEdgeEntrapment, threat.edgeEntrapment);
    }

    if (direction.lengthSq() > 0 && this.direction.lengthSq() > 0) {
      const turnCost = (1 - Math.max(-1, Math.min(1, direction.dot(this.direction)))) * this.policy.antiThrashWeight;
      score += turnCost;
    }

    if (this.tacticalState === "COLLAPSING_SPACE_ESCAPE") score -= minSafeRays * this.policy.tacticalEscapeBoost;
    if (this.tacticalState === "CENTER_RECOVERY") {
      const centerDist = Phaser.Math.Distance.Between(x, y, ARENA_WIDTH / 2, ARENA_HEIGHT / 2);
      score += centerDist * 0.01 * this.policy.centerRecoveryWeight * this.policy.tacticalCenterBoost;
    }

    return {
      direction,
      score,
      danger: lastDanger,
      safeRays: minSafeRays,
      corridorWidth: minCorridorWidth,
      edgeEntrapment: maxEdgeEntrapment,
    };
  }

  private evaluateThreatSnapshot(
    x: number,
    y: number,
    horizonSeconds: number,
    player: Phaser.GameObjects.Shape,
    enemies: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
  ): ThreatSnapshot {
    const threats = this.collectThreatPoints(horizonSeconds, player, enemies, enemyBullets);
    let danger = 0;
    let density = 0;
    let gradientX = 0;
    let gradientY = 0;

    for (let i = 0; i < threats.length; i += 1) {
      const threat = threats[i];
      const dx = x - threat.x;
      const dy = y - threat.y;
      const d = Math.hypot(dx, dy) || 1;
      const margin = d - threat.radius;
      const local = threat.weight * Math.exp(-Math.max(0, margin) / 42);
      const pressure = local * (1 + threat.approachWeight * 0.5);
      danger += pressure;
      if (margin < 90) density += (90 - Math.max(0, margin)) / 90;
      const gradGain = pressure / (d + 4);
      gradientX += dx * gradGain;
      gradientY += dy * gradGain;
    }

    const { safeRays, corridorWidth } = this.getSafeSpaceMetrics(x, y, threats);
    const edge = Math.min(x, ARENA_WIDTH - x, y, ARENA_HEIGHT - y);
    const edgeEntrapment = Phaser.Math.Clamp((180 - edge) / 180, 0, 1) * Phaser.Math.Clamp((8 - safeRays) / 8, 0, 1);

    return {
      danger,
      density,
      safeRays,
      corridorWidth,
      edgeEntrapment,
      gradientX,
      gradientY,
    };
  }

  private collectThreatPoints(
    horizonSeconds: number,
    player: Phaser.GameObjects.Shape,
    enemies: Phaser.Physics.Arcade.Group,
    enemyBullets: Phaser.Physics.Arcade.Group,
  ): ThreatPoint[] {
    const threats: ThreatPoint[] = [];
    const bulletEntries = enemyBullets.children.entries as Phaser.Physics.Arcade.Image[];
    const enemyEntries = enemies.children.entries as Phaser.GameObjects.Shape[];

    for (let i = 0; i < bulletEntries.length; i += 1) {
      const bullet = bulletEntries[i];
      if (!bullet?.active) continue;
      const body = bullet.body as Phaser.Physics.Arcade.Body | undefined;
      const vx = body ? body.velocity.x : 0;
      const vy = body ? body.velocity.y : 0;
      const px = bullet.x + vx * horizonSeconds;
      const py = bullet.y + vy * horizonSeconds;
      const approach = this.getApproachWeight(px, py, vx, vy, player.x, player.y);
      threats.push({
        x: px,
        y: py,
        radius: PLAYER_RADIUS + 18,
        weight: 2.9,
        approachWeight: approach,
      });
    }

    for (let i = 0; i < enemyEntries.length; i += 1) {
      const enemy = enemyEntries[i];
      if (!enemy?.active) continue;
      const data = enemy.getData("enemy") as EnemyData;
      const body = enemy.body as Phaser.Physics.Arcade.Body | undefined;
      const hasVelocity = Boolean(body && Number.isFinite(body.velocity.x) && Number.isFinite(body.velocity.y));
      const vx = hasVelocity ? body!.velocity.x : Math.cos(Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y)) * data.speed;
      const vy = hasVelocity ? body!.velocity.y : Math.sin(Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y)) * data.speed;
      const px = enemy.x + vx * horizonSeconds;
      const py = enemy.y + vy * horizonSeconds;
      threats.push({
        x: px,
        y: py,
        radius: PLAYER_RADIUS + (data.kind === "chaser" ? 30 : 24),
        weight: data.kind === "chaser" ? 2.2 : 1.5,
        approachWeight: this.getApproachWeight(px, py, vx, vy, player.x, player.y),
      });
    }

    return threats;
  }

  private getApproachWeight(sourceX: number, sourceY: number, vx: number, vy: number, x: number, y: number): number {
    const toPlayerX = x - sourceX;
    const toPlayerY = y - sourceY;
    const dist = Math.hypot(toPlayerX, toPlayerY) || 1;
    const dirX = toPlayerX / dist;
    const dirY = toPlayerY / dist;
    const speed = Math.hypot(vx, vy);
    if (speed < 1) return 0;
    const velX = vx / speed;
    const velY = vy / speed;
    return Math.max(0, velX * dirX + velY * dirY);
  }

  private getSafeSpaceMetrics(x: number, y: number, threats: ThreatPoint[]): { safeRays: number; corridorWidth: number } {
    let safeRays = 0;
    let maxGap = 0;
    let currentGap = 0;

    for (let i = 0; i < SAFE_RAY_DIRECTIONS.length; i += 1) {
      const direction = SAFE_RAY_DIRECTIONS[i];
      const travel = this.getRayTravelDistance(x, y, direction, threats, 220);
      if (travel > 120) {
        safeRays += 1;
        currentGap += 1;
      } else {
        maxGap = Math.max(maxGap, currentGap);
        currentGap = 0;
      }
    }
    maxGap = Math.max(maxGap, currentGap);

    const corridorWidth = maxGap * (Math.PI * 2 * 120) / SAFE_RAY_DIRECTIONS.length;
    return { safeRays, corridorWidth };
  }

  private getRayTravelDistance(x: number, y: number, direction: Phaser.Math.Vector2, threats: ThreatPoint[], maxTravel: number): number {
    const step = 14;
    for (let t = step; t <= maxTravel; t += step) {
      const px = x + direction.x * t;
      const py = y + direction.y * t;
      if (px < 22 || px > ARENA_WIDTH - 22 || py < 22 || py > ARENA_HEIGHT - 22) return t;
      for (let i = 0; i < threats.length; i += 1) {
        const threat = threats[i];
        const d = Phaser.Math.Distance.Between(px, py, threat.x, threat.y);
        if (d < threat.radius + 8) return t;
      }
    }
    return maxTravel;
  }

  private getImmediateInterceptRisk(
    player: Phaser.GameObjects.Shape,
    direction: Phaser.Math.Vector2,
    speed: number,
    enemyBullets: Phaser.Physics.Arcade.Group,
  ): number {
    let risk = 0;
    const moveVx = direction.x * speed;
    const moveVy = direction.y * speed;
    const entries = enemyBullets.children.entries as Phaser.Physics.Arcade.Image[];

    for (let i = 0; i < entries.length; i += 1) {
      const bullet = entries[i];
      if (!bullet?.active) continue;
      const body = bullet.body as Phaser.Physics.Arcade.Body | undefined;
      if (!body) continue;
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
      if (dist < 24) risk += 7;
      else if (dist < 48) risk += (48 - dist) / 7;
    }

    return risk;
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

  private getNearestPickupDistance(x: number, y: number, pickups: Phaser.Physics.Arcade.Group): number {
    let best = Number.POSITIVE_INFINITY;
    const entries = pickups.children.entries as Phaser.Physics.Arcade.Image[];
    for (let i = 0; i < entries.length; i += 1) {
      const pickup = entries[i];
      if (!pickup?.active) continue;
      const distance = Phaser.Math.Distance.Between(x, y, pickup.x, pickup.y);
      if (distance < best) best = distance;
    }
    return best;
  }
}
