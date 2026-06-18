import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve("./logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

export async function log(level, message, details = null, userId = null) {
  const entry = { level, message, details, created_at: new Date().toISOString() };
  console.log(`[${level.toUpperCase()}] ${message}`);

  // Persist to local JSON
  try {
    const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.json`);
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    existing.push(entry);
    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  } catch (e) {
    console.error("Local log write failed:", e.message);
  }

  // POST to Vercel /api/logs
  if (process.env.VERCEL_API_URL && process.env.SERVICE_KEY) {
    try {
      await fetch(`${process.env.VERCEL_API_URL}/api/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-service-key": process.env.SERVICE_KEY },
        body: JSON.stringify({ level, message, details, user_id: userId }),
      });
    } catch (e) {
      console.error("Remote log post failed:", e.message);
    }
  }
}

export function recentLogs() {
  try {
    const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  } catch {
    return [];
  }
}
