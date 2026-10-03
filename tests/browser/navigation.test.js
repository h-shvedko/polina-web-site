'use strict';
// SPEC browser 12.3 (navigation), 12.4 (artwork gallery) and 12.6 (hero video facade), behaviour from SPEC 9.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');
const B = require('../lib/browser');

const data = S.loadData();
const HUB = data.hubs[0];
const FIRST = HUB.artworks[0];
const SECOND = HUB.artworks[1];
const THIRD = HUB.artworks[2];
const GALLERY = B.galleryArtwork(data);
const GALLERY_PATH = S.artworkPath(GALLERY.hub, GALLERY.artwork);
const NAV_TARGETS = [...data.hubs.map((h) => `/${h.path}/`), '/about/', '/contact/'];
const YT = data.site.youtube_id;

async function open(env, vp, p, opts = { consent: 'denied' }) {
  const ctx = await B.newContext(env, vp, opts);
  const page = await ctx.newPage();
  const rec = B.trackPage(page, env);
  const resp = await B.gotoPage(page, env.url(p));
  assert.equal(resp && resp.status(), 200, `HTTP ${resp && resp.status()} for ${p}`);
  return { ctx, page, rec };
}

async function clickAndWaitUrl(page, locator, wantUrl, what) {
  assert.ok(await locator.count() > 0, `${what}: element not found`);
  await Promise.all([
    page.waitForURL(wantUrl, { timeout: 15000 }).catch(() => {}),
    locator.first().click({ timeout: 10000 }),
  ]);
  assert.equal(page.url(), wantUrl, `${what}: expected to land on ${wantUrl}`);
}

/** Indices of the visible pictures in .artwork__main and the aria-current state of the thumbnails. */
async function galleryState(page) {
  return page.evaluate(() => {
    const pics = [...document.querySelectorAll('.artwork__main picture')];
    const visible = pics.map((p, i) => {
      const r = p.getBoundingClientRect();
      const st = getComputedStyle(p);
      return !p.hidden && st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0 ? i : -1;
    }).filter((i) => i >= 0);
    const current = [...document.querySelectorAll('button.artwork__thumb')].map((b, i) => (b.getAttribute('aria-current') === 'true' ? i : -1)).filter((i) => i >= 0);
    return { count: pics.length, visible, current };
  });
}

async function expectGallery(page, index, what) {
  let state;
  for (let k = 0; k < 20; k++) {
    state = await galleryState(page);
    if (state.visible.length === 1 && state.visible[0] === index && state.current.length === 1 && state.current[0] === index) return;
    await page.waitForTimeout(100);
  }
  assert.fail(`${what}: expected picture ${index} visible and thumbnail ${index} aria-current="true", got visible ${JSON.stringify(state.visible)}, aria-current ${JSON.stringify(state.current)} (of ${state.count})`);
}

async function swipe(page, selector, dx) {
  const box = await page.locator(selector).first().boundingBox();
  assert.ok(box, `${selector} has no box`);
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width / 2 + (dx < 0 ? box.width / 4 : -box.width / 4);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let k = 1; k <= 6; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * k) / 6, y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

describe('browser 3: navigation', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const vp of B.VIEWPORT_NAMES) {
    test(`${vp}: a home card click opens the artwork page`, { timeout: 60000 }, async () => {
      const { ctx, page } = await open(env, vp, '/');
      try {
        await clickAndWaitUrl(page, page.locator(`#gallery-${HUB.key} a.card__link`), env.url(S.artworkPath(HUB, FIRST)), 'first oil card');
      } finally { await ctx.close(); }
    });

    test(`${vp}: the breadcrumb leads from an artwork to its hub; pager prev/next go to the neighbours`, { timeout: 60000 }, async () => {
      const { ctx, page } = await open(env, vp, S.artworkPath(HUB, SECOND));
      try {
        await clickAndWaitUrl(page, page.locator(`nav.breadcrumb a[href="/${HUB.path}/"]`), env.url(`/${HUB.path}/`), 'breadcrumb hub link');
        await B.gotoPage(page, env.url(S.artworkPath(HUB, SECOND)));
        await clickAndWaitUrl(page, page.locator('a[rel~="next"]'), env.url(S.artworkPath(HUB, THIRD)), 'pager next');
        await B.gotoPage(page, env.url(S.artworkPath(HUB, SECOND)));
        await clickAndWaitUrl(page, page.locator('a[rel~="prev"]'), env.url(S.artworkPath(HUB, FIRST)), 'pager prev');
      } finally { await ctx.close(); }
    });

    test(`${vp}: the nav links reach every hub, /about/ and /contact/ (HTTP 200)`, { timeout: 90000 }, async () => {
      const { ctx, page } = await open(env, vp, '/about/');
      try {
        const problems = [];
        for (const target of NAV_TARGETS) {
          await B.gotoPage(page, env.url('/about/'), { idle: false });
          const link = page.locator(`#site-nav .site-nav__links a[href="${target}"]`);
          if (!(await link.count())) { problems.push(`no nav link to ${target}`); continue; }
          const [resp] = await Promise.all([
            page.waitForResponse((r) => r.request().isNavigationRequest() && r.url() === env.url(target), { timeout: 15000 }).catch(() => null),
            link.first().click({ timeout: 10000 }).catch((e) => problems.push(`cannot click nav link ${target}: ${e.message.split('\n')[0]}`)),
          ]);
          if (!resp) problems.push(`clicking the nav link ${target} did not navigate there`);
          else if (resp.status() !== 200) problems.push(`${target} answered HTTP ${resp.status()}`);
        }
        expectNone(problems, 'nav link problems');
      } finally { await ctx.close(); }
    });

    test(`${vp}: home: the sticky nav is hidden over the hero, appears after scrolling past it and hides again at the top`, { timeout: 60000 }, async () => {
      const { ctx, page } = await open(env, vp, '/');
      try {
        const navState = () => page.evaluate(() => {
          const n = document.getElementById('site-nav');
          if (!n) return null;
          const r = n.getBoundingClientRect();
          const st = getComputedStyle(n);
          const shown = r.bottom > 1 && r.top < window.innerHeight && st.visibility !== 'hidden' && st.display !== 'none' && parseFloat(st.opacity) > 0.1;
          return { shown, visibleClass: n.classList.contains('site-nav--visible'), top: Math.round(r.top), bottom: Math.round(r.bottom) };
        });
        const waitFor = async (want) => {
          let s = null;
          for (let k = 0; k < 30; k++) {
            s = await navState();
            if (!s || (s.shown === want && s.visibleClass === want)) return s;
            await page.waitForTimeout(100);
          }
          return s;
        };
        let s = await waitFor(false);
        assert.ok(s, '#site-nav not found');
        assert.ok(!s.shown && !s.visibleClass, `over the hero the nav must be hidden (no site-nav--visible): ${JSON.stringify(s)}`);
        await page.evaluate((id) => { const g = document.getElementById(id); window.scrollTo(0, g ? g.getBoundingClientRect().top + window.scrollY : window.innerHeight * 2); }, `gallery-${HUB.key}`);
        s = await waitFor(true);
        assert.ok(s.shown && s.visibleClass, `after scrolling past the hero the nav must be visible with site-nav--visible: ${JSON.stringify(s)}`);
        await page.evaluate(() => window.scrollTo(0, 0));
        s = await waitFor(false);
        assert.ok(!s.shown && !s.visibleClass, `back at the top the nav must be hidden again: ${JSON.stringify(s)}`);
      } finally { await ctx.close(); }
    });

    test(`${vp}: the hero "Explore Artworks" button scrolls to #gallery-${HUB.key}`, { timeout: 60000 }, async () => {
      const { ctx, page } = await open(env, vp, '/');
      try {
        const cta = page.locator('a.hero__cta');
        assert.ok(await cta.count(), 'a.hero__cta not found');
        await cta.first().click({ timeout: 10000 });
        let top = null;
        for (let k = 0; k < 40; k++) {
          await page.waitForTimeout(100);
          top = await page.evaluate((id) => { const el = document.getElementById(id); return el ? el.getBoundingClientRect().top : null; }, `gallery-${HUB.key}`);
          if (top !== null && top > -10 && top < 200) break;
        }
        assert.ok(top !== null, `#gallery-${HUB.key} not found`);
        assert.ok(top > -10 && top < 200, `#gallery-${HUB.key} top is at ${Math.round(top)} px after the click (expected near the top of the viewport, below the sticky nav)`);
      } finally { await ctx.close(); }
    });
  }
});

describe('browser 4: artwork image gallery', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const vp of B.VIEWPORT_NAMES) {
    test(`${vp} ${GALLERY_PATH} (${GALLERY.artwork.images.length} images): thumbnails, prev/next buttons and arrow keys switch the visible image and aria-current`, { timeout: 60000 }, async () => {
      const { ctx, page, rec } = await open(env, vp, GALLERY_PATH);
      try {
        const state = await galleryState(page);
        assert.equal(state.count, GALLERY.artwork.images.length, `.artwork__main has ${state.count} pictures`);
        await expectGallery(page, 0, 'initial state');
        await B.clickOn(page, 'button.artwork__thumb >> nth=2', 'thumbnail 3');
        await expectGallery(page, 2, 'after clicking thumbnail 3');
        await page.keyboard.press('ArrowRight');
        await expectGallery(page, 3, 'after ArrowRight');
        await page.keyboard.press('ArrowLeft');
        await expectGallery(page, 2, 'after ArrowLeft');
        await B.clickOn(page, 'button.artwork__next', 'next button');
        await expectGallery(page, 3, 'after button.artwork__next');
        await B.clickOn(page, 'button.artwork__prev', 'previous button');
        await expectGallery(page, 2, 'after button.artwork__prev');
        await page.locator('button.artwork__thumb').nth(0).focus();
        await page.keyboard.press('Enter');
        await expectGallery(page, 0, 'after Enter on thumbnail 1 (keyboard)');
        expectNone([...rec.pageErrors, ...rec.consoleErrors], 'errors while switching images');
      } finally { await ctx.close(); }
    });
  }

  test(`mobile ${GALLERY_PATH}: a horizontal swipe on the main image shows the next and previous image`, { timeout: 60000 }, async () => {
    const { ctx, page } = await open(env, 'mobile', GALLERY_PATH);
    try {
      await expectGallery(page, 0, 'initial state');
      await swipe(page, '.artwork__main', -200);
      await expectGallery(page, 1, 'after swiping left');
      await swipe(page, '.artwork__main', 200);
      await expectGallery(page, 0, 'after swiping right');
    } finally { await ctx.close(); }
  });
});

describe('browser 6: hero video facade', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const vp of B.VIEWPORT_NAMES) {
    test(`${vp}: no YouTube request on load; clicking .hero__play inserts a youtube-nocookie.com iframe (autoplay, muted, loop, no controls) and tracks hero_video_play`, { timeout: 60000 }, async () => {
      const { ctx, page, rec } = await open(env, vp, '/', { consent: 'granted' });
      try {
        expectNone(rec.youtube().map((r) => r.url), 'YouTube requests before the click');
        assert.equal(await page.locator('iframe').count(), 0, 'an iframe exists before the click');
        await B.clickOn(page, 'button.hero__play', 'hero play button');
        const frame = page.locator('iframe[src*="youtube-nocookie.com/embed/"]');
        await frame.first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
        assert.equal(await frame.count(), 1, 'no youtube-nocookie.com iframe after the click');
        const src = await frame.first().getAttribute('src');
        const title = await frame.first().getAttribute('title');
        const u = new URL(src, 'https://x');
        const problems = [];
        if (u.host !== 'www.youtube-nocookie.com') problems.push(`iframe host ${u.host}`);
        if (u.pathname !== `/embed/${YT}`) problems.push(`iframe path ${u.pathname}, expected /embed/${YT}`);
        const want = { autoplay: '1', mute: '1', loop: '1', playlist: YT, controls: '0', playsinline: '1', rel: '0' };
        for (const [k, v] of Object.entries(want)) if (u.searchParams.get(k) !== v) problems.push(`iframe ${k}=${u.searchParams.get(k)}, expected ${v}`);
        if (!title || !title.trim()) problems.push('iframe has no title');
        const events = B.findEvents(await B.readDataLayer(page), 'hero_video_play');
        if (events.length !== 1) problems.push(`hero_video_play events: ${events.length}`);
        expectNone(problems, 'hero video problems');
      } finally { await ctx.close(); }
    });
  }
});
