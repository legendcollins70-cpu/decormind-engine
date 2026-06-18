import { log } from "./logger.js";

// Groq AI picks the best product; falls back to a weighted score.
export async function pickBest(products, settings) {
  if (!products.length) return null;

  if (settings.groq_api_key) {
    try {
      const list = products.map((p, i) => `${i}: ${p.name} | rating ${p.rating} | commission ${p.commission_rate}% | ${p.niche}`).join("\n");
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.groq_api_key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mixtral-8x7b-32768",
          messages: [
            { role: "system", content: "You are an affiliate product selection expert. Reply ONLY with the index number of the single best product to promote today." },
            { role: "user", content: `Pick the best product index to promote:\n${list}` },
          ],
          temperature: 0.3,
          max_tokens: 10,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const idx = parseInt((data.choices?.[0]?.message?.content || "").match(/\d+/)?.[0] || "-1", 10);
        if (idx >= 0 && idx < products.length) {
          await log("info", `Groq AI picked: ${products[idx].name}`);
          return products[idx];
        }
      }
    } catch (e) {
      await log("warning", `Groq picker failed: ${e.message} — using score fallback`);
    }
