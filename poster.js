import { log } from "./logger.js";

// ============================================================
// ALL posting goes through Make.com webhooks. No direct platform APIs.
// Exact platform set:
//   Pinterest, Facebook, Instagram, LinkedIn, YouTube, Reddit
//   Twitter/X on its own independent cadence
// The render-engine cycle decides WHICH platforms are due right now.
// This module only knows HOW to post to a platform's webhook.
// ============================================================

export function platformWebhooks(settings) {
  return {
    Pinterest: settings.make_pinterest_webhook,
    Twitter: settings.make_twitter_webhook,
    LinkedIn: settings.make_linkedin_webhook,
    Facebook: settings.make_facebook_webhook,
    Instagram: settings.make_instagram_webhook,
    YouTube: settings.make_youtube_webhook,
    Reddit: settings.make_reddit_webhook,
  };
}

// Posts a single platform payload to its Make.com webhook.
export async function postToPlatform(platform, payload, webhookUrl) {
  if (!webhookUrl) {
    return { platform, status: "skipped", reason: "No webhook URL configured" };
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, ...payload }),
    });
    return { platform, status: res.ok ? "success" : "failed", statusCode: res.status };
  } catch (err) {
    return { platform, status: "failed", reason: err.message };
  }
}

// Convenience helper for batch posting when the caller already knows which
// platforms are due. The cycle uses exact time-based schedule checks and passes
// the list explicitly, so this function stays schedule-agnostic.
export async function postToAllPlatforms(duePlatforms, posts, settings) {
  const results = {};
  const webhooks = platformWebhooks(settings);

  for (const platform of duePlatforms) {
    const payloadMap = {
      Pinterest: {
        title: posts.Pinterest?.title || "",
        description: posts.Pinterest?.description || posts.Pinterest?.content || "",
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
        topics: posts.Pinterest?.topics || [],
        altText: posts.Pinterest?.altText || "",
      },
      Twitter: {
        content: posts.Twitter?.content || "",
        hashtags: posts.Twitter?.hashtags || [],
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
        altText: posts.Twitter?.altText || "",
      },
      LinkedIn: {
        content: posts.LinkedIn?.content || "",
        hashtags: posts.LinkedIn?.hashtags || [],
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
        altText: posts.LinkedIn?.altText || "",
      },
      Facebook: {
        content: posts.Facebook?.content || "",
        hashtags: posts.Facebook?.hashtags || [],
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
        callToAction: posts.Facebook?.callToAction || "",
      },
      Instagram: {
        caption: posts.Instagram?.caption || posts.Instagram?.content || "",
        hashtags: posts.Instagram?.hashtags || [],
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
        callToAction: posts.Instagram?.callToAction || "",
      },
      YouTube: {
        title: posts.YouTube?.title || "",
        description: posts.YouTube?.description || posts.YouTube?.content || "",
        tags: posts.YouTube?.tags || [],
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
      },
      Reddit: {
        title: posts.Reddit?.title || "",
        body: posts.Reddit?.body || posts.Reddit?.content || "",
        subreddit: posts.Reddit?.subreddit || "",
        link: posts.affiliateLink,
      },
    };

    results[platform] = await postToPlatform(platform, payloadMap[platform], webhooks[platform]);
  }

  await log("info", `Make.com posting complete: ${Object.keys(results).length} platform(s) attempted.`);
  return results;
}
