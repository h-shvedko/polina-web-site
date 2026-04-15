# ADR-0002: UX & Feature Backlog — Open Items from TODO.md

**Date:** 2026-04-15
**Status:** Active

---

## Context

After completing the initial site build and the analytics/SEO improvements in ADR-0001, a set of UX and feature items remain open in `TODO.md`. This ADR documents each item with priority, rationale, and a concrete implementation approach so that future work sessions have a clear brief.

Items are grouped by impact tier, matching `TODO.md`.

---

## High Impact — Visitor Experience

### H1 — Sticky Navigation Menu

**Problem:** There is no navigation. Visitors must scroll the entire single-page site blind. On mobile (where the engagement rate is already 32% vs 87% on desktop — see ADR-0001) there are no orientation cues at all.

**Decision:** Add a sticky `<nav>` bar that appears at the top of the viewport on scroll and contains anchor links to each section.

**Implementation sketch:**
```html
<!-- src/templates/partials/header.html — add after hero section -->
<nav id="site-nav" class="site-nav site-nav--hidden" aria-label="Site navigation">
  <ul>
    <li><a href="#oil">Oil</a></li>
    <li><a href="#pastel">Pastel</a></li>
    <li><a href="#aquarelle">Aquarelle</a></li>
    <li><a href="#about">About</a></li>
    <li><a href="#contact">Contact</a></li>
  </ul>
</nav>
```

Each gallery section record already has an `id` attribute (`rec500073019` etc.) — replace or supplement with semantic anchor IDs. The nav becomes visible after scrolling past the hero via an `IntersectionObserver` on `.t-cover`. Styles go in `src/css/` as a new file `nav.css`.

**Acceptance criteria:**
- Nav is not visible until the hero scrolls out of view
- Clicking a nav link smooth-scrolls to the section
- Nav works on mobile (hamburger or horizontal scroll on small viewports)
- Does not interfere with Tilda's `z-index` stack (use `z-index: 1000` or higher)

---

### H2 — "Inquire" / "Add to Cart" Action in Artwork Popup

**Problem:** The detail popup (`t754`) shows the artwork, its price, and description, but there is no action. A visitor who wants to buy must close the popup and find the floating cart icon — a friction point that likely kills conversion.

**Decision:** Add an "Inquire / Add to Cart" button directly inside the popup footer.

**Implementation sketch:**

In `src/templates/partials/gallery/gallery_details.html`, add inside the popup footer:
```html
<div class="t754__popup-btn-wrap">
  <button class="t-btn t-btn_sm t754__popup-inquire-btn"
          data-product-lid="{{lid}}"
          onclick="t706_addToCart(this)">
    Add to Cart
  </button>
</div>
```

`t706_addToCart` is the Tilda cart API function already used by the floating cart widget. The `data-product-lid` attribute must match the `lid` value in `data.json`.

**Acceptance criteria:**
- Button is visible in the popup on desktop and mobile
- Clicking it adds the item to the Tilda cart and shows the cart notification
- GA4 `artwork_add_to_cart` event fires (extend `src/js/analytics.js`)

---

### H3 — Gallery Filtering (Available / Sold / All)

**Problem:** 10+ artworks are marked as sold. Visitors who want to buy scroll past artwork they cannot purchase. No mechanism exists to filter the view.

**Decision:** Add a client-side filter bar above each gallery section with three states: **All** (default), **Available**, **Sold**.

**Implementation sketch:**

Add a filter bar partial `src/templates/partials/gallery/gallery_filter.html`:
```html
<div class="gallery-filter" data-gallery="{{gallery_id}}">
  <button class="gallery-filter__btn gallery-filter__btn--active" data-filter="all">All</button>
  <button class="gallery-filter__btn" data-filter="available">Available</button>
  <button class="gallery-filter__btn" data-filter="sold">Sold</button>
</div>
```

Add to `src/js/` a `gallery-filter.js`:
```js
document.querySelectorAll('.gallery-filter').forEach(function(bar) {
  bar.querySelectorAll('.gallery-filter__btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var filter = btn.dataset.filter;
      var galleryId = bar.dataset.gallery;
      var cards = document.querySelectorAll('#' + galleryId + ' .js-product');
      cards.forEach(function(card) {
        var isSold = card.querySelector('.t754__badge') !== null;
        var show = filter === 'all'
          || (filter === 'available' && !isSold)
          || (filter === 'sold' && isSold);
        card.style.display = show ? '' : 'none';
      });
      bar.querySelectorAll('.gallery-filter__btn').forEach(function(b) {
        b.classList.toggle('gallery-filter__btn--active', b === btn);
      });
    });
  });
});
```

Sold artworks are identified by the presence of the `.t754__badge` (SOLD) element already rendered by `gallery_card.html`.

**Acceptance criteria:**
- Filter bar appears above each of the three gallery sections
- "Available" hides sold items; "Sold" hides available items; "All" shows everything
- State resets to "All" on page reload (no persistence needed)

---

## Medium Impact — Trust & Professionalism

### M1 — Exhibition / CV Section

**Problem:** The site sells artwork up to €8,000 but provides no credentials, exhibition history, or press mentions. High-value buyers do background research before purchasing.

**Decision:** Add a new section between "About Me" and the social media mosaic with a short CV — exhibitions, awards, media mentions, or education. Even 3–4 entries significantly increase perceived legitimacy.

**Implementation sketch:**

Use Tilda's `t484` (text content section) pattern already used in `aboutme.html`. Add a new partial `src/templates/partials/cv.html` and insert it in `src/templates/index.html` after `{{> partials/aboutme.html}}`.

The content itself must be provided by Polina. Placeholder structure:
```
Solo Exhibitions:
  2024 — [Gallery Name], [City]
  2023 — ...
Group Exhibitions:
  2025 — ...
Education:
  ...
```

**Acceptance criteria:**
- Section renders between "About Me" and Instagram mosaic
- Responsive on mobile
- Content populated with real data from Polina

---

### M2 — Commission Request Section

**Problem:** Custom commission work is a revenue stream that is currently invisible. Potential buyers do not know commissions are available.

**Decision:** Add a "Commission a Painting" CTA section above the contact section. It should explain the process briefly (3 sentences) and include a direct mailto CTA button.

**Implementation sketch:**

New partial `src/templates/partials/commission.html` using `t484` layout. Insert in `index.html` before `{{> partials/contact.html}}`.

Button:
```html
<a href="mailto:polina.shvedko.artist@gmail.com?subject=Commission%20Request"
   class="t-btn">Request a Commission</a>
```

**Acceptance criteria:**
- Section is visible before the contact block
- CTA opens a pre-filled email with subject "Commission Request"
- GA4 `contact_click` event fires (already handled by the mailto tracker in `src/js/analytics.js`)

---

### M3 — Artwork Creation Year

**Problem:** The gallery shows no creation dates. This makes it impossible for a visitor to know if Polina is actively producing. New work is a key buying signal.

**Decision:** Add a `year` field to each artwork entry in `data.json` and display it in `gallery_card.html` and `gallery_details.html` as a subtitle below the title.

**Implementation sketch:**

In `data.json`, add `"year": 2024` (or appropriate year) to each artwork object.

In `gallery_details.html`, add below the title:
```html
{{#year}}<div class="t754__popup-year">{{year}}</div>{{/year}}
```

**Acceptance criteria:**
- Year appears in the popup for all artworks that have it defined
- Year is optional — artworks without the field render normally (Mustache `{{#year}}` block handles this)
- data.json updated with correct years for all existing artworks

---

## Blocked — Content Dependencies

### B1 — Additional Photos for Etsy Artworks

The following artworks need interior shots and without-frame photos. These cannot be added until Polina downloads the images from her Etsy listings manually.

| Artwork | Missing |
|---|---|
| Pastel "Elegance in Roses" | Interior + without-frame (3 photos) |
| Pastel "Lilacs in Bloom" | Interior + without-frame |
| Pastel "Forget-Me-Nots in Glass" | Interior + without-frame |
| Pastel "Hortensien" | Interior + without-frame |
| Pastel "Blossoms in a Blue Pot" | Interior + without-frame |

**Action required:** Polina downloads the images from Etsy → drops them in `src/img/gallery/` → update `data.json` `detail_images[]` arrays for each artwork → rebuild.

---

## Implementation Order (Recommended)

| # | Item | Impact | Effort | Prerequisite |
|---|---|---|---|---|
| 1 | H2 — Inquire button in popup | High | Low | None |
| 2 | M3 — Artwork year in data.json | Medium | Low | None |
| 3 | M2 — Commission section | Medium | Low | Copy from Polina |
| 4 | H1 — Sticky navigation | High | Medium | None |
| 5 | H3 — Gallery filtering | High | Medium | None |
| 6 | M1 — Exhibition/CV section | Medium | Medium | Data from Polina |
| 7 | B1 — Etsy photos | High | Low (dev) | Photos from Polina |
