# TODO — Polina Shvedko Artist Website

The site was rebuilt by ADR-0003 (`ADR/ADR0003-seo-rebuild-artwork-pages.md`) on the branch
`adr-0003-seo-rebuild`: one page per artwork under three medium hubs, no framework code, no shop (no prices, no
cart), no blog. Items below that mention the old popup, cart or prices are history.

## Open — owner decisions before the release (ADR-0003)

- [ ] **Slugs** — approve the 30 artwork URLs (`slug` in `data.json`; they must not change after the release).
- [ ] **Sizes** — confirm the 5 width/height swaps made from the photos (Hortensien, Hamburg Main Railway Station,
  Blossoms at the Biergarten, Springtime Along the Canal, By the Old Watermill) and the 2 kept as they were
  (A Quiet Stroll in the Park, Sunny Village Square).
- [ ] **Media** — "Sunset in a honey dream": canvas or synthetic paper on a wooden frame? Its description starts with
  another title ("Sunset Harbor Dreams"). "Sunny Village Square": watercolour, or watercolour and ink?
- [ ] **Hub texts** — approve or rewrite the three draft intros (`intro_status: "draft"`).
- [ ] **Cap d'Antibes story** — confirm the facts; then set `story_confirmed: true` (the text has a morning/evening
  contradiction and doubtful geography).
- [ ] **Consent banner text** — approve (`CONSENT_TEXT` in `scripts/build-site.js`).
- [ ] **Impressum and privacy policy** — provide the legal texts (`legal.imprint_html`, `legal.privacy_html`); the
  privacy text must name Google Analytics and the YouTube video (youtube-nocookie.com, loaded on click). A generated
  HTML text can be pasted as it is (its own `h1` and e-mail links are fine).
- [ ] **Unused source images** — 13 files in `src/img/` are not referenced (listed in the ADR-0003 tracker); delete
  them or keep them.
- [ ] **Back-to-top button** — the old floating button is not in the rebuild; re-add it only if wanted.
- [ ] **Artwork titles** — 12 of the 30 `<title>`s carry medium and year, 11 only the medium, 7 neither (the rule
  drops the year, then the medium, to stay within 60 characters). Say if every title should keep the medium.
- [ ] **Rich Results Test** — paste the built HTML of one page per type into Google's Rich Results Test (Code tab;
  needs a Google login). validator.schema.org already reports 0 errors and 0 warnings.

## Open — after the release (owner)

- [ ] Plesk: nothing to switch on. nginx passes every request to Apache on this server, so the `.htaccess` covers
  every response (redirects in one hop, cache headers). Keep "Serve static files directly by nginx" off; if it is
  ever switched on, remove htm, html and txt from its extension list and set "Expires" for the remaining static
  files. Check that `curl -I http://www.polina-shvedko.art/oil-paintings` answers one 301 straight to
  `https://polina-shvedko.art/oil-paintings/` (also if the optional Plesk HTTPS and preferred-domain switches are on).
- [ ] Main checkout, once after the merge, with a clean working tree only (`git reset --hard` discards every
  uncommitted change to tracked files: commit or `git stash -u` first): `git rm -r --cached . && git reset --hard`
  (LF line endings; the checkout has `core.autocrlf=true`), then `git stash pop` if you stashed; and
  `sudo chown -R "$(id -u):$(id -g)" app src/img` if the dev container left root-owned files.
- [ ] Search Console: submit `https://polina-shvedko.art/sitemap.xml`; request indexing for `/` and the three hubs.
- [ ] GA4: mark `contact_click` as a key event; unmark `purchase_inquiry` / `cart_order`; register the event
  parameters `link_location` and `artwork_slug` as custom dimensions; annotate the release date (GA4 numbers drop
  because Analytics now waits for consent).
- [ ] GA4: add a filter or segment for the night-burst bot sessions.
- [ ] Re-run `/seo-report` three weeks after the release.

## Open — content

- [ ] Add photos from Etsy (interior shots, without frame) for "Elegance in Roses", "Sunset in a honey dream",
  Lilacs in Bloom, Forget-Me-Nots in Glass, Hortensien, Blossoms in a Blue Pot — **BLOCKED: needs manual download**.
- [ ] Exhibition / CV section (ADR-0002 M1: not planned).

## Done (history)

- [x] New artwork "Affectionate Farewell, Cap d'Antibes, France" (oil, 190 × 45 cm, 6 photos), full-width card.
- [x] Sizes and frame data of the pastel flower works and "Sunset in a honey dream" updated.
- [x] Sticky navigation (still in the rebuild).
- [x] Hero "Explore Artworks" button (still in the rebuild; the video now loads on click).
- [x] Inquire button in the artwork popup — replaced by the "Ask about this work" button on each artwork page.
- [x] Gallery filter (available / sold) — removed by ADR-0003; the hub pages replace it.
- [x] Artwork year in `data.json`, shown on the artwork page.
- [x] `og:image` — every indexable page has one (absolute JPEG URL: the 1200 px variant, or the original width
  when it is narrower). Each hub uses the main image of its first artwork (so it shares the `og:image` with that
  artwork page); home uses `site.images.og_default`, the Cap d'Antibes photo, so home, the oil hub and that page
  share one image.
- [x] Prices and the cart currency — obsolete: ADR-0003 removed prices and the cart.
- [x] Footer copyright year — now taken from `site.lastmod` in `data.json`.
- [x] "I'm a freelance artist" grammar fix in About me.
- [x] Mixed languages — English only; a test fails on any Cyrillic character.
- [x] Sitemap — generated from `data.json` with every page (36 URLs).
- [x] Cookie consent — rebuilt: Accept / Decline; Google Analytics loads only after Accept.
- [x] Google Analytics `G-G10K54YDPQ` — loaded by `src/js/consent.js`.
- [x] Instagram mosaic links to the Instagram profile.
- [x] Scroll fade-in animations of the old framework — removed with it.
