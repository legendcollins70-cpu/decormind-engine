// Mr Checky — THE BOSS. Identical logic to api/_lib/mrChecky.js and src/lib/mrChecky.ts
// "If anything fails — we restart from scratch."

const DISPOSABLE = ["mailinator.com","guerrillamail.com","tempmail.com","throwaway.email","fakeinbox.com","sharklasers.com","yopmail.com","trashmail.com"];
const SPAM = ["click here now","limited time","act now","buy now","free money","guaranteed","risk free","risk-free"];
const BAD_IMG = ["error","placeholder","noimage","no-image","default","missing","blank","empty","notfound","404","broken"];
const OFFENSIVE = ["idiot","stupid","hate you","shut up","dumb","moron","trash","kill yourself"];
const IMG_EXT = /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i;

export function checkSpam(content) {
  if (!content) return { name: "Spam", pass: false, reason: "Empty content" };
  const lower = content.toLowerCase();
  for (const p of SPAM) if (lower.includes(p)) return { name: "Spam", pass: false, reason: `Contains spam phrase "${p}"` };
  const letters = content.replace(/[^a-zA-Z]/g, "");
  const caps = content.replace(/[^A-Z]/g, "");
  if (letters.length && caps.length / letters.length > 0.3) return { name: "Spam", pass: false, reason: "Over 30% capital letters" };
  if ((content.match(/!/g) || []).length > 3) return { name: "Spam", pass: false, reason: "More than 3 exclamation marks" };
  return { name: "Spam", pass: true };
}

export function checkCommentReply(comment, reply, niche = "") {
  if (!reply || reply.length < 2) return { name: "Comment reply", pass: false, reason: "Reply is empty" };
  if (reply.length > 150) return { name: "Comment reply", pass: false, reason: "Reply exceeds 150 characters" };
  for (const w of OFFENSIVE) if (reply.toLowerCase().includes(w)) return { name: "Comment reply", pass: false, reason: `Offensive phrase detected: ${w}` };
  const spam = checkSpam(reply);
  if (!spam.pass) return { name: "Comment reply", pass: false, reason: spam.reason };
  // Topic match: the reply should overlap with the comment OR the niche.
  const text = `${comment || ""} ${niche}`.toLowerCase();
  const replyLower = reply.toLowerCase();
  const tokens = text.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
  const overlap = tokens.some((t) => replyLower.includes(t));
  if (!overlap) return { name: "Comment reply", pass: false, reason: "Reply does not appear related to the comment topic" };
  return { name: "Comment reply", pass: true };
}

export async function checkImage(imageUrl) {
  if (!imageUrl) return { name: "Image", pass: false, reason: "Image URL empty" };
  if (!imageUrl.startsWith("https://")) return { name: "Image", pass: false, reason: "Must start with https://" };
  const lower = imageUrl.toLowerCase();
  for (const t of BAD_IMG) if (lower.includes(t)) return { name: "Image", pass: false, reason: `Forbidden token "${t}"` };
  if (!IMG_EXT.test(imageUrl) && !/image|photo|img|unsplash|pexels|cdn/i.test(imageUrl))
    return { name: "Image", pass: false, reason: "No valid image extension or indicator" };
  try {
    const res = await fetch(imageUrl, { method: "HEAD" });
    if (res.status !== 200) return { name: "Image", pass: false, reason: `HTTP ${res.status}` };
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return { name: "Image", pass: false, reason: `Content-Type ${ct}` };
    const len = parseInt(res.headers.get("content-length") || "0", 10);
    if (len && (len < 5000 || len > 10 * 1024 * 1024)) return { name: "Image", pass: false, reason: `Size ${len} bytes out of range` };
  } catch (e) {
    return { name: "Image", pass: false, reason: `Fetch failed: ${e.message}` };
  }
  return { name: "Image", pass: true };
}

export function checkSubscriber(email, firstName) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { name: "Subscriber", pass: false, reason: "Invalid email" };
  const domain = email.split("@")[1].toLowerCase();
  if (DISPOSABLE.includes(domain)) return { name: "Subscriber", pass: false, reason: `Disposable domain ${domain}` };
  if (firstName && firstName.length > 100) return { name: "Subscriber", pass: false, reason: "Name too long" };
  return { name: "Subscriber", pass: true };
}

export function checkEmail(subject, body, recipientEmail) {
  const out = [];
  out.push(subject ? { name: "Subject", pass: true } : { name: "Subject", pass: false, reason: "Missing subject" });
  out.push(body && body.length > 20 ? { name: "Body", pass: true } : { name: "Body", pass: false, reason: "Body too short" });
  out.push(checkSpam(`${subject} ${body}`));
  out.push(checkSubscriber(recipientEmail));
  return out;
}

export async function checkPost(post, affiliateLink, imageUrl, product) {
  const out = [];
  if (product?.generatedByFallback === true) {
    out.push({ name: "AI provider", pass: false, reason: "Fallback Generator Used" });
    return out;
  }
  if (product?.aiProvider !== "groq") {
    out.push({ name: "AI provider", pass: false, reason: "AI Generation Verification Failed — content is not verified as Groq-generated" });
    return out;
  }
  if (/\b(lorem ipsum|placeholder|sample copy|template content)\b/i.test(post || "")) {
    out.push({ name: "Anti-template", pass: false, reason: "Template Content Detected" });
    return out;
  }
  out.push(post && post.length > 10 ? { name: "Content present", pass: true } : { name: "Content present", pass: false, reason: "Too short" });
  out.push(checkSpam(post));
  out.push(affiliateLink && affiliateLink.startsWith("https://") ? { name: "Affiliate link", pass: true } : { name: "Affiliate link", pass: false, reason: "Invalid link" });
  out.push(affiliateLink && /sid=|afftrack=/.test(affiliateLink) ? { name: "SubID tracking", pass: true } : { name: "SubID tracking", pass: false, reason: "Missing SubID" });
  out.push(await checkImage(imageUrl));
  if (product?.name) out.push({ name: "Product reference", pass: true });
  return out;
}

export function checkWebhookPayload(payload) {
  if (!payload || typeof payload !== "object") return { name: "Webhook payload", pass: false, reason: "Invalid payload" };
  return { name: "Webhook payload", pass: true };
}

export function checkStorefront(settings) {
  const out = [];
  out.push(settings.username ? { name: "Username", pass: true } : { name: "Username", pass: false, reason: "Username required" });
  out.push(settings.brand_name ? { name: "Brand name", pass: true } : { name: "Brand name", pass: false, reason: "Brand name required" });
  return out;
}

export async function checkDuplicate(productName, marketplace, userId, supabase) {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const hash = `${marketplace}:${productName}`.toLowerCase().replace(/\s+/g, "-");
  const { data } = await supabase.from("decoramind_campaigns").select("id").eq("user_id", userId).eq("product_hash", hash).gte("created_at", cutoff).limit(1);
  if (data && data.length) return { name: "Duplicate", pass: false, reason: "Same product within 7 days" };
  return { name: "Duplicate", pass: true };
}

export async function checkCampaignSave(campaign, userId, supabase) {
  const checks = await checkPost(campaign.promotional_content, campaign.tracking_link, campaign.image_url, { name: campaign.product_name });
  checks.push(await checkDuplicate(campaign.product_name, campaign.marketplace, userId, supabase));
  return checks;
}

function logLines(type, checks, passed, failReason) {
  const lines = [`🔍 Mr Checky: Starting ${type} inspection...`];
  for (const c of checks) lines.push(c.pass ? `✅ ${c.name} — PASS` : `❌ ${c.name} — FAIL: ${c.reason}`);
  lines.push(passed ? "🎉 Mr Checky: ALL PASSED. Proceeding." : `🚫 Mr Checky: CANCELLED. Reason: ${failReason}. Restarting in 10 minutes.`);
  return lines;
}

export async function masterCheck(type, data, supabase) {
  let checks = [];
  switch (type) {
    case "post": checks = await checkPost(data.content, data.affiliateLink, data.imageUrl, data.product); break;
    case "campaign": checks = await checkCampaignSave(data, data.user_id, supabase); break;
    case "email": checks = checkEmail(data.subject, data.body, data.recipientEmail); break;
    case "subscriber": checks = [checkSubscriber(data.email, data.firstName)]; break;
    case "storefront": checks = checkStorefront(data); break;
    case "webhook": checks = [checkWebhookPayload(data.payload)]; break;
    case "image": checks = [await checkImage(data.imageUrl)]; break;
    case "comment_reply": checks = [checkCommentReply(data.comment, data.reply, data.niche)]; break;
    default: checks = [checkSpam(data.content)];
  }
  const failed = checks.find((c) => !c.pass);
  const passed = !failed;
  return { type, passed, checks, failReason: failed?.reason, log: logLines(type, checks, passed, failed?.reason) };
}

export function cycleSummarylines(s) {
  return [
    `🤖 Mr Checky Summary for Cycle #${s.cycle}:`,
    `   ✅ Passed: ${s.passed} checks`,
    `   ❌ Failed: ${s.failed} checks`,
    `   🚫 Duplicates blocked: ${s.duplicatesBlocked}`,
    `   📧 Spam blocked: ${s.spamBlocked}`,
    `   ⏱️ Total time: ${s.totalSeconds} seconds`,
  ];
}
