'use strict';
// Responsive images from the review rounds: every image cropped with object-fit: cover (the hero poster, cards,
// Instagram tiles, artwork thumbnails) gets the variant that fits the size it is drawn at (not upscaled like the
// old box-width `sizes` did, not far too large like 600 px files in 40 px thumbnails), and touch screens never
// download the card hover images they cannot show. The hero poster is a 16:9 frame in a hero at least as tall as
// the window: on a portrait phone it is drawn about four times wider than the window.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');
const B = require('../lib/browser');

const data = S.loadData();
const GALLERY = B.galleryArtwork(data);
const WIDE = S.allArtworks(data).find((x) => x.artwork.card === 'wide');
const CONTEXTS = {
  'desktop DPR 1': { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 },
  'desktop DPR 2': { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 2 },
  'tablet DPR 2': { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'phone DPR 2': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'phone DPR 3': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

async function context(env, name) {
  const ctx = await env.browser.newContext({ ...CONTEXTS[name], reducedMotion: 'reduce' });
  await ctx.route((url) => !env.isLocal(url.href) && !/^(data|blob):/.test(url.href), (r) => r.abort('blockedbyclient'));
  await ctx.addInitScript(() => { try { localStorage.setItem('cookie_consent_v2', 'denied'); } catch (e) { /* */ } });
  return ctx;
}

/** Scroll through the page so the lazy images in view load, then wait for them. */
async function loadAll(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.floor(innerHeight * 0.7)) { window.scrollTo(0, y); await sleep(60); }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(300);
    const imgs = [...document.images].filter((i) => i.getClientRects().length > 0);
    await Promise.race([Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); })))), sleep(15000)]);
  });
}

/**
 * Runs in the page: every rendered object-fit: cover image of the given selector, with the width it is drawn at
 * (device pixels), its srcset widths and the width of the file the browser chose.
 */
function coverImages(selector) {
  const dpr = window.devicePixelRatio;
  return [...document.querySelectorAll(selector)].filter((img) => img.getClientRects().length > 0 && img.complete && img.naturalWidth > 0).map((img) => {
    const box = img.getBoundingClientRect();
    const ratio = img.naturalWidth / img.naturalHeight;
    const drawn = Math.max(box.width, box.height * ratio); // object-fit: cover
    const source = img.parentElement.querySelector('source[type="image/webp"]');
    const widths = (source ? source.getAttribute('srcset') : img.getAttribute('srcset')).split(',').map((s) => Number(/(\d+)w\s*$/.exec(s.trim())[1])).sort((a, b) => a - b);
    const chosen = Number((/-(\d+)\.(?:webp|jpg)$/.exec(img.currentSrc) || [])[1]);
    return { file: img.currentSrc.split('/').pop(), need: drawn * dpr, chosen, widths };
  });
}

/** The variant the browser should take: the smallest at least as wide as needed, else the largest. */
function verdict(i) {
  const fit = i.widths.find((w) => w >= i.need * 0.97);
  const ideal = fit || i.widths[i.widths.length - 1];
  const next = i.widths[i.widths.indexOf(ideal) + 1];
  const ok = i.chosen === ideal || (next && i.chosen === next && i.need > ideal * 0.9); // rounding at a boundary
  return ok ? null : `${i.file}: drawn at ${Math.round(i.need)} device px, srcset ${i.widths.join('/')}, the browser took ${i.chosen} (expected ${ideal})`;
}

describe('images: object-fit cover images get the variant of their drawn size', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const name of Object.keys(CONTEXTS)) {
    test(`${name}: the home hero poster, cards (with the hover images a mouse can show) and Instagram tiles, the ${WIDE.hub.path} hub and the thumbnails of ${GALLERY.artwork.slug}`, { timeout: 180000 }, async () => {
      const ctx = await context(env, name);
      try {
        const page = await ctx.newPage();
        const problems = [];
        for (const [p, selector] of [
          ['/', '.hero__poster img, .card__img img, .instagram__img img'],
          [`/${WIDE.hub.path}/`, '.card__img img'],
          [S.artworkPath(GALLERY.hub, GALLERY.artwork), '.artwork__thumb-img img'],
        ]) {
          await B.gotoPage(page, env.url(p), { idle: false });
          await loadAll(page);
          const list = await page.evaluate(coverImages, selector);
          if (!list.length) problems.push(`${p}: no loaded image matches ${selector}`);
          const blank = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((img) => img.getClientRects().length > 0 && !(img.complete && img.naturalWidth > 0)).map((img) => img.getAttribute('src')), selector);
          problems.push(...blank.map((src) => `${p}: a shown image did not load: ${src}`));
          problems.push(...list.map(verdict).filter(Boolean).map((v) => `${p}: ${v}`));
        }
        expectNone(problems, `image variants at ${name}`);
      } finally {
        await ctx.close();
      }
    });
  }
});

describe('images: touch screens never download the card hover images', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const p of ['/', ...data.hubs.map((h) => `/${h.path}/`)]) {
    test(`phone ${p}: after scrolling the whole page, no file used only by a hover image was requested`, { timeout: 120000 }, async () => {
      const ctx = await context(env, 'phone DPR 3');
      try {
        const page = await ctx.newPage();
        const requested = [];
        page.on('request', (r) => requested.push(B.pathOf(r.url())));
        await B.gotoPage(page, env.url(p), { idle: false });
        await loadAll(page);
        const hoverOnly = await page.evaluate(() => {
          const urls = (sel) => new Set([...document.querySelectorAll(sel)].flatMap((el) => (el.getAttribute('srcset') || el.getAttribute('src') || '').split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)));
          const hover = urls('.card__img--hover source, .card__img--hover img');
          const other = urls('picture:not(.card__img--hover) source, picture:not(.card__img--hover) img');
          return [...hover].filter((u) => !other.has(u));
        });
        assert.ok(hoverOnly.length > 0, 'the page has no hover-only image files (nothing to check)');
        expectNone(requested.filter((u) => hoverOnly.includes(u)), `hover-only files downloaded on a touch screen (${p})`);
      } finally {
        await ctx.close();
      }
    });
  }
});

describe('images: artwork main images (the LCP element) get a file close to their drawn size on phones', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  // Lighthouse's mobile emulation (PageSpeed Insights lab data) and a 2x phone: a full-width image is drawn at
  // 650-750 device px there; without a 900 px variant the browser took the 1200 px file, twice the bytes
  const PHONES = {
    'Lighthouse phone 412x823 DPR 1.75': { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true },
    'phone 390x844 DPR 2': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  };
  for (const [name, opts] of Object.entries(PHONES)) {
    test(`${name}: on every artwork page the main image is the smallest variant that covers its drawn width, at most 1.6x that width`, { timeout: 180000 }, async () => {
      const ctx = await env.browser.newContext({ ...opts, reducedMotion: 'reduce' });
      try {
        await ctx.route((url) => !env.isLocal(url.href) && !/^(data|blob):/.test(url.href), (r) => r.abort('blockedbyclient'));
        await ctx.addInitScript(() => { try { localStorage.setItem('cookie_consent_v2', 'denied'); } catch (e) { /* */ } });
        const page = await ctx.newPage();
        const problems = [];
        for (const { hub, artwork } of S.allArtworks(data)) {
          const p = S.artworkPath(hub, artwork);
          await B.gotoPage(page, env.url(p), { idle: false });
          await page.waitForFunction(() => { const i = document.querySelector('.artwork__main picture:not([hidden]) img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
          const i = await page.evaluate(() => {
            const img = document.querySelector('.artwork__main picture:not([hidden]) img');
            if (!img || !img.naturalWidth) return null;
            const box = img.getBoundingClientRect();
            const drawn = Math.min(box.width, box.height * (img.naturalWidth / img.naturalHeight)); // object-fit: contain
            const source = img.parentElement.querySelector('source[type="image/webp"]');
            const widths = source.getAttribute('srcset').split(',').map((s) => Number(/(\d+)w\s*$/.exec(s.trim())[1])).sort((a, b) => a - b);
            const chosen = Number((/-(\d+)\.(?:webp|jpg)$/.exec(img.currentSrc) || [])[1]);
            return { file: img.currentSrc.split('/').pop(), need: drawn * devicePixelRatio, chosen, widths };
          });
          if (!i) { problems.push(`${p}: the main image did not load`); continue; }
          const v = verdict(i);
          if (v) problems.push(`${p}: ${v}`);
          else if (i.need >= 600 && i.chosen > 1.6 * i.need) problems.push(`${p}: ${i.file} is ${(i.chosen / i.need).toFixed(2)}x the drawn width (${Math.round(i.need)} device px; srcset ${i.widths.join('/')})`);
        }
        expectNone(problems, `artwork main images at ${name}`);
      } finally {
        await ctx.close();
      }
    });
  }
});
