import { log } from "./logger.js";

const ANTI_TEMPLATE = "You must never use fixed templates, repetitive structures, or predictable patterns. Generate completely unique content every single time. Vary your writing style naturally. Vary sentence structures. Vary hooks and introductions. Vary calls to action. The content must feel original and human-written. Think like a creative content strategist, not a template generator.";
const SYSTEM = `You are an expert affiliate marketing copywriter and audience growth strategist. Your job is to build an audience in the selected niche, not just sell products. ${ANTI_TEMPLATE}`;

const PROMPTS = {
  educational: {
    Pinterest: "Create an educational Pinterest pin about this niche. Focus on SEO keywords, visual descriptions, seasonal trends, inspiration language. Return JSON: title, description, topics, altText.",
    Twitter: "Create a short educational Twitter/X post. Hook-first, punchy, creates curiosity or sparks debate. Return JSON: content, hashtags, altText.",
    LinkedIn: "Create an educational LinkedIn post. Professional but warm, insight-driven, connects the niche to professional or lifestyle improvement. Return JSON: content, hashtags, altText.",
    Facebook: "Create an educational Facebook post. Conversational, story-driven, ends with a question. Return JSON: content, hashtags, callToAction.",
    Instagram: "Create an educational Instagram caption. Visual-first, lifestyle language, strong hashtag strategy. Return JSON: caption, hashtags, callToAction.",
    YouTube: "Write a YouTube video description for an educational niche video. Return JSON: title (max 100 chars, SEO optimised), description (max 500 chars, keyword rich), tags (array of 10 relevant tags).",
    Reddit: "Write a value-first Reddit post for the niche. Return JSON: title (max 300 chars), body (max 1000 chars, helpful, no hard selling), subreddit.",
  },
  engagement: {
    Pinterest: "Create an inspiration / engagement Pinterest pin that encourages saves. Return JSON: title, description, topics, altText.",
    Twitter: "Create an engagement Twitter/X post — ask a question, start a debate, or run a mini-poll. Return JSON: content, hashtags, altText.",
    LinkedIn: "Create a discussion-starting LinkedIn post for the niche. Return JSON: content, hashtags, altText.",
    Facebook: "Create an engagement Facebook post that ends with a question and invites comments. Return JSON: content, hashtags, callToAction.",
    Instagram: "Create an engagement Instagram caption that invites comments or shares. Return JSON: caption, hashtags, callToAction.",
    YouTube: "Write a YouTube description for an engagement-focused video / community post. Return JSON: title, description, tags.",
    Reddit: "Write a Reddit discussion starter. Return JSON: title, body, subreddit.",
  },
  promotion: {
    Pinterest: "Create a promotional Pinterest pin for this affiliate product. Focus on SEO keywords, visual descriptions, seasonal trends, home decor inspiration language. Return JSON: title, description, topics, altText.",
    Twitter: "Create a promotional Twitter/X post. Punchy, hook-first, creates curiosity. Return JSON: content, hashtags, altText.",
    LinkedIn: "Create a promotional LinkedIn post. Professional but warm, insight-driven, connects the product to professional or lifestyle improvement. Return JSON: content, hashtags, altText.",
    Facebook: "Create a promotional Facebook post. Conversational, story-driven, ends with a question to encourage comments. Return JSON: content, hashtags, callToAction.",
    Instagram: "Create a promotional Instagram caption. Visual-first, lifestyle language, strong hashtag strategy. Return JSON: caption, hashtags, callToAction.",
    YouTube: "Write a YouTube video description for this affiliate product. Return JSON: title (max 100 chars, SEO optimised), description (max 500 chars, includes affiliate link naturally, keyword rich), tags (array of 10 relevant tags).",
    Reddit: "Write a Reddit post for this affiliate product. Return JSON: title (max 300 chars, honest and compelling), body (max 1000 chars, conversational, value-first, no spammy language, affiliate link at end), subreddit (most relevant subreddit for this product).",
  },
};

// Groq is now the ONLY AI generation source. There is intentionally no local
// fallback publisher: if Groq fails, the cycle must reject and retry a different
// product rather than publishing template content.

export function buildAffiliateLink(product, campaignId, settings) {
  if (product.marketplace === "CJ Affiliate") {
    const pub = settings.cj_publisher_id || "0000000";
    const adId = product.vendor_code || "00000000";
    const baseLink = `https://www.anrdoezrs.net/click-${pub}-${adId}?ref=decormind`;
    return { affiliate: baseLink, tracking: `${baseLink}&sid=${campaignId}` };
  }
  const aff = settings.shareasale_affiliate_id || "0000000";
  const merchant = product.vendor_code || "00000";
  const baseLink = `https://www.shareasale.com/r.cfm?b=0&u=${aff}&m=${merchant}&urllink=`;
  return { affiliate: baseLink, tracking: `${baseLink}&afftrack=${campaignId}` };
}

// 70/20/10 mix: every 10 posts => 7 educational, 2 engagement, 1 promotion.
export function contentTypeForCycle(cycleNumber) {
  const slot = ((cycleNumber - 1) % 10) + 1;
  if (slot <= 7) return "educational";
  if (slot <= 9) return "engagement";
  return "promotion";
}

async function winnersForPlatform(supabase, userId, platform) {
  const { data } = await supabase
    .from("decoramind_performance")
    .select("*")
    .eq("user_id", userId)
    .eq("is_winner", true)
    .eq("platform", platform)
    .order("engagement_score", { ascending: false })
    .limit(5);
  return data || [];
}

async function generate(product, platform, links, settings, contentType, winners) {
  if (!settings.groq_api_key) throw new Error("GROQ_API_KEY missing — cannot generate content");
  const previousWinners = winners?.length
    ? `These previous posts performed well on this platform: ${JSON.stringify(winners)}. Learn from their style, format and approach but create something completely new.`
    : "No winner history yet. Create the strongest post you can from first principles.";
  const prompt = `Niche: ${product.niche}
Product: ${product.name}. ${product.description}
Selling points: ${(product.selling_points || []).join(", ")}
Content type: ${contentType}
Affiliate link: ${contentType === "promotion" ? links.tracking : "Only include a link if it feels natural and truly useful."}
Platform optimisation: ${PROMPTS[contentType][platform]}
${previousWinners}
Return ONLY JSON for ${platform}.`;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.groq_api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mixtral-8x7b-32768",
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
        temperature: 0.85,
        max_tokens: 1200,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
      const text = (data.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
      return { platform, aiProvider: "groq", generatedByFallback: false, ...JSON.parse(text) };
  } catch (e) {
    await log("warning", `Writer failed for ${platform}: ${e.message} — retry`);
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.groq_api_key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mixtral-8x7b-32768",
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
          temperature: 0.85,
          max_tokens: 1200,
        }),
      });
      const data = await res.json();
      const text = (data.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
      return { platform, aiProvider: "groq", generatedByFallback: false, ...JSON.parse(text) };
    } catch (e2) {
      throw new Error(`Groq generation failed after retry for ${platform}: ${e2.message}`);
    }
  }
}

export async function writeAllPlatforms(product, links, settings, cycleNumber, supabase) {
  const platforms = ["Pinterest", "Twitter", "LinkedIn", "Facebook", "Instagram", "YouTube", "Reddit"];
  const contentType = contentTypeForCycle(cycleNumber);
  const out = { contentType };
  for (const p of platforms) {
    const winners = await winnersForPlatform(supabase, settings.user_id, p);
    out[p] = await generate(product, p, links, settings, contentType, winners);
  }
  return out;
}

// Groq comment reply generator.
export async function generateCommentReply(comment, niche, productName, settings) {
  if (!settings.groq_api_key) throw new Error("GROQ_API_KEY missing — cannot generate comment reply");
  const prompt = `Comment: ${comment}
Niche: ${niche}
Product: ${productName || ""}
Write a reply under 150 characters.`;
  const system = "You are a fun, engaging social media community manager. Write a reply to this comment that is warm, genuine, slightly playful, relevant to the product and niche, and encourages further engagement. Never sound corporate or robotic. Keep it under 150 characters. Make the person feel heard and valued.";
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.groq_api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "mixtral-8x7b-32768", messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_tokens: 120, temperature: 0.9 }),
    });
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || "").trim().slice(0, 150);
  } catch (e) {
    throw new Error(`Groq comment reply generation failed: ${e.message}`);
  }
}

}
