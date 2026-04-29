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
  score: number;
  threat: number;
  enemies: number;
  enemyBullets: number;
  pickups: number;
  bossActive: boolean;
  bossHpRatio: number;
  bossPhase: number;
  danger: number;
  projectedDanger: number;
  nearestPickupDistance: number;
  nearestEnemyDistance: number;
  pickupTargetValue: number;
  dashReady: boolean;
  frameMs: number;
  decisionTimeMs: number;
  edgeDistance: number;
  reason: string;
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
