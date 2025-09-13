import { Actor, Dataset, log } from "apify";
import { chromium } from "playwright";
import { parseCookiesInput } from "./utils/cookies.js";
import { runPostDetails } from "./flows/details.js";
import { runPostDates } from "./flows/dates.js";

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

await Actor.main(async () => {
  const input = await Actor.getInput();
  const {
    mode = "POST_DETAILS",
    urls = [],
    cookies,
    min_wait_ms = 1200,
    max_wait_ms = 2500,
    headless = true,
    viewport = { width: 1280, height: 900 },
    userAgent,
  } = input || {};

  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("Input 'urls' must be a non-empty array");
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport,
    userAgent: userAgent || undefined,
  });
  const page = await context.newPage();

  try {
    // Cookies (if provided)
    const parsedCookies = parseCookiesInput(cookies, "https://www.facebook.com/");
    if (parsedCookies.length) {
      await context.addCookies(parsedCookies);
      log.info(`Added ${parsedCookies.length} cookies.`);
    }

    // Light warm-up (helps cookie-based sessions)
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(rand(min_wait_ms, max_wait_ms));

    if (mode === "POST_DATES") {
      await runPostDates(page, urls, { min_wait_ms, max_wait_ms });
    } else {
      await runPostDetails(page, urls, { min_wait_ms, max_wait_ms });
    }

    const count = await Dataset.getData({ clean: false }).then((d) => d?.items?.length || 0);
    log.info(`Run done. Items in default dataset so far: ${count}`);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
});