import * as cheerio from "cheerio";
import { checkImage } from "./mrChecky.js";
import { log } from "./logger.js";

async function fromOgImage(pageUrl) {
  try {
    const res = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    return $('meta[property="og:image"]').attr("content") || $('meta[name="twitter:image"]').attr("content") || null;
  } catch {
    return null;
  }
}

async function fromMicrolink(pageUrl) {
  try {
    const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(pageUrl)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.image?.url || null;
  } catch {
    return null;
  }
}

async function fromUnsplash(query, key) {
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${key}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.results?.[0]?.urls?.regular || null;
  } catch {
    return null;
  }
}

// Returns a validated image URL — never returns an invalid one.
export async function resolveImage(product, settings) {
  const candidates = [];
  if (product.image_url) candidates.push(product.image_url);
  const page = product.sales_page_url || product.siteUrl;
  if (page) {
    const og = await fromOgImage(page);
    if (og) candidates.push(og);
    const ml = await fromMicrolink(page);
    if (ml) candidates.push(ml);
  }
  const us = await fromUnsplash(`${product.niche} ${product.name}`, settings.unsplash_access_key);
  if (us) candidates.push(us);

  for (const url of candidates) {
    const check = await checkImage(url);
    if (check.pass) return url;
  }
  await log("warning", `No valid image found for ${product.name}`);
  return null;
}
