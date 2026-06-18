import { createClient } from "@supabase/supabase-js";
import { scrapeProducts } from "./scraper.js";
import { pickBest } from "./picker.js";
import { resolveImage } from "./imageScraper.js";
import { writeAllPlatforms, buildAffiliateLink } from "./writer.js";
import { masterCheck, checkDuplicate, cycleSummary } from "./mrChecky.js";
import { postToPlatform, platformWebhooks } from "./poster.js";
import { log } from "./logger.js";

const RETRY_DELAY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRIES = 5;

let cycleCount = 0;

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Loads settings from Supabase (first configured user), falling back to env vars.
async function loadSettings(supabase) {
  const env = {
    user_id: null,
    active_niche: process.env.ACTIVE_NICHE || "home decor",
    groq_api_key: process.env.GROQ_API_KEY || "",
    cj_api_key: process.env.CJ_API_KEY || "",
    cj_publisher_id: process.env.CJ_PUBLISHER_ID || "",
    shareasale_api_token: process.env.SHAREASALE_API_TOKEN || "",
    shareasale_affiliate_id: process.env.SHAREASALE_AFFILIATE_ID || "",
    shareasale_secret_key: process.env.SHAREASALE_SECRET_KEY || "",
    make_pinterest_webhook: process.env.MAKE_PINTEREST_WEBHOOK_URL || "",
    make_twitter_webhook: process.env.MAKE_TWITTER_WEBHOOK_URL || "",
    make_linkedin_webhook: process.env.MAKE_LINKEDIN_WEBHOOK_URL || "",
    make_facebook_webhook: process.env.MAKE_FACEBOOK_WEBHOOK_URL || "",
    make_instagram_webhook: process.env.MAKE_INSTAGRAM_WEBHOOK_URL || "",
    make_youtube_webhook: process.env.MAKE_YOUTUBE_WEBHOOK_URL || "",
    make_reddit_webhook: process.env.MAKE_REDDIT_WEBHOOK_URL || "",
    unsplash_access_key: process.env.UNSPLASH_ACCESS_KEY || "",
  };
  try {
    const { data } = await supabase.from("decoramind_settings").select("*").limit(1).maybeSingle();
    if (data) {
      await log("info", "Loaded settings from Supabase.");
      return { ...env, ...data, user_id: data.user_id };
    }
  } catch (e) {
    await log("warning", `Settings fetch failed, using env vars: ${e.message}`);
  }
  return env;
}

// Exact social posting schedule.
// 11 posts/day => every 131 minutes for Pinterest/Facebook/Instagram/LinkedIn/YouTube/Reddit.
// X/Twitter remains every 420 minutes (7 hours).
// Staggered starts (minutes after midnight):
//   Pinterest 0, Facebook 5, Instagram 10, LinkedIn 15, YouTube 20, Reddit 25, Twitter 0.
const SCHEDULE = {
  Pinterest: { interval: 131, offset: 0 },
  Facebook: { interval: 131, offset: 5 },
  Instagram: { interval: 131, offset: 10 },
  LinkedIn: { interval: 131, offset: 15 },
  YouTube: { interval: 131, offset: 20 },
  Reddit: { interval: 131, offset: 25 },
  Twitter: { interval: 420, offset: 0 },
};

function nextDueFromMidnight(now, intervalMinutes, offsetMinutes) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = new Date(midnight.getTime() + offsetMinutes * 60000);
  if (now <= start) return start;
  const elapsed = Math.floor((now.getTime() - start.getTime()) / 60000);
  const steps = Math.floor(elapsed / intervalMinutes) + 1;
  return new Date(start.getTime() + steps * intervalMinutes * 60000);
}

async function duePlatforms(supabase, userId, now = new Date()) {
  const due = [];
  for (const [platform, rule] of Object.entries(SCHEDULE)) {
    const { data } = await supabase.from("decoramind_schedule_state").select("*").eq("user_id", userId).eq("platform", platform).maybeSingle();
    let nextDue = data?.next_due_at ? new Date(data.next_due_at) : nextDueFromMidnight(now, rule.interval, rule.offset);
    if (!data) {
      await supabase.from("decoramind_schedule_state").insert({
        user_id: userId,
        platform,
        interval_minutes: rule.interval,
        offset_minutes: rule.offset,
        next_due_at: nextDue.toISOString(),
      });
    }
    if (nextDue <= now) due.push(platform);
  }
  return due;
}

async function markPlatformPosted(supabase, userId, platform, now = new Date()) {
  const rule = SCHEDULE[platform];
  const next = new Date(now.getTime() + rule.interval * 60000);
  await supabase.from("decoramind_schedule_state").upsert({
    user_id: userId,
    platform,
    interval_minutes: rule.interval,
    offset_minutes: rule.offset,
    last_posted_at: now.toISOString(),
    next_due_at: next.toISOString(),
    updated_at: now.toISOString(),
  }, { onConflict: "user_id,platform" });
}

function hashProduct(name, marketplace) {
  return `${marketplace}:${name}`.toLowerCase().replace(/\s+/g, "-");
}

// Posts a single platform with its own SubID campaign and records the result.
// All platforms post via their Make.com webhook — there is no manual posting.
async function processPlatform(supabase, settings, product, image, platform, post, stats, contentType) {
  const webhookUrl = platformWebhooks(settings)[platform];

  // Insert a campaign row first so we get a real database id for the SubID.
  const { data: inserted, error: insErr } = await supabase
    .from("decoramind_campaigns")
    .insert({
      user_id: settings.user_id,
      product_name: product.name,
      niche: product.niche,
      marketplace: product.marketplace,
      platform,
      image_url: image,
      status: "generating",
      show_on_storefront: true,
      product_hash: hashProduct(product.name, product.marketplace),
    })
    .select()
    .single();
  if (insErr || !inserted) {
    await log("error", `Failed to insert campaign for ${platform}: ${insErr?.message}`);
    stats.failed++;
    return { status: "db_error" };
  }

  const campaignId = inserted.id;
  // Raw affiliate link + SubID tracking link, keyed to the real database campaign id.
  const links = buildAffiliateLink(product, campaignId, settings);
  const content =
    (post.content || "") + (post.hashtags?.length ? "\n\n" + post.hashtags.map((h) => "#" + h).join(" ") : "");

  // Mr Checky inspects before any post or save.
  const check = await masterCheck(
    "post",
    { content, affiliateLink: links.tracking, imageUrl: image, product: { name: product.name } },
    supabase
  );
  check.checks.forEach((c) => (c.pass ? stats.passed++ : stats.failed++));
  if (!check.passed) {
    if (/spam/i.test(check.failReason || "")) stats.spamBlocked++;
    await log("error", `Mr Checky blocked ${platform}: ${check.failReason}`, { mrChecky: true });
    await supabase.from("decoramind_campaigns").delete().eq("id", campaignId);
    return { status: `blocked: ${check.failReason}` };
  }

  // Post via the platform's Make.com webhook. SubID tracking link is included so
  // the Make.com scenario can attach it to the published post.
  const result = await postToPlatform(
    platform,
    {
      title: post.title || "",
      content,
      description: post.content || "",
      caption: content,
      hashtags: post.hashtags || [],
      imageUrl: image,
      link: links.tracking,
      topics: post.topics || [],
      altText: post.altText || product.name,
      videoIdea: post.videoIdea || "",
      callToAction: post.callToAction || "",
    },
    webhookUrl
  );
  const status = result.status; // "success" | "failed" | "skipped"
  const dbStatus = status === "success" ? "posted" : status === "skipped" ? "no_webhook" : "post_failed";

  await supabase
    .from("decoramind_campaigns")
    .update({
      affiliate_link: links.affiliate,
      tracking_link: links.tracking,
      promotional_content: content,
      status: dbStatus,
      mr_checky_status: "passed",
      mr_checky_notes: "All checks passed",
    })
    .eq("id", campaignId);

  // Save performance tracking row (winner detection source of truth).
  await supabase.from("decoramind_performance").insert({
    user_id: settings.user_id,
    campaign_id: campaignId,
    platform,
    content_type: contentType,
    niche: product.niche,
    clicks: 0,
    engagement_score: 0,
    is_winner: false,
  });

  await log(
    status === "failed" ? "error" : "success",
    `${status === "success" ? "✅" : "⚠️"} ${platform} campaign #${campaignId} for ${product.name} — ${status}${result.reason ? ` (${result.reason})` : ""}`,
    { mrChecky: true, contentType }
  );
  return { status, campaignId, contentType };
}

async function saveFailureReport(supabase, settings, product, layer, reason, confidence = 0, risk = 100, details = {}) {
  await supabase.from("decoramind_validation_reports").insert({
    user_id: settings.user_id,
    product_name: product?.name || "",
    vendor_code: product?.vendor_code || "",
    niche: product?.niche || settings.active_niche,
    validation_layer: layer,
    failure_reason: reason,
    confidence_score: confidence,
    risk_score: risk,
    status: "rejected",
    details,
  });
}

async function selfAuditApprovedProducts(supabase, settings) {
  const { data: approved } = await supabase
    .from("decoramind_campaigns")
    .select("product_name, marketplace, image_url, tracking_link, niche")
    .eq("user_id", settings.user_id)
    .order("created_at", { ascending: false })
    .limit(20);
  for (const p of approved || []) {
    const imageOk = p.image_url && p.image_url.startsWith("https://");
    const linkOk = p.tracking_link && /^https:\/\//.test(p.tracking_link);
    const issueLevel = imageOk && linkOk ? "none" : !imageOk && !linkOk ? "critical" : "minor";
    const issueReason = issueLevel === "none" ? "" : !imageOk && !linkOk ? "Image and affiliate link invalid" : !imageOk ? "Image failed self-audit" : "Affiliate link failed self-audit";
    await supabase.from("decoramind_product_audits").upsert({
      user_id: settings.user_id,
      product_name: p.product_name,
      marketplace: p.marketplace,
      niche: p.niche,
      last_audited_at: new Date().toISOString(),
      issue_level: issueLevel,
      issue_reason: issueReason,
      is_active: issueLevel !== "critical",
      details: { image_url: p.image_url, tracking_link: p.tracking_link },
    });
    if (issueLevel === "critical") {
      await supabase.from("decoramind_campaigns").update({ show_on_storefront: false, status: "deactivated_by_audit" }).eq("product_name", p.product_name).eq("user_id", settings.user_id);
      await log("error", `Self-audit deactivated ${p.product_name}: ${issueReason}`, { mrChecky: true });
    }
  }
}

async function recentPatternCheck(supabase, userId, draftText) {
  const { data } = await supabase
    .from("decoramind_campaigns")
    .select("promotional_content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  const recent = (data || []).map((r) => (r.promotional_content || "").toLowerCase());
  const text = (draftText || "").toLowerCase();
  const repeatedHook = recent.some((r) => r.slice(0, 80) && text.slice(0, 80) && r.slice(0, 80) === text.slice(0, 80));
  const repeatedCTA = /(tap the link|shop now|check it out|link in bio)/i.test(text) && recent.filter((r) => /(tap the link|shop now|check it out|link in bio)/i.test(r)).length >= 3;
  return {
    pass: !(repeatedHook || repeatedCTA),
    reason: repeatedHook ? "Repeated hook detected across recent posts" : repeatedCTA ? "Repeated CTA pattern detected across recent posts" : "ok",
  };
}

async function validateCandidate(supabase, settings, product, image) {
  const checks = [];
  // Layer 1: Data verification
  const dataChecks = [
    product.name ? { name: "Product title", pass: true } : { name: "Product title", pass: false, reason: "Missing product title" },
    image ? { name: "Product image", pass: true } : { name: "Product image", pass: false, reason: "Missing product image" },
    product.description ? { name: "Product description", pass: true } : { name: "Product description", pass: false, reason: "Missing product description" },
    product.niche ? { name: "Product category", pass: true } : { name: "Product category", pass: false, reason: "Missing product category" },
    product.vendor_name ? { name: "Product vendor", pass: true } : { name: "Product vendor", pass: false, reason: "Missing product vendor" },
    product.marketplace ? { name: "Affiliate link source", pass: true } : { name: "Affiliate link source", pass: false, reason: "Missing marketplace / link source" },
    product.niche === settings.active_niche ? { name: "Niche match", pass: true } : { name: "Niche match", pass: false, reason: `Product does not match selected niche ${settings.active_niche}` },
  ];
  checks.push(...dataChecks);
  const failedData = dataChecks.find((c) => !c.pass);
  if (failedData) return { passed: false, layer: "data_verification", reason: failedData.reason, confidence: 10, risk: 90, checks };

  // Layer 2: AI quality inspector (real Groq call)
  let aiScore = 90;
  let aiReason = "AI quality passed";
  try {
    if (settings.groq_api_key) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.groq_api_key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mixtral-8x7b-32768",
          messages: [{
            role: "user",
            content: `Inspect this product content for accuracy, relevance, grammar, readability, hallucinations, misleading claims, spam, template-like content and niche relevance. Return JSON: {score:number, pass:boolean, reason:string}. Product: ${JSON.stringify(product)}`,
          }],
          temperature: 0.2,
          max_tokens: 200,
        }),
      });
      const data = await res.json();
      const text = (data.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
      const ai = JSON.parse(text);
      aiScore = Number(ai.score || 0);
      aiReason = ai.reason || "AI quality review failed";
      checks.push(ai.pass ? { name: "AI quality inspector", pass: true } : { name: "AI quality inspector", pass: false, reason: aiReason });
      if (!ai.pass || aiScore < 70) return { passed: false, layer: "ai_quality_inspector", reason: aiReason, confidence: aiScore, risk: 100 - aiScore, checks };
    }
  } catch (e) {
    checks.push({ name: "AI quality inspector", pass: false, reason: `AI quality inspection failed: ${e.message}` });
    return { passed: false, layer: "ai_quality_inspector", reason: `AI quality inspection failed: ${e.message}`, confidence: 40, risk: 60, checks };
  }

  // Layer 3: Human simulation inspector
  const suspicious = /fake|placeholder|demo|sample|test product/i.test(`${product.name || ""} ${product.description || ""}`);
  if (suspicious) {
    checks.push({ name: "Human simulation", pass: false, reason: "Would appear fake or suspicious to a real customer" });
    return { passed: false, layer: "human_simulation", reason: "Would appear fake or suspicious to a real customer", confidence: 35, risk: 65, checks };
  }
  checks.push({ name: "Human simulation", pass: true });

  // Layer 4: Storefront inspector
  const storefrontOk = !!(product.name && image);
  if (!storefrontOk) {
    checks.push({ name: "Storefront inspector", pass: false, reason: "Product would not render correctly on storefront" });
    return { passed: false, layer: "storefront_inspector", reason: "Product would not render correctly on storefront", confidence: 30, risk: 70, checks };
  }
  checks.push({ name: "Storefront inspector", pass: true });

  // Layer 5: Confidence scoring
  const passedCount = checks.filter((c) => c.pass).length;
  const confidence = Math.max(0, Math.round((passedCount / checks.length) * 100 - (checks.length - passedCount) * 8));
  const risk = 100 - confidence;
  checks.push(confidence >= 75 ? { name: "Confidence scoring", pass: true } : { name: "Confidence scoring", pass: false, reason: `Confidence ${confidence}% below threshold` });
  if (confidence < 75) {
    return { passed: false, layer: "confidence_scoring", reason: `Confidence ${confidence}% below threshold`, confidence, risk, checks };
  }

  return { passed: true, layer: "confidence_scoring", reason: "Approved", confidence, risk, checks };
}

export async function runCycle() {
  cycleCount += 1;
  const start = Date.now();
  const supabase = db();
  const settings = await loadSettings(supabase);
  const stats = { passed: 0, failed: 0, duplicatesBlocked: 0, spamBlocked: 0 };

  await log("info", `🔄 Cycle #${cycleCount} started — niche ${settings.active_niche}`, { mrChecky: true });

  let success = false;
  const tested = new Set();
  // 1) Scrape once; from here on Mr Checky retries with DIFFERENT products only.
  const products = await scrapeProducts(settings);

  for (let attempt = 1; attempt <= MAX_RETRIES && !success; attempt++) {
    await log("info", `Attempt ${attempt}/${MAX_RETRIES}`);

    // Pick a different product every retry. Never reuse a rejected product in the same cycle.
    const pool = products.filter((p) => !tested.has(`${p.marketplace}:${p.name}`));
    const product = await pickBest(pool, settings);
    if (!product) {
      await log("warning", "No unused product available. Mr Checky will wait for the next cycle.");
      break;
    }
    tested.add(`${product.marketplace}:${product.name}`);

    // 2) Duplicate check (blocks same product within 7 days)
    const dup = await checkDuplicate(product.name, product.marketplace, settings.user_id, supabase);
    if (!dup.pass) {
      stats.duplicatesBlocked++;
      await saveFailureReport(supabase, settings, product, "data_verification", dup.reason, 20, 80, { attempt, layer: "duplicate_check" });
      await log("warning", `🚫 Duplicate blocked: ${product.name}. Trying a different product.`, { mrChecky: true });
      continue;
    }

    // 3) Resolve a validated image
    const image = await resolveImage(product, settings);
    if (!image) {
      await saveFailureReport(supabase, settings, product, "data_verification", "No valid image found", 15, 85, { attempt });
      await log("warning", `No valid image for ${product.name}. Trying a different product.`);
      continue;
    }
    product.image_url = image;

    // 4) Full multi-layer validation before approval
    const validation = await validateCandidate(supabase, settings, product, image);
    validation.checks.forEach((c) => (c.pass ? stats.passed++ : stats.failed++));
    if (!validation.passed) {
      await saveFailureReport(supabase, settings, product, validation.layer, validation.reason, validation.confidence, validation.risk, { attempt, checks: validation.checks });
      await log("warning", `Mr Checky rejected ${product.name} at ${validation.layer}: ${validation.reason}`, { mrChecky: true, confidence: validation.confidence, risk: validation.risk });
      continue;
    }

    // Approved product gets/updates self-audit baseline.
    await supabase.from("decoramind_product_audits").upsert({
      user_id: settings.user_id,
      product_name: product.name,
      vendor_code: product.vendor_code || "",
      marketplace: product.marketplace,
      niche: product.niche,
      last_audited_at: new Date().toISOString(),
      issue_level: "none",
      issue_reason: "",
      is_active: true,
      details: { confidence: validation.confidence, risk: validation.risk },
    });

    // 5) Write all platform posts with Groq AI.
    const links = buildAffiliateLink(product, 0, settings);
    const posts = await writeAllPlatforms(product, links, settings, cycleCount, supabase);

    // 6) Anti-template enforcement against recent live posts.
    const platforms = await duePlatforms(supabase, settings.user_id, new Date());
    const results = {};
    for (const platform of platforms) {
      const draft = posts[platform]?.content || posts[platform]?.caption || posts[platform]?.description || posts[platform]?.body || "";
      const pattern = await recentPatternCheck(supabase, settings.user_id, draft);
      if (!pattern.pass) {
        stats.failed++;
        await saveFailureReport(supabase, set
