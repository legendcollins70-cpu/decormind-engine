import express from "express";
import cron from "node-cron";
import { runCycle, getCycleCount } from "./cycle.js";
import { recentLogs, log } from "./logger.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
let lastRun = null;
let running = false;

// Runs a cycle, guarding against overlap.
async function safeRun(trigger) {
  if (running) {
    await log("warning", `Cycle already running — ${trigger} ignored.`);
    return { ok: false, note: "Cycle already running" };
  }
  running = true;
  try {
    const summary = await runCycle();
    lastRun = new Date().toISOString();
    return { ok: true, summary };
  } catch (e) {
    await log("error", `Cycle crashed: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    running = false;
  }
}

// GET / — status
app.get("/", (_req, res) => {
  res.json({
    service: "DecorMind AI — Render Engine",
    status: "running",
    cycles_completed: getCycleCount(),
    last_run: lastRun,
    running,
    schedule: "0 * * * * (hourly)",
  });
});

// GET /health — health check for Render
app.get("/health", (_req, res) => {
  res.json({ status: "healthy", uptime: process.uptime(), running, last_run: lastRun });
});

// GET /logs — recent log entries
app.get("/logs", (_req, res) => {
  res.json({ logs: recentLogs() });
});

// POST /trigger — manual cycle, protected by TRIGGER_SECRET
app.post("/trigger", async (req, res) => {
  const secret = req.headers["x-trigger-secret"] || req.query.secret;
  if (process.env.TRIGGER_SECRET && secret !== process.env.TRIGGER_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  // Fire and forget so the HTTP request returns fast; cycle continues in background.
  safeRun("manual trigger");
  res.json({ ok: true, note: "Cycle triggered", cycle: getCycleCount() + 1 });
});

app.listen(PORT, async () => {
  await log("info", `Render engine listening on port ${PORT}`);

  // Hourly automation — node-cron at minute 0 of every hour.
  cron.schedule("0 * * * *", () => {
    log("info", "⏰ Hourly cron fired.");
    safeRun("cron");
  });
  await log("info", "node-cron scheduled: 0 * * * * (hourly).");
});
