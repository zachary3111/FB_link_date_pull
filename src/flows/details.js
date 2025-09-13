import { Dataset, log } from "apify";
import { extractPostDateISO } from "../utils/postTime.js";
import { extractPageInfo } from "../utils/pageInfo.js";

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export async function runPostDetails(page, urls, waits) {
  const { min_wait_ms, max_wait_ms } = waits;
  for (const postUrl of urls) {
    const result = { url: postUrl, item_type: "post_details", status: "success" };
    try {
      await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(rand(min_wait_ms, max_wait_ms));

      // Expand text if any See more button present (best-effort)
      const seeMore = await page.$('div[role="button"][tabindex="0"]:has-text("See more")');
      if (seeMore) await seeMore.click().catch(() => {});

      const { author, text, reactions, comments, shares } = await page.evaluate(() => {
        const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
        const scope = document.querySelector('[role="article"]') || document;

        // Author heuristics
        let author = null;
        const authorEl = scope.querySelector('h2 strong, h3 strong, a[role="link"] strong');
        if (authorEl) author = authorEl.textContent.trim();

        // Prefer the main post text inside article region
        const textNode = scope.querySelector('div[dir="auto"]');
        const text = (textNode?.textContent || '').trim() || null;

        // Count heuristics (best-effort; FB obfuscates)
        const spanTexts = Array.from(scope.querySelectorAll('span')).map((s) => s.textContent || '').join(' \n ');
        const num = (m) => (m && m[1] ? parseInt(m[1].replace(/[,\.]/g, ''), 10) : null);
        const reactions = num(spanTexts.match(/([\d,.]+)\s*(?:reactions?|likes?)/i));
        const comments = num(spanTexts.match(/([\d,.]+)\s*comments?/i));
        const shares = num(spanTexts.match(/([\d,.]+)\s*shares?/i));

        return { author, text, reactions, comments, shares };
      });

      const timeInfo = await extractPostDateISO(page);
      const pageInfo = await extractPageInfo(page);

      Object.assign(result, { author, text, reactions, comments, shares }, timeInfo || {}, pageInfo || {});
      await Dataset.pushData(result);
      log.info(`Details OK: ${postUrl}`);
    } catch (err) {
      result.status = "error";
      result.error = err?.message || String(err);
      await Dataset.pushData(result);
      log.warning(`Details FAIL: ${postUrl} => ${result.error}`);
    }
  }
}