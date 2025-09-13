import { Dataset, log } from "apify";
import { extractPostDateISO } from "../utils/postTime.js";

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export async function runPostDates(page, urls, waits) {
  const { min_wait_ms, max_wait_ms } = waits;
  for (const postUrl of urls) {
    const result = { url: postUrl, item_type: "post_date", status: "success" };
    try {
      await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(rand(min_wait_ms, max_wait_ms));

      const timeInfo = await extractPostDateISO(page);
      if (!timeInfo) throw new Error("Could not detect post time");

      Object.assign(result, timeInfo);
      await Dataset.pushData(result);
      log.info(`Date OK: ${postUrl} => ${timeInfo.iso}`);
    } catch (err) {
      result.status = "error";
      result.error = err?.message || String(err);
      await Dataset.pushData(result);
      log.warning(`Date FAIL: ${postUrl} => ${result.error}`);
    }
  }
}