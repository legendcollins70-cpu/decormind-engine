# DecorMind AI — Render Engine

The autonomous automation engine. Runs an hourly `node-cron` job that scrapes
top-rated products from **CJ Affiliate** and **ShareASale**, lets Groq AI pick
the best one, writes platform-perfect copy, runs **Mr Checky** (the boss) on
everything, then posts via the Pinterest API and Make.com webhooks.

> Mr Checky's rule: **"If anything fails — we restart from scratch."**

## Pipeline (per cycle)

1. **scraper.js** — CJ Affiliate + ShareASale APIs (4★+ filter), proven fallback products so a cycle is never skipped.
2. **picker.js** — Groq AI (`mixtral-8x7b-32768`) selects the best product.
3. **mrChecky.js** — duplicate check (blocks same product within 7 days).
4. **imageScraper.js** — og:image → Microlink → Unsplash, validated before use.
5. **writer.js** — Groq AI writes all 6 platform posts.
6. **mrChecky.js** — inspects every post (content, spam, link, SubID, image).
7. **poster.js** — Make.com webhooks for every supported platform (Pinterest, Facebook, Instagram, LinkedIn, YouTube, Reddit, and X/Twitter on its own cadence).
8. **logger.js** — saves JSON locally and POSTs to the Vercel `/api/logs`.
9. **cycle.js** — orchestration, max 3 retries with 10-minute delays, Mr Checky summary at the end.

## SubID tracking

Every affiliate link is tagged with the real database campaign id:

- CJ Affiliate: `...&sid=CAMPAIGN_ID`
- ShareASale: `...&afftrack=CAMPAIGN_ID`

The campaign row is inserted first to obtain the real id, then the SubID link is built and saved.

## Endpoints

| Method | Path       | Description                                  |
| ------ | ---------- | -------------------------------------------- |
| GET    | `/`        | Status (cycles completed, last run)          |
| GET    | `/health`  | Health check (used by Render)                |
| GET    | `/logs`    | Recent log entries                           |
| POST   | `/trigger` | Manual cycle — requires `x-trigger-secret`   |

## Local development

```bash
cp .env.example .env   # fill in your keys
npm install
npm start              # listens on PORT 10000
```

Trigger a cycle manually:

```bash
curl -X POST http://localhost:10000/trigger -H "x-trigger-secret: $TRIGGER_SECRET"
```

## Deploy to Render.com (free tier)

1. Push this `render-engine` folder to a Git repo.
2. In Render, create a **New Web Service** from the repo (or use the included `render.yaml` Blueprint).
3. Set every variable from `.env.example` in the Render dashboard (all `sync: false`).
4. Render builds with `npm install` and starts with `node src/index.js`.
5. Health check path is `/health`. Once live, the hourly cron runs automatically.

The engine reads API keys from the Supabase `decoramind_settings` table at the
start of every cycle and falls back to these environment variables if that fetch
fails.
