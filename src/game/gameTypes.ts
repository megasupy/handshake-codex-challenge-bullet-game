export type EnemyKind = "chaser" | "shooter" | "spinner" | "bomber" | "strafer" | "mine" | "sniper" | "summoner" | "splitter" | "minion";

export type EnemyData = {
  kind: EnemyKind;
  hp: number;
  speed: number;
  fireAt: number;
  casts: number;
};

export type PlayerStats = {
  speed: number;
  fireRate: number;
  damage: number;
  projectiles: number;
  projectileSpeed: number;
  pierce: number;
  maxHealth: number;
  pickupRange: number;
  dashCooldown: number;
};

export type AutoplayerTelemetry = {
  directionX: number;
  directionY: number;
  reason: string;
  danger: number;
  projectedDanger: number;
  nearestPickupDistance: number;
  nearestEnemyDistance: number;
  pickupTargetX: number | null;
  pickupTargetY: number | null;
  pickupTargetValue: number;
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
};
