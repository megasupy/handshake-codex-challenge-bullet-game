import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { summarizeRuns } from "./summarize-telemetry.mjs";

const basePort = Number(process.env.STORM_PORT || 4173);
const runs = Number(process.env.STORM_RUNS || 5);
const maxMs = Number(process.env.STORM_MAX_MS || 300000);
const sampleMs = Number(process.env.STORM_SAMPLE_MS || 250);
const snapshotMs = Number(process.env.STORM_SNAPSHOT_MS || 3000);
const timeScale = Number(process.env.STORM_TIME_SCALE || 10);
const debugBasePort = Number(process.env.STORM_DEBUG_PORT || 9222);
const startMs = Math.max(0, Number(process.env.STORM_START_MS || 0));
const seedBase = process.env.STORM_SEED || "";
const headful = process.env.STORM_HEADFUL === "1";
const outDir = new URL("../logs/runs/", import.meta.url);
const summaryDir = new URL("../logs/summary/", import.meta.url);

await mkdir(outDir, { recursive: true });
await mkdir(summaryDir, { recursive: true });

const port = await findAvailablePort(basePort);
process.stdout.write(`using port ${port}\n`);

const server = spawn("npm", ["exec", "vite", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, BROWSER: "none" },
});

server.stdout.on("data", (chunk) => process.stdout.write(chunk));
server.stderr.on("data", (chunk) => process.stderr.write(chunk));

try {
  await waitForServer(`http://127.0.0.1:${port}/`);

  const indexPath = new URL(`../logs/runs/index-${Date.now()}.jsonl`, import.meta.url);
  let indexLines = "";
  const runPaths = [];

  for (let i = 0; i < runs; i += 1) {
    const seed = seedBase || `auto-${Date.now().toString(36)}-${i}`;
    const runId = `run-${seed}`;
    const url = new URL(`http://127.0.0.1:${port}/`);
    url.searchParams.set("autorun", "1");
    url.searchParams.set("autoplayer", "1");
    url.searchParams.set("seed", seed);
    url.searchParams.set("runId", runId);
    url.searchParams.set("sampleMs", String(sampleMs));
    url.searchParams.set("snapshotMs", String(snapshotMs));
    url.searchParams.set("maxMs", String(maxMs));
    url.searchParams.set("timeScale", String(timeScale));
    if (startMs > 0) url.searchParams.set("startMs", String(startMs));

    const budgetMs = Math.ceil(maxMs / Math.max(0.1, timeScale)) + 12000;
    const run = await runChromium(url.toString(), budgetMs, debugBasePort + i * 2);
    const filePath = new URL(`../logs/runs/${runId}.json`, import.meta.url);
    await writeFile(filePath, `${JSON.stringify(run, null, 2)}\n`);
    const logPath = new URL(`../logs/runs/${runId}.log`, import.meta.url);
    await writeFile(logPath, `${run.logText || buildFallbackLog(run)}\n`);
    runPaths.push(filePath);
    indexLines += `${JSON.stringify({
      runId,
      seed,
      survivalMs: run.summary?.survivalMs ?? null,
      score: run.summary?.score ?? null,
      kills: run.summary?.kills ?? null,
      reason: run.summary?.reason ?? null,
    })}\n`;
    process.stdout.write(`saved ${runId}\n`);
  }

  await writeFile(indexPath, indexLines);
  const summary = await summarizeRuns(runPaths.map((fileUrl) => fileUrl.pathname));
  const summaryPath = new URL(`../logs/summary/latest.json`, import.meta.url);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`summary ${summaryPath.pathname}\n`);
} finally {
  server.kill("SIGTERM");
}

async function findAvailablePort(startPort, attempts = 25) {
  for (let port = startPort; port < startPort + attempts; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port found starting at ${startPort}`);
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for dev server at ${url}`);
}

async function runChromium(url, budgetMs, debugPortStart) {
  const debugPort = await findAvailablePort(debugPortStart, 40);
  const userDataDir = await mkdtemp(join(tmpdir(), "storm-chromium-"));
  const args = [
    ...(headful ? [] : ["--headless=new"]),
    "--disable-gpu",
    "--mute-audio",
    "--window-size=1600,900",
    ...(headful ? ["--new-window", "--ozone-platform=wayland"] : []),
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    url,
  ];
  const child = spawn("/usr/bin/chromium", args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const browser = await connectToBrowserCdp(debugPort, budgetMs);
  const cdp = await connectToCdp(debugPort, budgetMs);
  try {
    const run = await pollForTelemetry(cdp, browser, url, budgetMs);
    return run;
  } finally {
    try {
      await browser.send("Browser.close");
    } catch {
      // Best effort: browser may already be closing.
    }
    cdp.close();
    child.kill("SIGTERM");
    const { code, signal } = await new Promise((resolve) => child.on("close", (closedCode, closedSignal) => resolve({ code: closedCode, signal: closedSignal })));
    if (code !== 0 && signal !== "SIGTERM") throw new Error(`chromium failed: ${stderr.trim() || code}`);
  }
}

async function connectToBrowserCdp(port, budgetMs) {
  const deadline = Date.now() + Math.min(10000, budgetMs);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (!response.ok) throw new Error("not ready");
      const version = await response.json();
      const socket = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      return makeCdpSession(socket);
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out connecting to browser CDP on port ${port}`);
}

async function connectToCdp(port, budgetMs) {
  const deadline = Date.now() + Math.min(10000, budgetMs);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) throw new Error("not ready");
      const targets = await response.json();
      const target = targets.find((entry) => entry.type === "page") ?? targets[0];
      if (!target) throw new Error("no target");
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      return makeCdpSession(socket);
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out connecting to Chromium CDP on port ${port}`);
}

function makeCdpSession(socket) {
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message || "CDP error"));
    else entry.resolve(message.result);
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      socket.close();
    },
  };
}

async function pollForTelemetry(cdp, browser, url, budgetMs) {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url });

  const deadline = Date.now() + budgetMs;
  let latestPayload = null;
  while (Date.now() < deadline) {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: `({
        complete: document.documentElement.getAttribute("data-automation-complete") === "true",
        payload: window.__stormAutomationResult || null,
        payloadReason: window.__stormAutomationResult?.summary?.reason || null,
        gameOverVisible: !document.getElementById("game-over")?.classList.contains("hidden"),
        readyState: document.readyState
      })`,
      returnByValue: true,
    });

    const snapshot = result?.value;
    if (snapshot?.payload) {
      latestPayload = snapshot.payload;
      if (snapshot.complete || snapshot.payloadReason || snapshot.gameOverVisible) {
        try {
          await cdp.send("Page.close");
        } catch {
          // The page may already be gone by the time we see completion.
        }
        try {
          await browser.send("Browser.close");
        } catch {
          // Best effort: the browser may already be closing from the page end.
        }
        return latestPayload;
      }
    }
    await delay(250);
  }

  if (latestPayload) return latestPayload;
  throw new Error("Telemetry output not found in Chromium session");
}

function buildFallbackLog(run) {
  const lines = [];
  lines.push(`RUN ${run.runId} seed=${run.seed} mode=${run.mode}`);
  for (const event of run.events || []) {
    lines.push(`[${String((event.t || 0) / 1000).padStart(6, " ")}s] EVENT ${event.type}`);
  }
  for (const sample of run.samples || []) {
    lines.push(
      `[${String((sample.t || 0) / 1000).padStart(6, " ")}s] SNAP thr=${sample.threat} hp=${sample.health} score=${sample.score} enemies=${sample.enemies} bullets=${sample.enemyBullets} pickups=${sample.pickups} boss=${sample.bossActive ? `${Math.round(sample.bossHpRatio * 100)}%` : "off"} fps=${sample.frameMs > 0 ? Math.round(1000 / sample.frameMs) : 0} reason=${sample.reason}`,
    );
  }
  if (run.summary) lines.push(`SUMMARY ${JSON.stringify(run.summary)}`);
  return lines.join("\n");
}
