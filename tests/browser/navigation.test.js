'use strict';
// SPEC browser 12.3 (navigation), 12.4 (artwork gallery and its full-screen view) and 12.6 (hero video facade),
// behaviour from SPEC 9.
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

describe('browser 4b: full-screen view of the artwork images (the old popup zoom)', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  const zoomState = (page) => page.evaluate(() => {
    const d = document.getElementById('artwork-zoom');
    const img = d && d.querySelector('.zoom__stage img');
    const visible = [...document.querySelectorAll('.artwork__main picture')].findIndex((p) => !p.hidden);
    return {
      open: Boolean(d && d.open),
      alt: img ? img.alt : null,
      width: img ? Number((/-(\d+)\.(?:webp|jpg)$/.exec(img.currentSrc) || [0, 0])[1]) : 0, // the variant (naturalWidth is in CSS px)
      prevHidden: d && d.querySelector('.zoom__prev') ? d.querySelector('.zoom__prev').hidden : null,
      visible,
      focus: document.activeElement ? document.activeElement.className : '',
      scrollLocked: document.documentElement.classList.contains('zoom-open'),
    };
  });
  /** The focused element (id, else first class) and whether it shows a focus ring (:focus-visible with an outline). */
  const focusRing = (page) => page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return { focus: '', ring: false };
    const st = getComputedStyle(a);
    return { focus: a.id || String(a.className).split(' ')[0], ring: a.matches(':focus-visible') && st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0 };
  });

  for (const vp of B.VIEWPORT_NAMES) {
    test(`${vp} ${GALLERY_PATH}: a ${vp === 'mobile' ? 'tap' : 'click'} on the main image opens it full screen (the large variant); arrows and keys switch; Escape closes and the page shows the image viewed last`, { timeout: 60000 }, async () => {
      const { ctx, page, rec } = await open(env, vp, GALLERY_PATH);
      try {
        const box = await page.locator('.artwork__main').boundingBox();
        const x = box.x + box.width / 2;
        const y = box.y + box.height * 0.3; // above the prev/next buttons
        if (vp === 'mobile') await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
        await page.locator('#artwork-zoom .zoom__stage img').waitFor({ state: 'visible', timeout: 5000 });
        await page.waitForFunction(() => { const i = document.querySelector('#artwork-zoom .zoom__stage img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
        let s = await zoomState(page);
        const problems = [];
        const imgs = GALLERY.artwork.images;
        if (!s.open) problems.push('the dialog did not open');
        if (s.alt !== imgs[0].alt) problems.push(`full-screen image alt ${JSON.stringify(s.alt)}, expected the first image`);
        if (s.width < 1200) problems.push(`the full-screen view shows the ${s.width} px variant (the 1200/1920 px variant expected)`);
        if (s.prevHidden !== true) problems.push('"previous" is shown on the first image');
        if (!s.scrollLocked) problems.push('the page behind can still scroll (html.zoom-open missing)');
        // the dialog itself has the focus: browsing with the arrow keys after a mouse or touch open draws no focus
        // ring (showModal() alone focuses the cross, which then shows its ring on the first key press)
        let f = await focusRing(page);
        if (f.focus !== 'artwork-zoom') problems.push(`after opening, the focus is on "${f.focus}", expected the dialog`);
        await page.keyboard.press('ArrowRight');
        s = await zoomState(page);
        if (s.alt !== imgs[1].alt) problems.push(`after ArrowRight the alt is ${JSON.stringify(s.alt)}, expected image 2`);
        f = await focusRing(page);
        if (f.ring) problems.push(`after ArrowRight a focus ring is drawn on "${f.focus}"`);
        await page.keyboard.press('Tab');
        f = await focusRing(page);
        if (f.focus !== 'zoom__close' || !f.ring) problems.push(`Tab should move the focus to the cross with a visible ring, got "${f.focus}" (ring ${f.ring})`);
        await page.locator('#artwork-zoom .zoom__next').click();
        s = await zoomState(page);
        if (s.alt !== imgs[2].alt) problems.push(`after the next button the alt is ${JSON.stringify(s.alt)}, expected image 3`);
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        s = await zoomState(page);
        if (s.open) problems.push('Escape did not close the dialog');
        if (s.visible !== 1) problems.push(`after closing, the page shows image ${s.visible + 1}, expected image 2 (the one viewed last)`);
        if (!/artwork__zoom/.test(s.focus)) problems.push(`focus after closing is on "${s.focus}", expected the image (button.artwork__zoom)`);
        if (s.scrollLocked) problems.push('html.zoom-open is left after closing');
        problems.push(...rec.pageErrors, ...rec.consoleErrors);
        expectNone(problems, `full-screen view at ${vp}`);
      } finally { await ctx.close(); }
    });
  }

  test('mobile: a swipe in the full-screen view shows the next image; the cross closes it; a single-image artwork opens without arrows', { timeout: 60000 }, async () => {
    const { ctx, page } = await open(env, 'mobile', GALLERY_PATH);
    try {
      await page.locator('button.artwork__zoom').tap();
      await page.locator('#artwork-zoom .zoom__stage img').waitFor({ state: 'visible', timeout: 5000 });
      await swipe(page, '#artwork-zoom .zoom__stage', -200);
      await page.waitForTimeout(200);
      let s = await zoomState(page);
      assert.equal(s.alt, GALLERY.artwork.images[1].alt, 'a left swipe in the full-screen view should show image 2');
      await page.locator('#artwork-zoom .zoom__close').tap();
      await page.waitForTimeout(200);
      s = await zoomState(page);
      assert.equal(s.open, false, 'the cross did not close the dialog');
      const single = S.allArtworks(data).find((x) => x.artwork.images.length === 1);
      await B.gotoPage(page, env.url(S.artworkPath(single.hub, single.artwork)));
      await page.locator('button.artwork__zoom').tap();
      await page.locator('#artwork-zoom .zoom__stage img').waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await page.locator('#artwork-zoom .zoom__prev, #artwork-zoom .zoom__next').count(), 0, 'a single image needs no arrows');
    } finally { await ctx.close(); }
  });
});

/* A stand-in for the youtube-nocookie.com player: it answers "listening" with the playing state (as the IFrame
   API does) and reports the commands it gets back to the page. */
const PLAYER_STUB = `<!doctype html><html lang="en"><title>player</title><script>
window.addEventListener('message', function (e) {
  var d; try { d = JSON.parse(e.data); } catch (err) { return; }
  if (d.event === 'listening') {
    parent.postMessage(JSON.stringify({ event: 'onReady', info: null, id: 1, channel: 'widget' }), '*');
    parent.postMessage(JSON.stringify({ event: 'onStateChange', info: 1, id: 1, channel: 'widget' }), '*');
  }
  if (d.event === 'command') parent.postMessage(JSON.stringify({ event: 'stubCommand', func: d.func }), '*');
});
</script></html>`;

/* A player that answers "listening" with an error (a removed or not embeddable video). */
const PLAYER_ERROR_STUB = `<!doctype html><html lang="en"><title>player</title><script>
window.addEventListener('message', function (e) {
  var d; try { d = JSON.parse(e.data); } catch (err) { return; }
  if (d.event === 'listening') parent.postMessage(JSON.stringify({ event: 'onError', info: 150, id: 1, channel: 'widget' }), '*');
});
</script></html>`;

describe('browser 6: hero video facade', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  const heroState = (page) => page.evaluate(() => {
    const frame = document.querySelector('iframe.hero__video');
    const poster = document.querySelector('.hero__poster img');
    const button = document.querySelector('.hero__play');
    return {
      frame: Boolean(frame),
      frameOpacity: frame ? Number(getComputedStyle(frame).opacity) : null,
      posterShown: Boolean(poster && poster.getClientRects().length),
      label: button ? button.getAttribute('aria-label') : null,
    };
  });

  for (const vp of B.VIEWPORT_NAMES) {
    test(`${vp}: no YouTube request on load; the play button inserts the youtube-nocookie.com player (autoplay, muted, loop, no controls); while the player does not play (here: blocked) the poster stays, and the button stops it again`, { timeout: 60000 }, async () => {
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
        const want = { autoplay: '1', mute: '1', loop: '1', playlist: YT, controls: '0', playsinline: '1', rel: '0', enablejsapi: '1' };
        for (const [k, v] of Object.entries(want)) if (u.searchParams.get(k) !== v) problems.push(`iframe ${k}=${u.searchParams.get(k)}, expected ${v}`);
        if (!title || !title.trim()) problems.push('iframe has no title');
        const events = B.findEvents(await B.readDataLayer(page), 'hero_video_play');
        if (events.length !== 1) problems.push(`hero_video_play events: ${events.length}`);
        await page.waitForTimeout(1200);
        let s = await heroState(page);
        if (!s.posterShown) problems.push('the poster is gone although the player never played (a blocked player must leave the poster)');
        if (s.frameOpacity !== 0) problems.push(`the player that never played is visible (opacity ${s.frameOpacity})`);
        if (s.label !== 'Pause the video') problems.push(`after the click the button reads ${JSON.stringify(s.label)}, expected "Pause the video"`);
        await B.clickOn(page, 'button.hero__play', 'hero pause button');
        s = await heroState(page);
        if (s.frame) problems.push('the button did not stop the video that had not started');
        if (s.label !== 'Play the video' || !s.posterShown) problems.push(`after stopping: ${JSON.stringify(s)}`);
        expectNone(problems, 'hero video problems');
      } finally { await ctx.close(); }
    });
  }

  test('desktop: a player that never answers (blocked) is removed after about 10 s: the button reads "Play the video" again over the poster, nothing is sent to it any more, and Play starts it again', { timeout: 60000 }, async () => {
    const { ctx, page } = await open(env, 'desktop', '/');
    try {
      const messages = []; // Chromium warns for every message posted to the blocked frame (its error page)
      page.on('console', (m) => { if (/postMessage/.test(m.text())) messages.push(m.text()); });
      await B.clickOn(page, 'button.hero__play', 'hero play button');
      const clicked = Date.now();
      await page.locator('iframe.hero__video').waitFor({ state: 'attached', timeout: 5000 });
      const gone = await page.waitForFunction(() => !document.querySelector('iframe.hero__video'), null, { timeout: 20000 }).then(() => true, () => false);
      if (!gone) assert.fail(`the player that never answered is still there 20 s after the click; the button reads ${JSON.stringify((await heroState(page)).label)}`);
      const waited = Date.now() - clicked;
      const s = await heroState(page);
      const sent = messages.length;
      await page.waitForTimeout(1000);
      const problems = [];
      if (waited < 8000) problems.push(`the player was removed after ${waited} ms (it must get about 10 s to answer)`);
      if (s.label !== 'Play the video') problems.push(`after the player gave up the button reads ${JSON.stringify(s.label)}`);
      if (!s.posterShown) problems.push('the poster is gone');
      if (messages.length !== sent) problems.push(`${messages.length - sent} messages were posted after the player was removed`);
      await B.clickOn(page, 'button.hero__play', 'hero play button, second time');
      const again = await heroState(page);
      if (!again.frame || again.label !== 'Pause the video') problems.push(`a second click does not start the player again: ${JSON.stringify(again)}`);
      expectNone(problems, 'blocked hero player');
    } finally { await ctx.close(); }
  });

  test('desktop: a player page that never loads (a firewall that drops the packets: no load event, no answer) is removed after about 20 s; the button reads "Play the video" again over the poster', { timeout: 90000 }, async () => {
    const ctx = await B.newContext(env, 'desktop', { consent: 'denied' });
    const hung = [];
    try {
      await ctx.route(/^https:\/\/www\.youtube-nocookie\.com\//, (r) => { hung.push(r); }); // never answered
      const page = await ctx.newPage();
      await B.gotoPage(page, env.url('/'));
      await B.clickOn(page, 'button.hero__play', 'hero play button');
      const clicked = Date.now();
      await page.locator('iframe.hero__video').waitFor({ state: 'attached', timeout: 5000 });
      const gone = await page.waitForFunction(() => !document.querySelector('iframe.hero__video'), null, { timeout: 35000 }).then(() => true, () => false);
      const waited = Date.now() - clicked;
      const s = await heroState(page);
      const problems = [];
      if (!hung.length) problems.push('the player was never requested');
      if (!gone) problems.push(`the player whose page never loaded is still there 35 s after the click; the button reads ${JSON.stringify(s.label)}`);
      else {
        if (waited < 15000) problems.push(`the player was removed after ${waited} ms (a page that is still loading must get about 20 s)`);
        if (s.label !== 'Play the video') problems.push(`after the player was removed the button reads ${JSON.stringify(s.label)}`);
        if (!s.posterShown) problems.push('the poster is gone');
      }
      expectNone(problems, 'hero player without an answer from the network');
    } finally {
      for (const r of hung) await r.abort().catch(() => {});
      await ctx.close();
    }
  });

  test('desktop: on a connection the browser reports as 2G (Chromium reports "Slow 3G" so) a player page that is still loading gets 60 s, not 20 s, before it is removed', { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'desktop', { consent: 'denied' });
    const hung = [];
    try {
      await ctx.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'connection', { configurable: true, get: () => ({ effectiveType: '2g' }) });
      });
      await ctx.route(/^https:\/\/www\.youtube-nocookie\.com\//, (r) => { hung.push(r); }); // still loading
      const page = await ctx.newPage();
      await page.clock.install(); // fake timers that still run; fastForward() jumps over the waits
      await B.gotoPage(page, env.url('/'));
      await B.clickOn(page, 'button.hero__play', 'hero play button');
      await page.locator('iframe.hero__video').waitFor({ state: 'attached', timeout: 5000 });
      await page.clock.fastForward(30000);
      const at30 = await heroState(page);
      await page.clock.fastForward(31000);
      const at61 = await heroState(page);
      const problems = [];
      if (!hung.length) problems.push('the player was never requested');
      if (!at30.frame) problems.push('on a 2G connection the loading player was removed before 30 s');
      if (at30.frame && at30.label !== 'Pause the video') problems.push(`at 30 s the button reads ${JSON.stringify(at30.label)}`);
      if (at61.frame) problems.push('on a 2G connection the loading player is still there after 61 s');
      if (at61.label !== 'Play the video' || !at61.posterShown) problems.push(`after 61 s: ${JSON.stringify(at61)}`);
      expectNone(problems, 'hero player on a slow connection');
    } finally {
      for (const r of hung) await r.abort().catch(() => {});
      await ctx.close();
    }
  });

  test('desktop: a player that reports an error is removed at once and the button reads "Play the video"', { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'desktop', { consent: 'denied' });
    try {
      await ctx.route(/^https:\/\/www\.youtube-nocookie\.com\/embed\//, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PLAYER_ERROR_STUB }));
      const page = await ctx.newPage();
      await B.gotoPage(page, env.url('/'));
      await B.clickOn(page, 'button.hero__play', 'hero play button');
      await page.waitForFunction(() => !document.querySelector('iframe.hero__video'), null, { timeout: 5000 }).catch(() => {});
      const s = await heroState(page);
      expectNone([
        ...(s.frame ? ['the player that reported an error is still there'] : []),
        ...(s.label !== 'Play the video' ? [`the button reads ${JSON.stringify(s.label)}`] : []),
        ...(!s.posterShown ? ['the poster is gone'] : []),
      ], 'hero player error');
    } finally { await ctx.close(); }
  });

  test('desktop: once the player reports that it plays, the video shows over the poster; the button pauses and resumes it (pauseVideo / playVideo)', { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'desktop', { consent: 'denied' });
    try {
      await ctx.route(/^https:\/\/www\.youtube-nocookie\.com\/embed\//, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PLAYER_STUB }));
      await ctx.addInitScript(() => {
        window.__playerMessages = [];
        window.addEventListener('message', (e) => { if (e.origin === 'https://www.youtube-nocookie.com') window.__playerMessages.push(String(e.data)); });
      });
      const page = await ctx.newPage();
      await B.gotoPage(page, env.url('/'));
      await B.clickOn(page, 'button.hero__play', 'hero play button');
      await page.waitForFunction(() => document.querySelector('.hero__media').classList.contains('hero__media--playing'), null, { timeout: 10000 });
      await page.waitForTimeout(800); // the fade-in
      let s = await heroState(page);
      const problems = [];
      if (s.frameOpacity !== 1) problems.push(`the playing video has opacity ${s.frameOpacity}`);
      if (s.label !== 'Pause the video') problems.push(`while playing the button reads ${JSON.stringify(s.label)}`);
      await B.clickOn(page, 'button.hero__play', 'pause');
      await page.waitForTimeout(300);
      s = await heroState(page);
      if (s.label !== 'Play the video') problems.push(`after pausing the button reads ${JSON.stringify(s.label)}`);
      await B.clickOn(page, 'button.hero__play', 'play');
      await page.waitForTimeout(300);
      const commands = (await page.evaluate(() => window.__playerMessages)).map((m) => { try { return JSON.parse(m); } catch (e) { return {}; } }).filter((m) => m.event === 'stubCommand').map((m) => m.func);
      if (commands.join(',') !== 'pauseVideo,playVideo') problems.push(`the player got the commands [${commands.join(', ')}], expected [pauseVideo, playVideo]`);
      if (!(await heroState(page)).frame) problems.push('the player was removed');
      expectNone(problems, 'hero video controls');
    } finally { await ctx.close(); }
  });
});
