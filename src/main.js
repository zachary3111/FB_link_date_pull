import { Actor, Dataset, log } from 'apify';
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Extract details for a single Facebook post.
 * @param {import('playwright').Page} page
 * @param {string} post_url
 * @returns {Promise<Object>}
 */
async function extractPostDetails(page, post_url) {
  await page.goto(post_url, { waitUntil: 'domcontentloaded' });

  // Give FB a moment to render + expand long text
  await page.waitForTimeout(1200);
  const seeMore = await page.$('div[role="button"]:has-text("See more")');
  if (seeMore) await seeMore.click().catch(() => {});
  // Nudge rendering (helps some layouts)
  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(300);

  // -------- DESKTOP scrape --------
  const post = await page.evaluate(() => {
    const getText = () => {
      const blocks = Array.from(document.querySelectorAll('div[dir="auto"]'))
        .map(n => n.innerText).filter(Boolean);
      return blocks.join('\n').trim();
    };

    const authorEl = document.querySelector('h3 a[role="link"], strong a[role="link"]');
    const author_username = authorEl ? authorEl.textContent.trim() : '';
    const author_profile_url = authorEl ? authorEl.href : '';

    // Try several desktop sources and record where it worked
    let create_time_unix = null;
    let create_time_iso = null;
    let ts_source = 'none';

    // 1) Epoch: abbr[data-utime]
    const ab = document.querySelector('abbr[data-utime]');
    if (ab && ab.getAttribute('data-utime')) {
      const ut = parseInt(ab.getAttribute('data-utime'), 10);
      if (!Number.isNaN(ut)) {
        create_time_unix = ut;
        create_time_iso = new Date(ut * 1000).toISOString();
        ts_source = 'desktop:data-utime';
      }
    }

    // 2) ISO: time[datetime]
    if (!create_time_iso) {
      const t = document.querySelector('time[datetime]');
      if (t && t.getAttribute('datetime')) {
        const p = Date.parse(t.getAttribute('datetime'));
        if (!Number.isNaN(p)) {
          create_time_unix = Math.floor(p / 1000);
          create_time_iso = new Date(p).toISOString();
          ts_source = 'desktop:time[datetime]';
        }
      }
    }

    // 3) Absolute string on aria-label/title (very common on desktop)
    if (!create_time_iso) {
      const attrEl =
        document.querySelector('a[role="link"][aria-label] time') ||
        document.querySelector('a[role="link"][aria-label]') ||
        document.querySelector('abbr[title]') ||
        document.querySelector('span[title]');
      if (attrEl) {
        const raw = attrEl.getAttribute('aria-label') || attrEl.getAttribute('title') || '';
        const cleaned = raw.replace(/^Updated\s+/i, '').trim();
        const p = Date.parse(cleaned);
        if (!Number.isNaN(p)) {
          create_time_unix = Math.floor(p / 1000);
          create_time_iso = new Date(p).toISOString();
          ts_source = 'desktop:attr';
        }
      }
    }

    // 4) Relative visible text (“2 h”, “Yesterday”, “August 18 at 4:43 AM”, etc.)
    if (!create_time_iso) {
      const relTxt = (document.querySelector('a[href*="/story.php"] span, a[role="link"] span, abbr')?.textContent || '').trim();
      if (relTxt) {
        const now = Date.now();
        let ms = null, m;
        // Handle explicit relative patterns like “5 m”, “3 h”, “2 d”, “Yesterday”, “just now”
        if (/^just now$/i.test(relTxt)) ms = now;
        else if ((m = relTxt.match(/^(\d+)\s*m(in)?$/i))) ms = now - parseInt(m[1], 10) * 60_000;
        else if ((m = relTxt.match(/^(\d+)\s*h(ours?)?$/i))) ms = now - parseInt(m[1], 10) * 3_600_000;
        else if ((m = relTxt.match(/^(\d+)\s*d(ays?)?$/i))) ms = now - parseInt(m[1], 10) * 86_400_000;
        else if (/^yesterday$/i.test(relTxt)) ms = now - 86_400_000;

        if (ms !== null) {
          // Relative offset matched; compute absolute timestamp
          create_time_unix = Math.floor(ms / 1000);
          create_time_iso = new Date(ms).toISOString();
          ts_source = 'desktop:relative';
        } else {
          // Try native Date.parse on the string
          let p = Date.parse(relTxt);
          if (!Number.isNaN(p)) {
            create_time_unix = Math.floor(p / 1000);
            create_time_iso = new Date(p).toISOString();
            ts_source = 'desktop:Date.parse(relative)';
          } else {
            // Many Facebook timestamps omit the year and may include "at" before the time, e.g. “August 18 at 4:43 AM”.
            // Attempt to parse strings of the form "<Month> <Day>[, <Year>] [at <Time> AM|PM]".
            const mdMatch = relTxt.match(/([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?(?:\s*at\s*(\d{1,2}:\d{2}\s*(?:AM|PM)))?/i);
            if (mdMatch) {
              const [, mon, dayStr, yearStr, timeStr] = mdMatch;
              const dayNum = parseInt(dayStr, 10);
              const nowDate = new Date();
              let year = yearStr ? parseInt(yearStr, 10) : nowDate.getFullYear();
              // Construct a date string for parsing. Include the time if present.
              let dateString = `${mon} ${dayNum}, ${year}` + (timeStr ? ` ${timeStr}` : '');
              let parsed = Date.parse(dateString);
              if (Number.isNaN(parsed)) {
                // Some locales parse without the comma
                dateString = `${mon} ${dayNum} ${year}` + (timeStr ? ` ${timeStr}` : '');
                parsed = Date.parse(dateString);
              }
              if (!Number.isNaN(parsed)) {
                // If the parsed date is in the future (e.g. current date is Dec 31 and post is Jan 5), assume previous year
                if (parsed > nowDate.getTime()) {
                  year -= 1;
                  dateString = `${mon} ${dayNum}, ${year}` + (timeStr ? ` ${timeStr}` : '');
                  parsed = Date.parse(dateString);
                }
                if (!Number.isNaN(parsed)) {
                  create_time_unix = Math.floor(parsed / 1000);
                  create_time_iso = new Date(parsed).toISOString();
                  ts_source = 'desktop:relative-month';
                }
              }
            }
          }
        }
      }
    }

    // Post ID (pfbid / digits / story_fbid / fbid / data-ft)
    function getPostId() {
      try {
        const url = new URL(location.href);
        const path = url.pathname || '';
        const mPfbid = path.match(/\/(?:posts|reel|videos|permalink\.php)\/(pfbid[\w]+)/i);
        if (mPfbid) return mPfbid[1];
        const mDigits = path.match(/\/posts\/(\d+)/);
        if (mDigits) return mDigits[1];
        const story = url.searchParams.get('story_fbid');
        if (story) return story;
        const fbid = url.searchParams.get('fbid');
        if (fbid) return fbid;
        const ftEl = document.querySelector('[data-ft]');
        if (ftEl) {
          try {
            const data = JSON.parse(ftEl.getAttribute('data-ft'));
            if (data && data.top_level_post_id) return String(data.top_level_post_id);
          } catch {}
        }
        return url.href;
      } catch {
        return location.href;
      }
    }

    return {
      post_id: getPostId(),
      post_url: location.href,
      text: getText(),
      create_time_unix,
      create_time_iso,
      _ts_source: ts_source,         // <— debug: see which path worked
      author_username,
      author_profile_url,
      like_count: null,
      comment_count: null,
      share_count: null
    };
  });

  // -------- MOBILE FALLBACK (m.facebook.com) --------
  if (!post.create_time_iso) {
    const ctx = page.context();
    const mpage = await ctx.newPage();
    try {
      const mUrl = post.post_url.replace('www.facebook.com', 'm.facebook.com');
      await mpage.goto(mUrl, { waitUntil: 'domcontentloaded' });
      await mpage.waitForTimeout(900);

      const t = await mpage.evaluate(() => {
        const ab = document.querySelector('abbr[data-utime]');
        if (ab && ab.getAttribute('data-utime')) {
          const ut = parseInt(ab.getAttribute('data-utime'), 10);
          if (!Number.isNaN(ut)) {
            const ms = ut * 1000;
            return { unix: ut, iso: new Date(ms).toISOString(), source: 'mobile:data-utime' };
          }
        }
        const tt = document.querySelector('time[datetime]');
        if (tt && tt.getAttribute('datetime')) {
          const p = Date.parse(tt.getAttribute('datetime'));
          if (!Number.isNaN(p)) {
            return { unix: Math.floor(p / 1000), iso: new Date(p).toISOString(), source: 'mobile:time[datetime]' };
          }
        }
        const attrEl = document.querySelector('abbr[title], span[title], a[aria-label]');
        if (attrEl) {
          const raw = attrEl.getAttribute('title') || attrEl.getAttribute('aria-label') || '';
          const p = Date.parse(raw.replace(/^Updated\s+/i, '').trim());
          if (!Number.isNaN(p)) {
            return { unix: Math.floor(p / 1000), iso: new Date(p).toISOString(), source: 'mobile:attr' };
          }
        }
        return { unix: null, iso: null, source: 'mobile:none' };
      });

      if (t && t.iso) {
        post.create_time_unix = t.unix;
        post.create_time_iso = t.iso;
        post._ts_source = t.source;
      }
    } finally {
      await mpage.close().catch(() => {});
    }
  }

  return post;
}


// Actor entrypoint: iterate through input post URLs and scrape each.
await Actor.main(async () => {
  const input = (await Actor.getInput()) || {};
  const {
    headless = true,
    cookies = '',
    post_urls = [],
    min_wait_ms = 600,
    max_wait_ms = 1400,
  } = input;

  log.info('Input', { headless, hasCookies: Boolean(cookies), urls: post_urls.length });

  const browser = await chromium.launch({ headless });
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });

    // Apply cookies provided by the user to the browser context.
    if (cookies) {
      const cookiesArray = cookies
        .split(';')
        .map((cookieStr) => {
          const [name, ...rest] = cookieStr.trim().split('=');
          const value = rest.join('=');
          return { name, value, domain: '.facebook.com', path: '/' };
        })
        .filter((cookie) => cookie.name && cookie.value);
      if (cookiesArray.length) await context.addCookies(cookiesArray);
    }

    const page = await context.newPage();
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' }).catch(() => {});

    for (const post_url of post_urls) {
      try {
        await sleep(rand(min_wait_ms, max_wait_ms));
        const post = await extractPostDetails(page, post_url);
        await Dataset.pushData({ item_type: 'post', ...post });
      } catch (e) {
        log.warning(`Failed post ${post_url}: ${e?.message || e}`);
      }
    }
  } finally {
    await browser.close();
    log.info('Done.');
  }
});