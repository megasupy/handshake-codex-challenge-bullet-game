import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const TRAIN_DIR = new URL("../logs/training/", import.meta.url);
const RUNS_DIR = new URL("../logs/runs/", import.meta.url);
const STATE_PATH = new URL("../logs/training/trainer-state.json", import.meta.url);

const generations = await resolveEpochs();
const population = Math.max(4, Number(process.env.STORM_TRAIN_POPULATION || 14));
const elites = Math.min(population, Math.max(2, Number(process.env.STORM_TRAIN_ELITES || Math.ceil(population * 0.25))));
const evalRuns = Math.max(1, Number(process.env.STORM_TRAIN_EVAL_RUNS || 8));
const timeScale = Math.max(0.1, Number(process.env.STORM_TRAIN_TIME_SCALE || 8));
const maxMs = Math.max(10000, Number(process.env.STORM_TRAIN_MAX_MS || 180000));
const sampleMs = Math.max(100, Number(process.env.STORM_TRAIN_SAMPLE_MS || 250));
const snapshotMs = Math.max(1000, Number(process.env.STORM_TRAIN_SNAPSHOT_MS || 3000));
const headful = await resolveHeadful();
const mode = process.env.STORM_TRAIN_MODE || "endless";
const resume = process.env.STORM_TRAIN_RESUME === "0" ? false : true;
const optimizer = (process.env.STORM_TRAIN_OPTIMIZER || "gd").toLowerCase();
const gradientEnabled = process.env.STORM_TRAIN_GRADIENT === "0" ? false : true;
const gradientLr = Math.max(0.01, Number(process.env.STORM_TRAIN_LR || 0.35));
const gradientMix = clamp(Number(process.env.STORM_TRAIN_GRADIENT_MIX || 0.55), 0, 1);
const gradientMomentum = clamp(Number(process.env.STORM_TRAIN_MOMENTUM || 0.9), 0, 0.999);

const POLICY_BOUNDS = {
  horizonNearWeight: [2.2, 6.0],
  horizonMidWeight: [1.4, 4.2],
  horizonFarWeight: [0.7, 2.4],
  interceptRiskWeight: [0.2, 1.6],
  reverseDirectionPenalty: [0.0, 2.0],
  nearEdgePenaltyScale: [8, 48],
  idleEnemyPenalty: [6, 64],
  idleCalmPenalty: [0, 30],
  pickupBiasScale: [0.4, 5.0],
  centerPullScale: [0.0, 2.8],
  openAreaRewardScale: [0.2, 3.6],
  dashHighRiskThreshold: [8, 60],
  dashRiskGainRequired: [2, 24],
  idleBusyPenalty: [4, 40],
  pickupIdlePenalty: [0, 24],
  pickupSafetyHazardThreshold: [2.4, 6.4],
  edgeResetDistance: [90, 220],
  edgeResetDangerThreshold: [3.5, 18],
  directPickupBulletCap: [2, 20],
  directPickupEnemyCap: [2, 20],
  directPickupCurrentHazardThreshold: [0.8, 3.2],
  directPickupTargetHazardThreshold: [1.2, 4.2],
  directPickupPathHazardThreshold: [1.4, 4.2],
  emergencyCooldownBypass: [0, 1],
  emergencyBypassHazardThreshold: [2.2, 5.5],
  emergencyBypassInterceptThreshold: [55, 220],
  emergencyBypassIdleBulletRisk: [55, 220],
  emergencyBypassConsecutiveFrames: [1, 6],
};

const DEFAULT_POLICY = {
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

const SIGMA_START = {
  horizonNearWeight: 0.5,
  horizonMidWeight: 0.4,
  horizonFarWeight: 0.25,
  interceptRiskWeight: 0.2,
  reverseDirectionPenalty: 0.25,
  nearEdgePenaltyScale: 5,
  idleEnemyPenalty: 6,
  idleCalmPenalty: 4,
  pickupBiasScale: 0.5,
  centerPullScale: 0.2,
  openAreaRewardScale: 0.4,
  dashHighRiskThreshold: 4,
  dashRiskGainRequired: 2,
  idleBusyPenalty: 3,
  pickupIdlePenalty: 2.5,
  pickupSafetyHazardThreshold: 0.45,
  edgeResetDistance: 20,
  edgeResetDangerThreshold: 1.8,
  directPickupBulletCap: 2,
  directPickupEnemyCap: 2,
  directPickupCurrentHazardThreshold: 0.25,
  directPickupTargetHazardThreshold: 0.3,
  directPickupPathHazardThreshold: 0.3,
  emergencyCooldownBypass: 0.35,
  emergencyBypassHazardThreshold: 0.35,
  emergencyBypassInterceptThreshold: 14,
  emergencyBypassIdleBulletRisk: 14,
  emergencyBypassConsecutiveFrames: 0.4,
};

await mkdir(TRAIN_DIR, { recursive: true });
await mkdir(RUNS_DIR, { recursive: true });

const bestPath = new URL("../logs/training/best-policy.json", import.meta.url);
const state = await loadState();
const trainId = state?.trainId || `train-${Date.now().toString(36)}`;
const historyPath = new URL(`../logs/training/${trainId}.jsonl`, import.meta.url);
const runLogPath = new URL(`../logs/training/train-runs-${trainId}.jsonl`, import.meta.url);
const epochLogPath = new URL(`../logs/training/train-epochs-${trainId}.jsonl`, import.meta.url);
let generationBase = Number(state?.generation || 0);
let mean = normalizePolicy(state?.mean || state?.bestPolicy || DEFAULT_POLICY);
let sigma = normalizeSigma(state?.sigma || SIGMA_START);
let velocity = normalizeVelocity(state?.velocity || {});
let previousEpochBest = Number(state?.previousEpochBest ?? Number.NaN);
let bestOverall = {
  score: Number(state?.bestScore ?? Number.NEGATIVE_INFINITY),
  policy: normalizePolicy(state?.bestPolicy || mean),
  details: state?.details || null,
};

for (let generationOffset = 1; generationOffset <= generations; generationOffset += 1) {
  const generation = generationBase + generationOffset;
  const generationTarget = generationBase + generations;
  const epochSeeds = buildEpochSeeds(generation);
  const candidates = [];
  const planned = buildGenerationCandidates(mean, sigma, population, gradientEnabled && optimizer === "gd");
  for (let i = 0; i < planned.length; i += 1) {
    const sampled = planned[i];
    const details = await evaluatePolicy(sampled.policy, generation, i, runLogPath, epochSeeds);
    candidates.push({ policy: sampled.policy, noise: sampled.noise, ...details });
    if (details.score > bestOverall.score) bestOverall = { score: details.score, policy: sampled.policy, details };
    process.stdout.write(`gen=${generation}/${generationTarget} cand=${i + 1}/${planned.length} reward=${details.score.toFixed(2)} loss=${(-details.score).toFixed(2)} survival=${details.avgSurvivalMs.toFixed(0)} boss=${details.avgBosses.toFixed(2)} threat=${details.avgThreat.toFixed(2)}\n`);
  }

  candidates.sort((a, b) => b.score - a.score);
  const elite = candidates.slice(0, elites);
  const eliteMean = averagePolicies(elite.map((entry) => entry.policy));
  if (gradientEnabled && optimizer === "gd") {
    const gd = applyGradientDescentStep(mean, sigma, velocity, candidates);
    velocity = gd.velocity;
    const gradientMean = gd.mean;
    mean = mixPolicies(eliteMean, gradientMean, gradientMix);
  } else if (gradientEnabled) {
    const gradientMean = applyScoreGradient(mean, sigma, candidates);
    mean = mixPolicies(eliteMean, gradientMean, gradientMix);
  } else {
    mean = eliteMean;
  }
  mean = normalizePolicy(mean);
  sigma = updateSigma(elite.map((entry) => entry.policy), mean, sigma);
  const rewardStats = summarizeRewards(candidates.map((entry) => entry.score));
  const sigmaNorm = l2Norm(sigma);
  const velocityNorm = l2Norm(velocity);

  const record = {
    trainId,
    generation,
    optimizer,
    reward: candidates[0].score,
    loss: -candidates[0].score,
    bestScore: candidates[0].score,
    bestPolicy: candidates[0].policy,
    avgSurvivalMs: candidates[0].avgSurvivalMs,
    avgBosses: candidates[0].avgBosses,
    avgThreat: candidates[0].avgThreat,
    rewardMean: rewardStats.mean,
    rewardStd: rewardStats.std,
    rewardMin: rewardStats.min,
    rewardMax: rewardStats.max,
    bestOverallScore: bestOverall.score,
    sigmaNorm,
    velocityNorm,
  };
  await appendJsonLine(historyPath, record);
  await appendJsonLine(epochLogPath, { type: "epoch", ...record });
  process.stdout.write(
    `epoch=${generation}/${generationTarget} reward_mean=${rewardStats.mean.toFixed(2)} reward_std=${rewardStats.std.toFixed(2)} best=${candidates[0].score.toFixed(2)} delta_best=${Number.isFinite(previousEpochBest) ? (candidates[0].score - previousEpochBest).toFixed(2) : "n/a"} best_overall=${bestOverall.score.toFixed(2)} sigma_norm=${sigmaNorm.toFixed(4)} velocity_norm=${velocityNorm.toFixed(4)}\n`,
  );
  previousEpochBest = candidates[0].score;
  await saveState({
    trainId,
    generation,
    mean,
    sigma,
    bestPolicy: bestOverall.policy,
    bestScore: bestOverall.score,
    details: bestOverall.details,
    velocity,
    previousEpochBest,
  });
}

await writeFile(
  bestPath,
  `${JSON.stringify(
    {
      trainId,
      bestScore: bestOverall.score,
      bestPolicy: bestOverall.policy,
      details: bestOverall.details,
      config: {
        generations,
        population,
        elites,
        evalRuns,
        timeScale,
        maxMs,
        sampleMs,
        snapshotMs,
        mode,
        resume,
        gradientEnabled,
        gradientLr,
        gradientMix,
        gradientMomentum,
        optimizer,
      },
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(`training complete: ${bestPath.pathname}\n`);

async function evaluatePolicy(policy, generation, candidateIndex, runLog, epochSeeds) {
  let totalScore = 0;
  let totalSurvival = 0;
  let totalBosses = 0;
  let totalThreat = 0;

  for (let runIndex = 0; runIndex < evalRuns; runIndex += 1) {
    const seed = epochSeeds[runIndex];
    await runTelemetry(seed, policy);
    const run = await readLatestRunBySeed(seed);
    const summary = run.summary || {};
    const survivalMs = Number(summary.survivalMs || 0);
    const score = Number(summary.score || 0);
    const maxThreatLevel = Number(summary.maxThreatLevel || 0);
    const bossesDefeated = Number(summary.bossesDefeated || 0);
    const shotAccuracy = Number(summary.shotAccuracy || 0);
    const damageTaken = Number(summary.damageTaken || 0);
    const damageCornered = Number(summary.damageCornered || 0);
    const value = survivalMs
      + bossesDefeated * 35000
      + maxThreatLevel * 1800
      + score * 0.2
      + shotAccuracy * 2000
      - damageTaken * 1400
      - damageCornered * 700;
    process.stdout.write(
      `run g=${generation} c=${candidateIndex + 1} r=${runIndex + 1}/${evalRuns} seed=${seed} reward=${value.toFixed(2)} loss=${(-value).toFixed(2)} survival=${survivalMs.toFixed(0)} score=${score.toFixed(0)} threat=${maxThreatLevel.toFixed(2)} bosses=${bossesDefeated.toFixed(0)} acc=${shotAccuracy.toFixed(3)} dmg=${damageTaken.toFixed(3)} cornerDmg=${damageCornered.toFixed(3)}\n`,
    );
    await appendJsonLine(runLog, {
      type: "run",
      trainId,
      generation,
      candidateIndex,
      runIndex,
      seed,
      reward: value,
      loss: -value,
      survivalMs,
      score,
      maxThreatLevel,
      bossesDefeated,
      shotAccuracy,
      damageTaken,
      damageCornered,
    });
    totalScore += value;
    totalSurvival += survivalMs;
    totalBosses += bossesDefeated;
    totalThreat += maxThreatLevel;
  }

  return {
    score: totalScore / evalRuns,
    avgSurvivalMs: totalSurvival / evalRuns,
    avgBosses: totalBosses / evalRuns,
    avgThreat: totalThreat / evalRuns,
  };
}

function buildEpochSeeds(generation) {
  const seeds = [];
  for (let runIndex = 0; runIndex < evalRuns; runIndex += 1) {
    seeds.push(`${trainId}-g${generation}-r${runIndex}`);
  }
  return seeds;
}

function runTelemetry(seed, policy) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      ["run", "telemetry:run"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          STORM_RUNS: "1",
          STORM_SEED: seed,
          STORM_MAX_MS: String(maxMs),
          STORM_TIME_SCALE: String(timeScale),
          STORM_SAMPLE_MS: String(sampleMs),
          STORM_SNAPSHOT_MS: String(snapshotMs),
          STORM_HEADFUL: headful,
          STORM_MODE: mode,
          STORM_POLICY: JSON.stringify(policy),
        },
      },
    );

    let stderr = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `telemetry run failed for seed=${seed}`));
    });
  });
}

async function readLatestRunBySeed(seed) {
  const dir = RUNS_DIR.pathname;
  const files = await readdir(dir);
  const matches = files
    .filter((file) => file.startsWith(`run-${seed}-`) && file.endsWith(".json"))
    .sort();
  if (matches.length === 0) throw new Error(`no run file found for seed=${seed}`);
  const latest = matches[matches.length - 1];
  return JSON.parse(await readFile(join(dir, latest), "utf8"));
}

function samplePolicy(mean, sigma) {
  const next = {};
  const noise = {};
  for (const key of Object.keys(mean)) {
    const [min, max] = POLICY_BOUNDS[key];
    const z = gaussian();
    const sampled = mean[key] + z * sigma[key];
    next[key] = clamp(sampled, min, max);
    noise[key] = z;
  }
  return { policy: next, noise };
}

function buildGenerationCandidates(mean, sigma, requestedPopulation, useGdPairs) {
  if (!useGdPairs) {
    const list = [{ policy: { ...mean }, noise: zeroNoise() }];
    for (let i = 1; i < requestedPopulation; i += 1) list.push(samplePolicy(mean, sigma));
    return list;
  }

  const pairCount = Math.max(1, Math.floor(requestedPopulation / 2));
  const list = [{ policy: { ...mean }, noise: zeroNoise() }];
  for (let i = 0; i < pairCount; i += 1) {
    const z = randomNoise();
    list.push(applyNoise(mean, sigma, z, +1));
    list.push(applyNoise(mean, sigma, z, -1));
  }
  return list.slice(0, Math.max(3, requestedPopulation));
}

function randomNoise() {
  const noise = {};
  for (const key of Object.keys(DEFAULT_POLICY)) noise[key] = gaussian();
  return noise;
}

function applyNoise(mean, sigma, noise, sign) {
  const next = {};
  for (const key of Object.keys(mean)) {
    const [min, max] = POLICY_BOUNDS[key];
    next[key] = clamp(mean[key] + sign * noise[key] * sigma[key], min, max);
  }
  return { policy: next, noise: scaleNoise(noise, sign) };
}

function scaleNoise(noise, scalar) {
  const next = {};
  for (const key of Object.keys(noise)) next[key] = noise[key] * scalar;
  return next;
}

function averagePolicies(policies) {
  const result = {};
  for (const key of Object.keys(DEFAULT_POLICY)) {
    let total = 0;
    for (const policy of policies) total += policy[key];
    result[key] = total / policies.length;
  }
  return result;
}

function updateSigma(policies, mean, currentSigma) {
  const next = {};
  for (const key of Object.keys(DEFAULT_POLICY)) {
    let variance = 0;
    for (const policy of policies) {
      const delta = policy[key] - mean[key];
      variance += delta * delta;
    }
    const std = Math.sqrt(variance / Math.max(1, policies.length));
    next[key] = Math.max(currentSigma[key] * 0.15, std * 0.9);
  }
  return next;
}

function applyScoreGradient(mean, sigma, candidates) {
  const sampled = candidates.filter((entry) => entry.noise);
  if (sampled.length === 0) return { ...mean };
  const baseline = sampled.reduce((total, entry) => total + entry.score, 0) / sampled.length;
  let scoreScale = 0;
  for (const entry of sampled) {
    const d = entry.score - baseline;
    scoreScale += d * d;
  }
  scoreScale = Math.sqrt(scoreScale / Math.max(1, sampled.length)) || 1;
  const next = { ...mean };
  for (const key of Object.keys(mean)) {
    let grad = 0;
    for (const entry of sampled) grad += ((entry.score - baseline) / scoreScale) * entry.noise[key];
    grad /= Math.max(1, sampled.length);
    const [min, max] = POLICY_BOUNDS[key];
    next[key] = clamp(mean[key] + gradientLr * sigma[key] * grad, min, max);
  }
  return next;
}

function applyGradientDescentStep(mean, sigma, velocity, candidates) {
  const sampled = candidates.filter((entry) => entry.noise);
  if (sampled.length === 0) return { mean: { ...mean }, velocity: { ...velocity } };
  const baseline = sampled.reduce((total, entry) => total + entry.score, 0) / sampled.length;
  let scoreScale = 0;
  for (const entry of sampled) {
    const d = entry.score - baseline;
    scoreScale += d * d;
  }
  scoreScale = Math.sqrt(scoreScale / Math.max(1, sampled.length)) || 1;

  const nextMean = { ...mean };
  const nextVelocity = { ...velocity };
  for (const key of Object.keys(mean)) {
    let grad = 0;
    for (const entry of sampled) grad += ((entry.score - baseline) / scoreScale) * (entry.noise[key] / Math.max(1e-6, sigma[key]));
    grad /= Math.max(1, sampled.length);
    const v = gradientMomentum * velocity[key] + (1 - gradientMomentum) * grad;
    const [min, max] = POLICY_BOUNDS[key];
    nextVelocity[key] = v;
    nextMean[key] = clamp(mean[key] + gradientLr * v, min, max);
  }
  return { mean: nextMean, velocity: nextVelocity };
}

function mixPolicies(a, b, mix) {
  const next = {};
  for (const key of Object.keys(DEFAULT_POLICY)) {
    next[key] = a[key] * (1 - mix) + b[key] * mix;
  }
  return next;
}

function normalizePolicy(policy) {
  const next = {};
  for (const key of Object.keys(DEFAULT_POLICY)) {
    const [min, max] = POLICY_BOUNDS[key];
    const value = Number(policy?.[key]);
    next[key] = clamp(Number.isFinite(value) ? value : DEFAULT_POLICY[key], min, max);
  }
  return next;
}

function normalizeSigma(value) {
  const next = {};
  for (const key of Object.keys(SIGMA_START)) {
    const sigmaValue = Number(value?.[key]);
    next[key] = Math.max(1e-3, Number.isFinite(sigmaValue) ? sigmaValue : SIGMA_START[key]);
  }
  return next;
}

function normalizeVelocity(value) {
  const next = {};
  for (const key of Object.keys(DEFAULT_POLICY)) {
    const v = Number(value?.[key]);
    next[key] = Number.isFinite(v) ? v : 0;
  }
  return next;
}

function zeroNoise() {
  const next = {};
  for (const key of Object.keys(DEFAULT_POLICY)) next[key] = 0;
  return next;
}

function summarizeRewards(values) {
  if (values.length === 0) return { mean: 0, std: 0, min: 0, max: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let variance = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const d = value - mean;
    variance += d * d;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { mean, std: Math.sqrt(variance / values.length), min, max };
}

function l2Norm(vector) {
  let total = 0;
  for (const value of Object.values(vector)) total += Number(value) * Number(value);
  return Math.sqrt(total);
}

async function loadState() {
  if (!resume) return null;
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch {
    try {
      const best = JSON.parse(await readFile(bestPath, "utf8"));
      return {
        trainId: best.trainId || `train-${Date.now().toString(36)}`,
        generation: Number(best?.config?.generations || 0),
        mean: best.bestPolicy,
        sigma: SIGMA_START,
        bestPolicy: best.bestPolicy,
        bestScore: best.bestScore,
        details: best.details || null,
      };
    } catch {
      return null;
    }
  }
}

async function saveState(payload) {
  await writeFile(STATE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

async function appendJsonLine(path, payload) {
  await writeFile(path, `${JSON.stringify(payload)}\n`, { flag: "a" });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

async function resolveEpochs() {
  const provided = process.env.STORM_TRAIN_EPOCHS ?? process.env.STORM_TRAIN_GENERATIONS;
  if (provided != null && provided !== "") return Math.max(1, Number(provided) || 12);
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Missing epochs. Set STORM_TRAIN_EPOCHS (or STORM_TRAIN_GENERATIONS) for non-interactive runs.");
  }

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await rl.question("How many epochs do you want to run? ")).trim();
      const value = Number(answer);
      if (Number.isFinite(value) && value >= 1) return Math.floor(value);
      process.stdout.write("Please enter an integer >= 1.\n");
    }
  } finally {
    rl.close();
  }
}

async function resolveHeadful() {
  const provided = process.env.STORM_TRAIN_HEADFUL;
  if (provided === "1") return "1";
  if (provided === "0") return "0";
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Missing STORM_TRAIN_HEADFUL for non-interactive runs. Set 1 for headful, 0 for headless.");
  }

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await rl.question("Run headful browser mode? (y/n) ")).trim().toLowerCase();
      if (answer === "y" || answer === "yes") return "1";
      if (answer === "n" || answer === "no") return "0";
      process.stdout.write("Please answer y or n.\n");
    }
  } finally {
    rl.close();
  }
}
