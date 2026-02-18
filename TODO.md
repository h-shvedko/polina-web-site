# TODO — Polina Shvedko Artist Website

## Highest Priority — Content Updates (from Etsy)

### 1. Add new artwork: "Affectionate Farewell, Cap d'Antibes, France" (Oil)
- [ ] Add to oil gallery as top item, full width (`t-col_12`, 3 columns)
- [ ] Need from Etsy listing: description, dimensions, price, medium details
- [ ] Download images from Etsy → `src/img/gallery/picture32_*.jpg`
- [ ] Etsy link: `https://www.etsy.com/de-en/listing/4446504625`
- **Status: BLOCKED** — Etsy blocks automated scraping; need manual image download and metadata

### 2. Update existing artworks

#### 2.1 Pastel "Elegance in Roses" & Oil "Sunset in a honey dream"
- [ ] Update dimensions: 32 cm × 23.5 cm on a frame (wood and glass — 50 cm × 40 cm)
- [ ] Add photos from Etsy: interior shots and without frame (3 photos total)
- [ ] Change price to 300€

#### 2.2 Oil "Sunset in a honey dream"
- [x] Add to description: "... background Synthetic paper (polymer-based) on a wooden frame, 90 cm × 60 cm"

#### 2.3 Pastel flower artworks: Lilacs in Bloom, Forget-Me-Nots in Glass, Hortensien, Blossoms in a Blue Pot
- [ ] Update dimensions and frame info (similar to 2.1)
- [ ] Add interior/Etsy photos

#### 2.4 Oil "Boats in the Bay of Roses"
- [x] Change price to 500€

---

## High Impact (Visitor Experience)

- [ ] **Navigation Menu** — Add sticky top nav with anchor links (Oil / Pastel / Aquarelle / About / Contact). No navigation exists currently; visitors must scroll the entire page.
- [x] **Hero Section CTA** — Add "View Gallery" or "Explore Artworks" button to the hero. Currently only a title, email link, and a tiny scroll arrow.
- [ ] **"Add to Cart" / "Inquire" button in artwork popup** — The detail popup shows artwork info but has no buy/inquire action. Visitors must close the popup and find the floating cart icon.
- [ ] **Gallery Filtering** — Add filter by availability (available / sold / all). 10+ items are sold; visitors scroll past artwork they can't buy.
- [x] **Back to Top Button** — Floating button for the long single-page layout, especially important on mobile.

## Medium Impact (Trust & Professionalism)

- [ ] **Exhibition / CV Section** — Add credentials, exhibition history, or press mentions. Builds trust for higher-priced pieces (up to €8000).
- [ ] **Commission Request Section** — Add a "Commission a Painting" section with a form or CTA paragraph for custom work inquiries.
- [ ] **Artwork Year/Date** — Add creation year to each artwork in `data.json` and display it in the card/popup. Shows the artist is actively producing.

## Quick Fixes (Bugs & SEO)

- [ ] **Fix empty `og:image`** — `og:image` meta tag in `head.html` has no value. Social sharing on Facebook/WhatsApp/iMessage shows no preview image.
- [x] **Fix currency mismatch** — Cart widget changed from $ (USD) to € (EUR) to match displayed prices.
- [x] **Update copyright year** — Updated from "2024" to "2025" in `footer.html`.
- [x] **Fix grammar in About Me** — Changed "I'm free artist" to "I'm a freelance artist" in `aboutme.html`.
- [x] **Fix mixed languages** — Removed all Russian text from cart (heading, labels, button, success message, aria-labels). Now English only.
- [x] **Fix sitemap URL typo** — Changed `polins-shvedko.artist` to `polina-shvedko.art` in `gulpfile.js`.

## Nice to Have (Future)

- [x] **Cookie Consent Banner** — Required for EU visitors under GDPR if analytics are added.
- [x] **Google Analytics** — Added gtag.js snippet to `head.html`. Replace `G-XXXXXXXXXX` with your actual Measurement ID.
- [x] **Lightbox on Instagram Mosaic** — All 5 mosaic tiles now link to the Instagram profile (`instagram.com/polina_shvedko`).
- [x] **Smooth Scroll Animations** — Enabled `data-animationappear="on"` on all 3 gallery sections and the Instagram mosaic. Cards fade in on scroll.
