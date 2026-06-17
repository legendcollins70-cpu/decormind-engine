import { log } from "./logger.js";

// ============================================================
// ALL posting goes through Make.com webhooks. No direct platform APIs.
// Each platform has its own Make.com webhook URL stored in settings.
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

// Posts all six platforms via Make.com using the smart rotation schedule.
// posts: { imageUrl, affiliateLink, pinterest, twitter, linkedin, facebook, instagram, youtube, reddit }
export async function postToAllPlatforms(posts, settings, cycleNumber) {
  const results = {};

  // Pinterest — every hour
  if (cycleNumber % 1 === 0 && settings.make_pinterest_webhook) {
    results.pinterest = await postToPlatform(
      "Pinterest",
      {
        title: posts.pinterest.title,
        description: posts.pinterest.description,
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
        topics: posts.pinterest.topics,
        altText: posts.pinterest.altText,
      },
      settings.make_pinterest_webhook
    );
  }

  // Twitter — every hour
  if (cycleNumber % 1 === 0 && settings.make_twitter_webhook) {
    results.twitter = await postToPlatform(
      "Twitter",
      {
        content: posts.twitter.content,
        hashtags: posts.twitter.hashtags,
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
        altText: posts.twitter.altText,
      },
      settings.make_twitter_webhook
    );
  }

  // LinkedIn — every 6 hours
  if (cycleNumber % 6 === 0 && settings.make_linkedin_webhook) {
    results.linkedin = await postToPlatform(
      "LinkedIn",
      {
        content: posts.linkedin.content,
        hashtags: posts.linkedin.hashtags,
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
        altText: posts.linkedin.altText,
      },
      settings.make_linkedin_webhook
    );
  }

  // Facebook — every 8 hours
  if (cycleNumber % 8 === 0 && settings.make_facebook_webhook) {
    results.facebook = await postToPlatform(
      "Facebook",
      {
        content: posts.facebook.content,
        hashtags: posts.facebook.hashtags,
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
        callToAction: posts.facebook.callToAction,
      },
      settings.make_facebook_webhook
    );
  }

  // Instagram — every 12 hours
  if (cycleNumber % 12 === 0 && settings.make_instagram_webhook) {
    results.instagram = await postToPlatform(
      "Instagram",
      {
        caption: posts.instagram.caption,
        hashtags: posts.instagram.hashtags,
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
        callToAction: posts.instagram.callToAction,
      },
      settings.make_instagram_webhook
    );
  }

  // YouTube — every 12 hours
  if (cycleNumber % 12 === 0 && settings.make_youtube_webhook) {
    results.youtube = await postToPlatform(
      "YouTube",
      {
        title: posts.youtube.title,
        description: posts.youtube.description,
        tags: posts.youtube.tags,
        imageUrl: posts.imageUrl,
        link: posts.affiliateLink,
      },
      settings.make_youtube_webhook
    );
  }

  // Reddit — every 12 hours
  if (cycleNumber % 12 === 0 && settings.make_reddit_webhook) {
    results.reddit = await postToPlatform(
      "Reddit",
      {
        title: posts.reddit.title,
        body: posts.reddit.body,
        subreddit: posts.reddit.subreddit,
        link: posts.affiliateLink,
      },
      settings.make_reddit_webhook
    );
  }

  await log("info", `Make.com posting complete: ${Object.keys(results).length} platform(s) attempted.`);
  return results;
}
