# ADR-0000: Architecture Decision Record Index

**Project:** Polina Shvedko Artist Website (`polina-shvedko.art`)
**Maintained by:** Hennadii Shvedko

This file is the canonical index of all ADRs for this project.
Each ADR documents a significant decision, analysis, or implementation plan.

---

## Status Key

| Status | Meaning |
|---|---|
| **Active** | Decision is current and in effect |
| **Implemented** | Fully built and deployed |
| **Partially Implemented** | Some items done, remainder tracked as open |
| **Superseded** | Replaced by a later ADR (link provided) |
| **Proposed** | Under discussion, not yet committed |

---

## ADR Registry

| ADR | Title | Status | Date | Summary |
|---|---|---|---|---|
| [ADR-0001](ADR0001-ga4-analysis-and-recommendations.md) | GA4 Analytics Analysis & Growth Recommendations | Partially Implemented | 2026-04-15 | 90-day GA4 analysis; 7 prioritised actions; CI/CD FTP deploy workflow |
| [ADR-0002](ADR0002-ux-feature-backlog.md) | UX & Feature Backlog — Open TODO Items | Active | 2026-04-15 | Sticky nav, popup inquire button, gallery filtering, commission section, CV section, artwork years |

---

## ADR-0001 — Implementation Tracker

| Item | Status |
|---|---|
| 1.1 Track `contact_click` GA4 event | **Done** — `src/js/analytics.js` |
| 1.2 Track `artwork_view` on popup open | **Done** — `src/js/analytics.js` |
| 1.3 Track cart interactions (`cart_order`, `purchase_inquiry`) | **Done** — `src/js/analytics.js` |
| 2 — Instagram UTM tagging for bio link | **Open** — manual step for Polina |
| 3 — Mobile hero background fix | **Done** — `header.html` CSS media query, replaced missing image refs |
| 4.1 JSON-LD VisualArtwork structured data | **Done** — `src/templates/partials/structured_data.html` |
| 4.2 Descriptive `<title>` and `<meta description>` | **Done** — `src/templates/partials/head.html` |
| 4.3 Blog / "About the artwork" article | **Open** — content needed from Polina |
| 5.1 Newsletter signup | **Open** |
| 5.2 Instagram embed / feed widget | **Open** |
| 6 — Suppress bot traffic in GA4 (Columbus/Prineville) | **Open** — manual GA4 admin step |
| Mark `contact_click` as Key Event in GA4 Admin | **Open** — manual GA4 admin step |
| GitHub Actions CI/CD deploy workflow | **Done** — `.github/workflows/deploy.yml` (SFTP via lftp) |

---

## ADR-0002 — Implementation Tracker

| Item | Status |
|---|---|
| H1 — Sticky navigation menu | **Open** |
| H2 — Inquire/Add to Cart button in artwork popup | **Open** |
| H3 — Gallery filtering (Available / Sold / All) | **Open** |
| M1 — Exhibition / CV section | **Open** — content needed from Polina |
| M2 — Commission request section | **Open** — copy needed from Polina |
| M3 — Artwork creation year in data.json | **Open** |
| B1 — Additional Etsy photos for 5 pastel artworks | **Blocked** — photos needed from Polina |

---

## Adding a New ADR

1. Name the file `ADR{NNNN}-short-title.md` (zero-padded, e.g. `ADR0003-...`)
2. Use the frontmatter: `Date`, `Status`
3. Add a row to the registry table above
4. Add an implementation tracker section above if the ADR has actionable items
