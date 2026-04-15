# ADR-0001: GA4 Analytics Analysis & Growth Recommendations

**Date:** 2026-04-15  
**Property:** Polina Shvedko Art (`properties/487246310`)  
**Period analysed:** 90 days (2026-01-15 → 2026-04-15)  
**Status:** Active

---

## Executive Summary

The site receives ~3 sessions/day on average across 289 total sessions in 90 days — very low volume for a portfolio selling artwork up to €8,000. The core quality signal is actually strong: 83% engagement rate, 43-second average session, and 80% of visitors scroll to the bottom of the page. People who find the site genuinely look at it.

The critical problem is **discovery**. 89% of traffic is Direct, meaning almost everyone arrives because Polina personally shared a link. Organic Search contributes 8 sessions (2.8%) — essentially zero. There is **no conversion tracking** at all, so there is no way to know whether any visitor ever sent an inquiry.

Three traffic spikes (March 19: 141 sessions; March 30: 56 sessions; March 22: 21 sessions) each brought almost entirely new first-time visitors who did not return. These spikes are almost certainly from Instagram posts — but GA4 classifies Instagram in-app browser traffic as Direct, so the true social contribution is hidden.

The site has no path to passive lead generation until SEO and conversion tracking are addressed.

---

## Data Summary

### Traffic channels (90 days)

| Channel | Sessions | Engagement rate | Avg session |
|---|---|---|---|
| Direct | 258 (89%) | 89.5% | 43s |
| Organic Social | 22 (8%) | 18.2% | 4s |
| Organic Search | 8 (3%) | 62.5% | 148s |
| Referral | 1 (<1%) | 0% | 0s |

### Device split

| Device | Sessions | Engagement rate | Avg session |
|---|---|---|---|
| Desktop | 267 (92%) | 87% | 44s |
| Mobile | 22 (8%) | 32% | 26s |

### Geography

| Country | Sessions | Engagement rate |
|---|---|---|
| Germany | 257 (89%) | 91.8% |
| United States | 27 (9%) | 11.1% |
| Others | 4 | mixed |

Top German cities: Schwäbisch Hall (31), Trappenkamp (23), Göttingen (19), Delmenhorst (15), Gengenbach (15), Velbert (15), Berlin (8).

### Events tracked (90 days)

| Event | Count | Users |
|---|---|---|
| page_view | 331 | 280 |
| session_start | 289 | 280 |
| first_visit | 280 | 280 |
| user_engagement | 236 | 214 |
| scroll (90% depth) | 233 | 215 |
| video_progress | 63 | 8 |
| video_start | 35 | 14 |
| click (external) | 2 | 2 |

### Key anomalies

- **280 out of 289 sessions (97%) are first-time visitors.** Almost nobody returns. The site creates no reason to come back.
- **March 19 spike: 141 sessions in one day, all first-time, all classified as Direct.** This is Instagram in-app browser behaviour — the referrer is stripped. A single post drove ~49% of all traffic in the quarter.
- **Columbus OH (10 sessions, 0% engagement) and Prineville OR (7 sessions, 15% engagement)** are known cloud/CDN data centre locations (AWS, Meta infra). These are bots and inflate the US numbers.
- **Only 2 click events recorded.** The contact email link and artwork inquiry actions are either not tracked or not being clicked.
- **Video: 35 starts across 14 users.** Some users watch multiple videos, but only 5% of all sessions involve any video interaction — the video content is invisible to most visitors.
- **Organic Search average session: 148 seconds** — 3.4× longer than any other channel. People who find the site via Google are the most qualified visitors by far.

---

## Prioritised Action List

### Priority 1 — Conversion tracking (impact: critical, effort: low)

**1.1 Track the contact email as a GA4 event**

Without this, there is zero visibility into whether the site generates leads. Add to `src/js/` (or inline in `footer.html`):

```js
document.querySelectorAll('a[href^="mailto:"]').forEach(el => {
  el.addEventListener('click', () => {
    gtag('event', 'contact_click', { event_category: 'engagement', event_label: 'email' });
  });
});
```

Then mark `contact_click` as a Key Event in GA4 Admin → Events → Mark as key event.

**1.2 Track artwork popup opens as an event**

The existing JS click handlers that open the `t754` popup should fire:

```js
gtag('event', 'artwork_view', { artwork_title: title, artwork_price: price });
```

This reveals which artworks generate the most interest — crucial for pricing and placement decisions.

**1.3 Track the "Add to Cart" / cart widget interactions**

Even if no purchase completes online, knowing which artworks get cart interactions versus which get ignored is high-value signal.

---

### Priority 2 — Fix the Instagram attribution black hole (impact: high, effort: low)

The March 19 spike (141 sessions) is almost certainly from an Instagram post, but GA4 shows it as Direct because the Instagram in-app browser strips referrer headers. Every time Polina posts with a link in bio or story, this same misclassification happens.

**Fix:** Always append UTM parameters to the link in the Instagram bio:

```
https://polina-shvedko.art/?utm_source=instagram&utm_medium=social&utm_campaign=bio
```

For stories/posts, use unique campaign names:
```
?utm_source=instagram&utm_medium=social&utm_campaign=post_march19
```

This will correctly route social traffic out of Direct and reveal the true relationship between posting frequency and site visits.

---

### Priority 3 — Mobile experience (impact: high, effort: medium)

Mobile engagement is 32% vs 87% on desktop — a 2.7× gap. Mobile visitors are landing and leaving immediately. With artwork up to €8,000, a collector browsing on a phone who has a bad experience is a lost sale.

Specific issues to investigate (test on an actual phone, not emulator):

- The gallery popup (`t754`) likely does not work well on small screens
- The image slider in the popup may be non-obvious to swipe
- The floating cart widget may obscure the contact email on small screens
- No sticky navigation means mobile users have no orientation cues (this is in TODO.md)

**Quick win:** Add the sticky navigation menu (already in the TODO backlog). It has outsized mobile impact.

---

### Priority 4 — SEO foundation (impact: very high, effort: medium)

The site currently has **one URL** (`/`) with no page-level SEO targeting. Organic Search contributes 8 sessions in 90 days. This is the largest unrealised growth opportunity.

**4.1 Add structured data (JSON-LD) for artworks**

Google can display artworks directly in search results with price, availability, and images via `schema.org/VisualArtwork`. This is the single highest-leverage SEO action for an art portfolio. Add to each artwork in the popup or via a script block in `head.html`.

Example schema per artwork:
```json
{
  "@context": "https://schema.org",
  "@type": "VisualArtwork",
  "name": "Affectionate Farewell, Cap d'Antibes",
  "artist": { "@type": "Person", "name": "Polina Shvedko" },
  "artMedium": "Oil on Canvas",
  "width": "190 cm",
  "height": "45 cm",
  "offers": { "@type": "Offer", "price": "8000", "priceCurrency": "EUR" }
}
```

Since the artworks are already in `data.json`, this can be generated as a script block via the Mustache template — no HTML editing needed.

**4.2 Add descriptive `<title>` and `<meta description>` per section**

The entire site is one HTML file. At minimum, the `<title>` tag should be descriptive:
```html
<title>Polina Shvedko — Original Oil, Pastel & Watercolour Paintings | Germany</title>
```

And the meta description should mention buying originals, commissions, and the artist's location (Germany) — the primary search intent for people who would buy her work.

**4.3 Consider a simple blog or "About the artwork" article**

A 300-word article about one painting (e.g. the cap d'Antibes panoramic) would create a second indexable URL and provide a long-tail search entry point. This is a low-cost way to start building topical authority.

---

### Priority 5 — Increase return visits (impact: medium, effort: low)

97% of visitors never return. There is no mechanism to stay in touch.

**5.1 Add a newsletter signup** (even just a Mailchimp embedded form) to the contact section. "Get notified when new artwork is available" is a natural offer for art buyers. This converts one-time visitors into a warm audience that can be reactivated when new work is listed.

**5.2 Add an Instagram embed or feed widget** to the homepage footer. This gives visitors a reason to follow Instagram from the site, creating a channel for Polina to reach warm leads with new posts.

---

### Priority 6 — Suppress bot traffic from GA4 (impact: low, effort: low)

Columbus OH and Prineville OR are AWS/Meta infrastructure locations. Their 17 combined sessions with near-zero engagement inflate the US country count and distort channel metrics. 

In GA4 Admin → Data Streams → Configure tag settings → Define internal traffic, add IP-based filters, or in GA4 Admin → Reporting Identity → enable "Blended" to filter known bots. Alternatively, add `{ "filters": [{ "fieldName": "country", "value": "United States" }] }` filter when reviewing reports until the bot traffic pattern is confirmed.

---

### Priority 7 — What to measure next (currently invisible)

| What to track | Why it matters |
|---|---|
| `artwork_popup_open` event with title + price | Reveals which works generate the most interest |
| `contact_click` (email link) | The only real conversion signal on the site |
| `video_start` / `video_complete` with video title | 14 users started videos; zero visibility into which artwork videos are watched |
| Instagram UTM tagging | Reveals true social → site relationship |
| Scroll depth per artwork section | Single-page site; need to know if visitors reach the aquarelle section at the bottom |
| Return visitor sessions over 6 months | Baseline is 3% return rate; goal should be 15%+ once newsletter is added |

---

## Summary of Quick Wins (can be done in < 1 day)

1. Add `contact_click` gtag event to the email link — zero cost, immediate conversion visibility
2. Add UTM parameters to the Instagram bio link — reveals the true traffic source for all future spikes
3. Add `<title>` tag with location + medium keywords — 30-minute SEO improvement
4. Mark `contact_click` as a GA4 Key Event in the admin UI — enables funnel analysis

These four actions together transform the analytics from "counting visitors" to "measuring a conversion funnel."

---

## Deployment: GitHub Actions CI/CD via SFTP

### Decision

Every push to `main` automatically builds the static site and deploys the `app/` directory to the web hosting server via SFTP using `lftp`. This matches the existing webhosting setup at `polina-shvedko.art`.

### Workflow file

`.github/workflows/deploy.yml`

```
push to main
  → actions/checkout@v4
  → actions/setup-node@v4  (Node 22, npm cache)
  → npm ci
  → npm run build           (gulp: css + babel + html + img + fonts)
  → lftp mirror --reverse --delete
      ./app → $SFTP_REMOTE_PATH
```

`lftp mirror --delete` keeps the remote in exact sync — files removed from `app/` are also deleted from the server.

### Required GitHub Secrets

Add these in repo **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Example value | Description |
|---|---|---|
| `SFTP_HOST` | `ftp.polina-shvedko.art` | Hostname from your hosting control panel |
| `SFTP_PORT` | `22` | SFTP port (22 is standard; some hosts use 2222) |
| `SFTP_USERNAME` | `u12345` | SFTP username from hosting panel |
| `SFTP_PASSWORD` | `••••••••` | SFTP password from hosting panel |
| `SFTP_REMOTE_PATH` | `/public_html/` | Remote directory to deploy into |

### Concurrency

`cancel-in-progress: false` — if two pushes land in quick succession the second deploy waits rather than cancelling the first. This prevents a half-deployed state.

### Rollback

To revert a bad deploy, push a revert commit to `main` — the workflow re-deploys automatically. Alternatively:

```bash
git revert HEAD
git push
```
