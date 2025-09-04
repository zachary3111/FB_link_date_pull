# Facebook Posts/Comments Scraper 

This actor scrapes Facebook posts and comments using Playwright.
It requires **logged-in cookies** to access search results consistently.

## Features
- Search mode: provide `search_queries` to scrape posts from Facebook search
- Direct mode: provide `post_urls` to scrape specific posts
- Extracts post fields: text, timestamps, author info, counts
- Extracts comment fields: author info, text, like/reply counts, timestamps
- Rate limiting + random waits
- Saves to the default dataset in two item types: `post` and `comment`

## Input
See `input_schema.json` for all parameters. The most important is `cookies`:
- Provide a **raw Cookie header string** copied from your browser (while logged into facebook.com).
- Never share cookies publicly.

## Local run
```bash
npm install
npm run build
apify run  # or: node dist/main.js
```

## Push to Apify
```bash
apify login
apify push --name facebook-posts-comments-clone
```

## Notes
- Facebook constantly changes markup; you may need to tweak selectors.
- Responsible use only. Respect site terms and local laws.# FB_link_date_pull
