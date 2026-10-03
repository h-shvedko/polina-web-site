---
description: SEO analysis of polina-shvedko.art from Search Console, GA4, the code and the live site; report in Russian (ASD-STE100), then improvements item by item after approval
argument-hint: "[days, default 28] [focus, optional]"
---

# /seo-report

You are the SEO engineer for polina-shvedko.art, built from this repository.
Work from real data and the real code. Do not give generic SEO advice. Every claim in the
report needs a number, a URL or a file path behind it.

Arguments: `$ARGUMENTS`. The first number is the short period in days (default 28). Any other
text is a focus for this run (for example "only indexing" or "compare with last run").

## Known facts (verified 2026-10-03; re-check each one quickly, update this file when one changes)

- **Stack:** static site. Gulp 4 renders Mustache templates from `src/templates/` with
  `data.json` into `app/` (`gulpfile.js`, task `html`). Tilda CSS/JS components. See `CLAUDE.md`.
- **Deploy:** push to `main` runs `.github/workflows/deploy.yml`. It builds and mirrors `app/`
  to the host over SFTP. A push to `main` is a production deploy.
- **Domain:** `https://polina-shvedko.art` (canonical in `src/templates/partials/head.html`,
  `app/sitemap.xml`, `app/robots.txt`). The host answers 403 to the Python-urllib user agent.
- **Pages:** `/`, `/blog/`, `/blog/<slug>/` (`src/templates/blog/`). The `html` task also
  publishes every partial as `app/partials/**.html` (116 files on 2026-10-03).
- **Language and market:** English only, prices in EUR, artist based in Germany (`addressCountry: DE`).
  Target market in the script: Germany, Austria, Switzerland.
- **Search Console:** `sc-domain:polina-shvedko.art`. **GA4:** `properties/487246310`,
  stream `G-G10K54YDPQ`.
- **Conversions** (`src/js/analytics.js`): `purchase_inquiry` = Tilda cart order sent (the real lead);
  `cart_order` = submit click, also when validation fails; `contact_click` = mailto click;
  `artwork_view` = popup opened. No key events are set in GA4 (2026-10-03).
- **Bot traffic:** 99 of 138 German GA4 sessions in the 90 days to 2026-10-03 came on
  2026-08-20, 2026-08-21 and 2026-09-03, mostly between 00:00 and 04:00, all new and Direct.
  Exclude such bursts from the real-traffic numbers.
- **Consent:** on 2026-10-03 GA loads before consent on every page. If a release changes this,
  GA numbers before and after it are not comparable. Record the release date here.

## Access

- Google credentials: `~/.config/shvedkodev-ga.json` (`authorized_user`, read-only scopes
  `analytics.readonly` and `webmasters.readonly`). Use `token()` in `scripts/seo-report.py`.
  Never print, copy or commit the file or a token. If the token request fails, stop and tell the user.
- The credentials are read-only. You cannot change Search Console, GA4 or Google Ads. List
  those steps for the user instead.
- Ask before you: deploy (push to `main`), change anything users or Google see in production,
  publish new pages, start bulk content generation, change analytics or consent behaviour, or
  change legal pages. Work on a branch. Show the diff and the test results first.

## Phase 1: Baseline (read only)

1. Run on the host (timeout 300 s):
   ```bash
   python3 scripts/seo-report.py 90
   python3 scripts/seo-report.py <days> --no-index
   ```
   The script prints Search Console totals, weeks, queries, pages, countries, devices and the
   latest day with data; URL inspection of the sitemap plus `KNOWN_PAGES`; GA4 by country,
   channel, landing page and device, for all countries and the target market; site events.
   It saves `~/.local/state/polina-shvedko.art-seo/<date>-<days>d.json` and prints the change
   against the previous run with the same period. Add new pages to `KNOWN_PAGES` in the script.
2. For questions the script does not answer, call the same APIs with its `token()`/`call()`.
   URL inspection allows 2,000 calls a day.
3. Separate real traffic from bots: zero engagement, 0-3 s sessions, night bursts of new Direct
   sessions, countries outside the target market. Report the target-market segment on its own.
4. Check which events are real leads, against `src/js/analytics.js`. Look for spam bursts.

## Phase 2: Technical audit (code and live site)

Check and report with file paths and URLs: titles and descriptions (title ≤ 60, description
120-155, one h1 per page); canonicals and one URL per document (www/apex, http → https,
`index.html`, query parameters, no redirect chains); `<html lang>`; sitemap completeness and the
`Sitemap:` line in robots.txt; 404/410 behaviour and noindex on non-pages (`/partials/`);
structured data (Person, VisualArtwork, Article, Breadcrumb); Open Graph on all pages; internal
links and orphan pages; performance (image bytes, render-blocking scripts, LCP, CLS); mobile at
390 px (horizontal scroll, text size, tap targets); alt texts and heading order; consent before
analytics (German law applies).

Use Playwright for the live checks (install it in the scratchpad: `npm i playwright@1`; the
Chromium build is in `~/.cache/ms-playwright`). Measure desktop and 390 px.

## Phase 3: Content analysis

Map pages to search intents. Find thin pages, duplicates and cannibalisation. Find content gaps
from Search Console queries first; mark web research as such. Flag pages at positions 1-10 with
low CTR. Check facts and consistency across pages (prices, sizes, years, claims in meta tags that
the page does not support). Check language quality (no Cyrillic characters in English text).

## Phase 4: Report

Write the report in Russian. Apply ASD-STE100 (Simplified Technical English) rules to the Russian text:

- One idea in one sentence. Descriptive sentences: at most 25 words. Instructions: at most 20 words.
- One instruction in one sentence. Start each instruction with a verb in the imperative.
- Active voice. Present tense for facts. No speculative forms where a fact exists.
- One term for one concept in the whole report. Keep Google UI states, event names, file paths
  and URLs in their original form.
- No idioms, no undefined jargon, no filler, no evaluative adjectives without data.
- Give every number with its unit and period. Use a list for a series of more than two items.
- Paragraphs: at most six sentences.

Sections:

1. **Итог:** three sentences: biggest problem, biggest opportunity, first action.
2. **Проект:** the facts above, confirmed, with sources.
3. **Исходные данные:** baseline numbers, with period and date of the latest data.
4. **Индексация:** table by section, plus important pages that are missing.
5. **Технические проблемы:** table with page or file, issue, severity (критично / высокая / средняя / низкая), fix.
6. **Контент:** findings and gaps, each with evidence.
7. **Изменения:** comparison with the previous snapshot, with both dates.
8. **Действия:** numbered imperative instructions. Mark each as a quick win (under 2 hours) or a
   larger item. Give expected effect, effort and dependencies. Say who does it: the agent (change
   in this repository) or the user (Google UI or another external service).

Do not invent numbers. Where data is missing or too small (under 100 impressions), say so and why.
Stop after the report. Change nothing until the user approves items.

## Phase 5: Implement (after approval, item by item)

- Make each change on a branch with a test that fails before and passes after, where possible
  (rendered `app/` output, sitemap contents, Playwright checks at desktop and 390 px).
- Edit `src/` and `data.json`, never `app/` by hand; rebuild with `npx gulp css babel html fonts`.
- Run all checks and a browser check before you ask to deploy. After the deploy, re-run the
  browser checks against the live site and report in Russian under the same rules.
- New content: a closed list of topics the user approves. No doorway pages, no third-party
  statistics, no client names. Do not write first-person stories for the artist; ask her for the facts.
  Proofread every page before publication.

## Phase 6: Monitoring

Re-run this command two to three weeks after each release. Judge a release only on data dated
after it. Keep the log below short: release date, what changed, what was measured afterwards.

### Log

- 2026-10-03: baseline. 90 days: 5 clicks, 144 impressions, position 6.5 (Search Console to 2026-09-29);
  184 GA4 sessions, of which about 21 real target-market sessions; 0 `purchase_inquiry`.
