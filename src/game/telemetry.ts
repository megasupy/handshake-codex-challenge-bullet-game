import type { AutoplayerTelemetry } from "./gameTypes";

export type TelemetryConfig = {
  enabled: boolean;
  sampleIntervalMs: number;
  snapshotIntervalMs: number;
  maxRunMs: number;
  runId: string;
  exportToDom: boolean;
};

export type TelemetryEvent = {
  t: number;
  type: string;
  data?: Record<string, boolean | number | string | null>;
};

export type TelemetrySample = {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  level: number;
  score: number;
  threat: number;
  enemies: number;
  enemyBullets: number;
  pickups: number;
  bossActive: boolean;
  bossHpRatio: number;
  bossPhase: number;
  campaignLevel: number;
  danger: number;
  projectedDanger: number;
  nearestPickupDistance: number;
  nearestEnemyDistance: number;
  pickupTargetValue: number;
  dashReady: boolean;
  frameMs: number;
  decisionTimeMs: number;
  lookaheadRisk: number;
  dashCurrentRisk: number;
  dashProjectedRisk: number;
  dashImmediateRisk: number;
  dashWouldUse: boolean;
  safeDirections: number;
  selectedDirectionRisk: number;
  bestAlternativeRisk: number;
  riskGap: number;
  incomingDensity: number;
  corridorContinuity: number;
  pinchRate: number;
  flowAlignment: number;
  postDashReboundRisk: number;
  dashCorridorLoss: number;
  minTti: number;
  collisionVetoCount: number;
  invalidCandidateCount: number;
  hitboxMarginPx: number;
  dashReboundCollisionRisk: number;
  edgeDistance: number;
  reason: string;
  playerDamage: number;
  playerProjectiles: number;
  playerFireRate: number;
  playerPierce: number;
  playerProjectileSpeed: number;
  shotsFired: number;
  shotsHit: number;
  shotAccuracy: number;
  phaseId: number;
  waveStep: number;
  bossPatternId: string;
};

export type TelemetryRun = {
  runId: string;
  seed: string;
  mode: string;
  config: Record<string, boolean | number | string | null>;
  startedAt: string;
  samples: TelemetrySample[];
  events: TelemetryEvent[];
  summary?: Record<string, boolean | number | string | null>;
  logText?: string;
};

export class TelemetryRecorder {
  private readonly run: TelemetryRun;
  private nextSampleAt = 0;
  private nextSnapshotAt = 0;
  private readonly lines: string[] = [];

  constructor(runId: string, seed: string, mode: string, config: Record<string, boolean | number | string | null>) {
    this.run = {
      runId,
      seed,
      mode,
      config,
      startedAt: new Date().toISOString(),
      samples: [],
      events: [],
    };
    this.lines.push(this.formatHeader());
  }

  logEvent(t: number, type: string, data?: Record<string, boolean | number | string | null>) {
    const entry = { t: Math.floor(t), type, data };
    this.run.events.push(entry);
    this.lines.push(this.formatEventLine(entry));
  }

  sample(t: number, intervalMs: number, snapshotIntervalMs: number, sample: Omit<TelemetrySample, "t">) {
    if (t < this.nextSampleAt) return;
    this.nextSampleAt = t + intervalMs;
    const entry = { t: Math.floor(t), ...sample };
    this.run.samples.push(entry);
    if (t >= this.nextSnapshotAt) {
      this.nextSnapshotAt = t + snapshotIntervalMs;
      this.lines.push(this.formatSnapshotLine(entry));
    }
  }

  finalize(summary: Record<string, boolean | number | string | null>): TelemetryRun {
    this.run.summary = summary;
    this.run.logText = this.lines.join("\n") + "\n";
    return this.run;
  }

  snapshot(): TelemetryRun {
    return {
      ...this.run,
      samples: [...this.run.samples],
      events: [...this.run.events],
      summary: this.run.summary ? { ...this.run.summary } : undefined,
      logText: this.run.logText,
    };
  }

  private formatHeader(): string {
    const config = Object.entries(this.run.config)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    return `RUN ${this.run.runId} seed=${this.run.seed} mode=${this.run.mode} started=${this.run.startedAt} ${config}`.trim();
  }

  private formatEventLine(event: TelemetryEvent): string {
    const payload = event.data ? ` ${formatData(event.data)}` : "";
    return `${stamp(event.t)} EVENT ${event.type}${payload}`;
  }

  private formatSnapshotLine(sample: TelemetrySample): string {
    const bossPart = sample.bossActive
      ? `boss=${Math.round(sample.bossHpRatio * 100)}% phase=${sample.bossPhase}`
      : "boss=off";
    return [
      stamp(sample.t),
      "SNAP",
      `thr=${sample.threat}`,
      `lvl=${sample.level}`,
      `hp=${sample.health}`,
      `score=${sample.score}`,
      `pos=${Math.round(sample.x)},${Math.round(sample.y)}`,
      `vel=${Math.round(sample.vx)},${Math.round(sample.vy)}`,
      `enemies=${sample.enemies}`,
      `bullets=${sample.enemyBullets}`,
      `pickups=${sample.pickups}`,
      bossPart,
      `fps=${sample.frameMs > 0 ? Math.round(1000 / sample.frameMs) : 0}`,
      `frameMs=${sample.frameMs}`,
      `danger=${sample.danger}`,
      `projDanger=${sample.projectedDanger}`,
      `decisionMs=${sample.decisionTimeMs}`,
      `reason=${sample.reason}`,
      `lookahead=${sample.lookaheadRisk}`,
      `dashRisk=${sample.dashCurrentRisk}->${sample.dashProjectedRisk}`,
      `dashImm=${sample.dashImmediateRisk}`,
      `dashUse=${sample.dashWouldUse ? 1 : 0}`,
      `safeDirs=${sample.safeDirections}`,
      `selRisk=${sample.selectedDirectionRisk}`,
      `altRisk=${sample.bestAlternativeRisk}`,
      `riskGap=${sample.riskGap}`,
      `inDensity=${sample.incomingDensity}`,
      `corr=${sample.corridorContinuity}`,
      `pinch=${sample.pinchRate}`,
      `flow=${sample.flowAlignment}`,
      `dashRebound=${sample.postDashReboundRisk}`,
      `dashCorrLoss=${sample.dashCorridorLoss}`,
      `minTti=${sample.minTti}`,
      `veto=${sample.collisionVetoCount}`,
      `invalid=${sample.invalidCandidateCount}`,
      `margin=${sample.hitboxMarginPx}`,
      `dashReboundCol=${sample.dashReboundCollisionRisk}`,
      `pDmg=${sample.playerDamage}`,
      `pProj=${sample.playerProjectiles}`,
      `pRate=${sample.playerFireRate}`,
      `pPierce=${sample.playerPierce}`,
      `pVel=${sample.playerProjectileSpeed}`,
      `shots=${sample.shotsFired}`,
      `hits=${sample.shotsHit}`,
      `acc=${sample.shotAccuracy}`,
      `phase=${sample.phaseId}`,
      `camp=${sample.campaignLevel}`,
      `wave=${sample.waveStep}`,
      `pattern=${sample.bossPatternId}`,
    ].join(" ");
  }
}

export function sanitizeDistance(value: number): number {
  return Number.isFinite(value) ? value : -1;
}

export function toAutoplayerSample(snapshot: AutoplayerTelemetry) {
  return {
    danger: round(snapshot.danger),
    projectedDanger: round(snapshot.projectedDanger),
    nearestPickupDistance: sanitizeDistance(round(snapshot.nearestPickupDistance)),
    nearestEnemyDistance: sanitizeDistance(round(snapshot.nearestEnemyDistance)),
    pickupTargetValue: snapshot.pickupTargetValue,
    decisionTimeMs: round(snapshot.decisionTimeMs),
    lookaheadRisk: round(snapshot.lookaheadRisk),
    dashCurrentRisk: round(snapshot.dashCurrentRisk),
    dashProjectedRisk: round(snapshot.dashProjectedRisk),
    dashImmediateRisk: round(snapshot.dashImmediateRisk),
    dashWouldUse: snapshot.dashWouldUse,
    safeDirections: snapshot.safeDirections,
    selectedDirectionRisk: round(snapshot.selectedDirectionRisk),
    bestAlternativeRisk: round(snapshot.bestAlternativeRisk),
    riskGap: round(snapshot.riskGap),
    incomingDensity: snapshot.incomingDensity,
    corridorContinuity: round(snapshot.corridorContinuity),
    pinchRate: round(snapshot.pinchRate),
    flowAlignment: round(snapshot.flowAlignment),
    postDashReboundRisk: round(snapshot.postDashReboundRisk),
    dashCorridorLoss: round(snapshot.dashCorridorLoss),
    minTti: round(snapshot.minTti),
    collisionVetoCount: Math.floor(snapshot.collisionVetoCount),
    invalidCandidateCount: Math.floor(snapshot.invalidCandidateCount),
    hitboxMarginPx: round(snapshot.hitboxMarginPx),
    dashReboundCollisionRisk: round(snapshot.dashReboundCollisionRisk),
    reason: snapshot.reason,
  };
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}

function stamp(t: number): string {
  return `[${(t / 1000).toFixed(1).padStart(6, " ")}s]`;
}

function formatData(data: Record<string, boolean | number | string | null>): string {
  return Object.entries(data)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}
