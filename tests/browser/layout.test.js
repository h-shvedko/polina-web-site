'use strict';
// Layout checks from the round-1 review: the open consent banner never hides content or keyboard focus, the
// navigation row on phones, the hero pill and arrow at small and short windows, and the new page elements
// (breadcrumb, pager, headings, 404 links).
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');
const B = require('../lib/browser');

const data = S.loadData();
const HUB = data.hubs[0];
const FIRST = HUB.artworks[0];
const LONG_TITLE = S.allArtworks(data).map((x) => x).sort((a, b) => b.artwork.title.length - a.artwork.title.length)[0];

/** A context for an arbitrary window size (touch and DPR 3 below 700 px wide, as a phone). */
async function sizedContext(env, width, height, opts = {}) {
  const phone = width < 700;
  const ctx = await env.browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: phone ? 3 : 1,
    isMobile: phone,
    hasTouch: phone,
    reducedMotion: 'reduce',
    locale: 'en-US',
  });
  await ctx.route((url) => !env.isLocal(url.href) && !/^(data|blob):/.test(url.href), (r) => r.abort('blockedbyclient'));
  if (opts.consent) await ctx.addInitScript((v) => { try { localStorage.setItem('cookie_consent_v2', v); } catch (e) { /* */ } }, opts.consent);
  return ctx;
}

async function openPage(ctx, env, p) {
  const page = await ctx.newPage();
  const resp = await B.gotoPage(page, env.url(p), { idle: false });
  assert.equal(resp && resp.status(), 200, `HTTP ${resp && resp.status()} for ${p}`);
  await B.fontsReady(page);
  return page;
}

describe('layout: the open consent banner hides neither content nor keyboard focus', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  const PAGES = ['/', `/${HUB.path}/`, S.artworkPath(HUB, FIRST), '/contact/'];
  for (const vp of B.VIEWPORT_NAMES) {
    for (const p of PAGES) {
      test(`${vp} ${p}: with the banner open, no Tab stop is fully under the banner, and the footer links can be scrolled above it`, { timeout: 120000 }, async () => {
        const v = B.VIEWPORTS[vp].viewport;
        const ctx = await sizedContext(env, v.width, v.height);
        try {
          const page = await openPage(ctx, env, p);
          await page.locator('#cookie-consent').waitFor({ state: 'visible', timeout: 5000 });
          const covered = [];
          let stops = 0;
          let accepts = 0;
          for (let k = 0; k < 120; k++) {
            await page.keyboard.press('Tab');
            const r = await page.evaluate(() => {
              const el = document.activeElement;
              const banner = document.getElementById('cookie-consent');
              if (!el || el === document.body) return { done: true };
              if (banner.contains(el)) return { inBanner: true, id: el.id };
              const box = el.getBoundingClientRect();
              if (!box.width || !box.height) return { name: el.className, hidden: true };
              const pts = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];
              const under = pts.filter(([fx, fy]) => {
                const x = box.left + box.width * fx;
                const y = box.top + box.height * fy;
                if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
                const hit = document.elementFromPoint(x, y);
                return hit && banner.contains(hit);
              }).length;
              return { name: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`, under, key: el.outerHTML.slice(0, 120) };
            });
            if (r.done) break;
            stops++;
            if (r.under === 5) covered.push(r.name);
            if (r.inBanner && r.id === 'cookie-accept' && ++accepts === 2) break; // walked around once
          }
          assert.ok(stops > 5, `only ${stops} Tab stops`);
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForTimeout(200);
          const footer = await page.evaluate(() => [...document.querySelectorAll('.site-footer a, .site-footer button')].filter((el) => {
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return !(hit === el || el.contains(hit));
          }).map((el) => el.textContent.trim()));
          expectNone([...covered.map((c) => `focus hidden under the banner: ${c}`), ...footer.map((f) => `footer control under the banner at the page end: ${f}`)], `${p} at ${vp}`);
        } finally {
          await ctx.close();
        }
      });
    }
  }

  for (const vp of B.VIEWPORT_NAMES) {
    // reduced motion: the video waits for Play, so the real click starts it (without, the video starts on load and
    // the click pauses it)
    test(`${vp}: on a first visit the hero play button is not under the banner (a real ${vp === 'mobile' ? 'tap' : 'click'} on it starts the video)`, { timeout: 60000 }, async () => {
      const ctx = await B.newContext(env, vp, { motion: 'reduce' });
      try {
        const page = await ctx.newPage();
        await B.gotoPage(page, env.url('/'), { idle: false });
        await page.locator('#cookie-consent').waitFor({ state: 'visible', timeout: 5000 });
        const c = await page.evaluate(() => {
          const b = document.querySelector('.hero__play').getBoundingClientRect();
          const x = b.left + b.width / 2;
          const y = b.top + b.height / 2;
          const hit = document.elementFromPoint(x, y);
          return { x, y, onButton: Boolean(hit && hit.closest('.hero__play')), inView: y > 0 && y < innerHeight };
        });
        assert.ok(c.inView && c.onButton, `the centre of .hero__play (${Math.round(c.x)}, ${Math.round(c.y)}) is ${c.inView ? 'covered' : 'outside the window'}`);
        if (vp === 'mobile') await page.touchscreen.tap(c.x, c.y); else await page.mouse.click(c.x, c.y);
        await page.locator('iframe.hero__video').waitFor({ state: 'attached', timeout: 5000 });
      } finally {
        await ctx.close();
      }
    });
  }
});

/**
 * Runs in the page: the hero play button against the banner, the Explore Artworks pill, the scroll arrow and the
 * hero text (the glyph area of every text line: the line box without the top and bottom 15 %).
 */
function playButtonLayout() {
  const R = (el) => el.getBoundingClientRect();
  const ov = (a, b, pad = 0) => a.left < b.right && a.right > b.left && a.top < b.bottom - pad && a.bottom > b.top + pad;
  const p = R(document.querySelector('.hero__play'));
  const x = (p.left + p.right) / 2;
  const y = (p.top + p.bottom) / 2;
  const inView = y > 0 && y < innerHeight;
  const hit = inView ? document.elementFromPoint(x, y) : null;
  const banner = document.getElementById('cookie-consent');
  const text = [];
  const walker = document.createTreeWalker(document.querySelector('.hero__content'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (ov(p, r, r.height * 0.15)) text.push(n.nodeValue.trim().slice(0, 20));
  }
  return {
    x, y, inView,
    onButton: Boolean(hit && hit.closest('.hero__play')),
    underBanner: !banner.hidden && ov(p, R(banner)),
    pill: ov(p, R(document.querySelector('.hero__cta'))),
    arrow: ov(p, R(document.querySelector('.hero__arrow .icon'))),
    text: [...new Set(text)],
  };
}

describe('layout: the hero play button at common and short window sizes, with the banner open and closed', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  // laptops (1366x768 and 1280x800 browsers), desktops, tablets, landscape phones, phones (with the browser
  // toolbars: 375x548, 390x664, 393x659), a 961-1060 px short window (the button takes the top corner)
  const OPEN = [[1920, 1080], [1366, 900], [1366, 657], [1280, 689], [1280, 720], [1280, 560], [1024, 480], [768, 1024], [844, 390], [740, 360],
    [667, 375], [568, 320], [430, 932], [390, 844], [393, 659], [390, 664], [375, 667], [375, 548], [360, 640], [320, 568], [320, 480]];
  // the same, plus phone windows in split screen (the button at the hero bottom must clear the pill and the arrow)
  const CLOSED = [...OPEN, [320, 382], [320, 400], [360, 392], [390, 400], [414, 402], [300, 460]];

  test('banner open (first visit): the button is in the window, not under the banner, clear of the pill, the arrow and the hero text, and a real click or tap on it starts the video', { timeout: 300000 }, async () => {
    const problems = [];
    for (const [w, h] of OPEN) {
      const ctx = await sizedContext(env, w, h);
      try {
        const page = await openPage(ctx, env, '/');
        await page.locator('#cookie-consent').waitFor({ state: 'visible', timeout: 5000 });
        const r = await page.evaluate(playButtonLayout);
        const where = `${w}x${h}`;
        if (!r.inView) problems.push(`${where}: the button is outside the window`);
        else if (!r.onButton || r.underBanner) problems.push(`${where}: the button is covered${r.underBanner ? ' by the banner' : ''}`);
        if (r.pill) problems.push(`${where}: the button sits on the Explore Artworks pill`);
        if (r.arrow) problems.push(`${where}: the button sits on the arrow`);
        if (r.text.length) problems.push(`${where}: the button sits on the hero text ${JSON.stringify(r.text)}`);
        if (r.inView && r.onButton) {
          if (w < 700) await page.touchscreen.tap(r.x, r.y); else await page.mouse.click(r.x, r.y);
          const started = await page.locator('iframe.hero__video').waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false);
          if (!started) problems.push(`${where}: a ${w < 700 ? 'tap' : 'click'} on the button did not start the video`);
        }
      } finally {
        await ctx.close();
      }
    }
    expectNone(problems, 'play button with the banner open');
  });

  test('banner closed: the button is clear of the pill, the arrow and the hero text, and in the first screen on windows wider than 640 px', { timeout: 300000 }, async () => {
    const problems = [];
    for (const [w, h] of CLOSED) {
      const ctx = await sizedContext(env, w, h, { consent: 'denied' });
      try {
        const page = await openPage(ctx, env, '/');
        const r = await page.evaluate(playButtonLayout);
        const where = `${w}x${h}`;
        if (w > 640 && !(r.inView && r.onButton)) problems.push(`${where}: the button is ${r.inView ? 'covered' : 'outside the first screen'}`);
        if (r.pill) problems.push(`${where}: the button sits on the Explore Artworks pill`);
        if (r.arrow) problems.push(`${where}: the button sits on the arrow`);
        if (r.text.length) problems.push(`${where}: the button sits on the hero text ${JSON.stringify(r.text)}`);
      } finally {
        await ctx.close();
      }
    }
    expectNone(problems, 'play button with the banner closed');
  });
});

/**
 * Runs in the page: the nav row's edges. A label (the link text, not its padding) cut by an edge must be under a
 * fade (the edge class and a mask image); an edge class without anything cut there is wrong too (it would fade a
 * whole label). With `focused`, the focused link must also be clear of both fades.
 */
function navEdgeProblems(focused) {
  const row = document.querySelector('.site-nav__links');
  const box = row.getBoundingClientRect();
  const st = getComputedStyle(row);
  const masked = (st.maskImage && st.maskImage !== 'none') || (st.webkitMaskImage && st.webkitMaskImage !== 'none');
  const fade = (name) => parseFloat(st.getPropertyValue(name)) || 0;
  const start = row.classList.contains('site-nav__links--more-start');
  const end = row.classList.contains('site-nav__links--more-end');
  const text = (a) => {
    const b = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    return { name: (a.firstChild.nodeValue || a.getAttribute('aria-label') || '').trim(), left: b.left + parseFloat(cs.paddingLeft), right: b.right - parseFloat(cs.paddingRight) };
  };
  // the shown links (phones: the language flag is the last one)
  const labels = [...row.querySelectorAll('.site-nav__link')].filter((a) => a.getClientRects().length).map(text);
  const where = `scrollLeft ${Math.round(row.scrollLeft)} of ${row.scrollWidth - row.clientWidth}`;
  const out = [];
  const hiddenBefore = labels[0].left < box.left - 0.5;
  const hiddenAfter = labels[labels.length - 1].right > box.right + 0.5;
  const cutLeft = labels.find((l) => l.left < box.left - 0.5 && l.right > box.left + 0.5);
  const cutRight = labels.find((l) => l.left < box.right - 0.5 && l.right > box.right + 0.5);
  if (hiddenBefore && !(start && masked)) out.push(`${where}: ${cutLeft ? `"${cutLeft.name}" is cut at the left edge` : 'labels are hidden before the left edge'} without a fade`);
  if (hiddenAfter && !(end && masked)) out.push(`${where}: ${cutRight ? `"${cutRight.name}" is cut at the right edge` : 'labels are hidden after the right edge'} without a fade`);
  if (start && !hiddenBefore) out.push(`${where}: the left edge fades although nothing is cut there`);
  if (end && !hiddenAfter) out.push(`${where}: the right edge fades although nothing is cut there`);
  if (focused) {
    const a = document.activeElement;
    if (!row.contains(a)) out.push('the focus left the nav row');
    else {
      const f = text(a);
      const lo = box.left + (start ? fade('--fade-start') : 0);
      const hi = box.right - (end ? fade('--fade-end') : 0);
      if (f.left < lo - 0.5 || f.right > hi + 0.5) out.push(`${where}: the focused link "${f.name}" is cut or under a fade`);
    }
  }
  return out;
}

describe('layout: navigation row on phones', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const width of [320, 375, 390, 430]) {
    test(`${width} px: after a finger swipe to the end, and at every snap position, a label cut by an edge fades out (no hard cut next to the logo)`, { timeout: 60000 }, async () => {
      const ctx = await sizedContext(env, width, 800, { consent: 'denied' });
      try {
        const page = await openPage(ctx, env, '/about/');
        await page.waitForTimeout(200);
        const problems = (await page.evaluate(navEdgeProblems, false)).map((p) => `first view, ${p}`);
        // a real swipe from the right end of the row to its left end (Chromium touch events)
        const ub = await page.locator('.site-nav__links').boundingBox();
        const y = ub.y + ub.height / 2;
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ub.x + ub.width - 10, y }] });
        for (let i = 1; i <= 10; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: ub.x + ub.width - 10 - ((ub.width - 20) * i) / 10, y }] });
          await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
        await page.waitForTimeout(900);
        const swiped = await page.evaluate(() => { const r = document.querySelector('.site-nav__links'); return r.scrollLeft > 0; });
        if (!swiped) problems.push('the swipe did not scroll the row');
        problems.push(...(await page.evaluate(navEdgeProblems, false)).map((p) => `after the swipe, ${p}`));
        // every snap position (the start of each link, after the left fade) and the end
        const count = await page.locator('.site-nav__link').count();
        for (let i = 0; i <= count; i++) {
          await page.evaluate((k) => {
            const r = document.querySelector('.site-nav__links');
            const links = r.querySelectorAll('.site-nav__link');
            r.scrollLeft = k < links.length ? links[k].offsetLeft - r.offsetLeft : r.scrollWidth;
          }, i);
          await page.waitForTimeout(250);
          problems.push(...(await page.evaluate(navEdgeProblems, false)));
        }
        expectNone([...new Set(problems)], `nav edges at ${width} px`);
      } finally {
        await ctx.close();
      }
    });
  }

  for (const width of [320, 360, 375, 390, 430, 480, 640, 768]) {
    test(`${width} px: hub links ${width >= 390 ? 'fully visible, ' : ''}a cut edge fades, keyboard focus brings every link fully into the row`, { timeout: 60000 }, async () => {
      const ctx = await sizedContext(env, width, 800, { consent: 'denied' });
      try {
        const page = await openPage(ctx, env, '/about/');
        await page.waitForTimeout(200);
        const measure = () => page.evaluate(() => {
          const row = document.querySelector('.site-nav__links');
          const rb = row.getBoundingClientRect();
          const logo = document.querySelector('.site-nav__logo').getBoundingClientRect();
          const links = [...row.querySelectorAll('a')].filter((a) => a.getClientRects().length).map((a) => {
            const b = a.getBoundingClientRect();
            return { text: a.textContent.trim(), visible: b.left >= rb.left - 0.5 && b.right <= rb.right + 0.5 };
          });
          const overflow = row.scrollWidth > row.clientWidth + 1;
          return { links, overflow, end: row.classList.contains('site-nav__links--more-end'), gap: rb.left - logo.right };
        });
        const m = await measure();
        const problems = [];
        if (m.gap < 8) problems.push(`the link row starts ${Math.round(m.gap)} px after the logo (scrolled text would touch it)`);
        if (m.overflow && !m.end) problems.push('the row overflows but has no site-nav__links--more-end (no fade at the cut edge)');
        if (!m.overflow && m.end) problems.push('the row fits but is marked as cut');
        if (width >= 390) for (const l of m.links.slice(0, data.hubs.length)) if (!l.visible) problems.push(`hub link "${l.text}" is not fully visible`);
        // keyboard: each nav link in turn, forward to the end and back to the start (Shift+Tab); the focused
        // link is fully in the row and clear of both fades, and every cut edge fades
        const count = m.links.length;
        await page.locator('.site-nav__logo').focus();
        const steps = [...Array(count).fill('Tab'), ...Array(count - 1).fill('Shift+Tab')];
        for (const [i, key] of steps.entries()) {
          await page.keyboard.press(key);
          await page.waitForTimeout(60);
          const f = await page.evaluate(() => {
            const a = document.activeElement;
            const row = document.querySelector('.site-nav__links');
            if (!row.contains(a)) return null;
            const b = a.getBoundingClientRect();
            const rb = row.getBoundingClientRect();
            return { text: a.textContent.trim(), inRow: b.left >= rb.left - 0.5 && b.right <= rb.right + 0.5 };
          });
          if (!f) { problems.push(`${key} (step ${i + 1}) left the nav row`); break; }
          if (!f.inRow) problems.push(`focused link "${f.text}" is not fully visible in the row`);
          problems.push(...(await page.evaluate(navEdgeProblems, true)).map((p) => `${key} to "${f.text}": ${p}`));
        }
        expectNone([...new Set(problems)], `nav at ${width} px`);
      } finally {
        await ctx.close();
      }
    });
  }
});

describe('layout: hero at small and short windows', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const width of [300, 320]) {
    test(`${width} px: the Explore Artworks pill is centred and inside the window`, { timeout: 60000 }, async () => {
      const ctx = await sizedContext(env, width, 640, { consent: 'denied' });
      try {
        const page = await openPage(ctx, env, '/');
        const r = await page.evaluate(() => { const b = document.querySelector('.hero__cta').getBoundingClientRect(); return { left: b.left, right: innerWidth - b.right }; });
        assert.ok(r.left >= 0 && r.right >= 0 && Math.abs(r.left - r.right) <= 1, `pill left space ${r.left.toFixed(1)} px, right space ${r.right.toFixed(1)} px`);
      } finally {
        await ctx.close();
      }
    });
  }

  test('the scroll arrow never overlaps the Explore Artworks pill (laptops, landscape phones, 200 % zoom, the reference sizes)', { timeout: 120000 }, async () => {
    const problems = [];
    for (const [w, h] of [[1920, 1080], [1366, 900], [1366, 768], [1366, 657], [1280, 600], [1100, 700], [1024, 600], [844, 390], [740, 360], [683, 450], [390, 844], [375, 667], [320, 568], [320, 480]]) {
      const ctx = await sizedContext(env, w, h, { consent: 'denied' });
      try {
        const page = await openPage(ctx, env, '/');
        const r = await page.evaluate(() => {
          const c = document.querySelector('.hero__cta').getBoundingClientRect();
          const arrow = document.querySelector('.hero__arrow');
          if (getComputedStyle(arrow).display === 'none') return null;
          const a = arrow.querySelector('.icon').getBoundingClientRect();
          return { overlap: !(a.right <= c.left || a.left >= c.right || a.bottom <= c.top || a.top >= c.bottom), cta: [c.top, c.bottom].map(Math.round), arrow: [a.top, a.bottom].map(Math.round) };
        });
        if (r && r.overlap) problems.push(`${w}x${h}: arrow ${JSON.stringify(r.arrow)} overlaps the pill ${JSON.stringify(r.cta)}`);
      } finally {
        await ctx.close();
      }
    }
    expectNone(problems, 'arrow over the pill');
  });

  // The YouTube player letterboxes its 16:9 video into the frame and draws its title bar (title, channel avatar)
  // along the top edge of the frame and its logo at the bottom right, at every start, resume and loop. Like the old
  // background video, the video must cover the hero edge to edge at every window size (no black bands; the hero
  // can be taller than the window), and the frame must reach far enough above and below the hero that these
  // strips stay outside it. A stand-in player page: only the frame's box is measured (engines.test.js checks the
  // same in Firefox and WebKit).
  test('after Play, the 16:9 video area covers the hero at every window size, with no black bands, and the player\'s title bar and logo strips lie outside the hero', { timeout: 180000 }, async () => {
    const problems = [];
    for (const [w, h] of [[1920, 1080], [2560, 1440], [1536, 750], [1366, 900], [1366, 600], [1280, 690], [1100, 620], [1024, 600], [1000, 560], [768, 1024],
      [844, 390], [667, 375], [390, 844], [360, 392]]) {
      const ctx = await sizedContext(env, w, h, { consent: 'denied' });
      try {
        await ctx.route(/^https:\/\/www\.youtube-nocookie\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: B.BLANK_PLAYER }));
        const page = await openPage(ctx, env, '/');
        await page.locator('.hero__play').click();
        await page.locator('iframe.hero__video').waitFor({ state: 'attached', timeout: 5000 });
        problems.push(...B.heroVideoProblems(await page.evaluate(B.heroVideoGeometry), `${w}x${h}`));
      } finally {
        await ctx.close();
      }
    }
    expectNone(problems, 'hero video geometry');
  });
});

describe('layout: breadcrumb, pager, headings and 404 links', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const width of [320, 390]) {
    test(`${width} px: breadcrumb separators stay with the label after them; a single pager link uses the whole row`, { timeout: 60000 }, async () => {
      const ctx = await sizedContext(env, width, 800, { consent: 'denied' });
      try {
        const page = await openPage(ctx, env, S.artworkPath(LONG_TITLE.hub, LONG_TITLE.artwork));
        const crumbs = await page.evaluate(() => [...document.querySelectorAll('.breadcrumb__sep')].map((sep) => {
          const label = sep.parentElement.querySelector('.breadcrumb__link, .breadcrumb__current');
          const range = document.createRange();
          range.selectNodeContents(label);
          const first = range.getClientRects()[0];
          return { label: label.textContent.trim().slice(0, 30), sameLine: Math.abs(first.top - sep.getBoundingClientRect().top) < 4 };
        }));
        const problems = crumbs.filter((c) => !c.sameLine).map((c) => `the separator before "${c.label}" ends a line`);
        await page.goto(env.url(S.artworkPath(HUB, FIRST)));
        const pager = await page.evaluate(() => {
          const nav = document.querySelector('.artwork__pager');
          const links = nav.querySelectorAll('.artwork__pager-link');
          return { count: links.length, share: links[0].getBoundingClientRect().width / nav.getBoundingClientRect().width };
        });
        if (pager.count === 1 && pager.share < 0.9) problems.push(`the only pager link uses ${Math.round(pager.share * 100)} % of the row`);
        expectNone(problems, `breadcrumb/pager at ${width} px`);
      } finally {
        await ctx.close();
      }
    });
  }

  for (const [width, height] of [[1366, 900], [390, 844]]) {
    test(`${width} px: hub and page headings that wrap end with more than one word`, { timeout: 60000 }, async () => {
      const ctx = await sizedContext(env, width, height, { consent: 'denied' });
      try {
        const page = await ctx.newPage();
        const problems = [];
        for (const p of [...data.hubs.map((h) => `/${h.path}/`), '/about/']) {
          await B.gotoPage(page, env.url(p), { idle: false });
          await B.fontsReady(page);
          const r = await page.evaluate(() => {
            const h = document.querySelector('h1');
            const words = [];
            const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              for (const m of n.nodeValue.matchAll(/\S+/g)) {
                const range = document.createRange();
                range.setStart(n, m.index);
                range.setEnd(n, m.index + m[0].length);
                words.push({ w: m[0], top: Math.round(range.getBoundingClientRect().top) });
              }
            }
            const lines = [...new Set(words.map((x) => x.top))];
            return { text: h.textContent.trim(), lines: lines.length, last: words.filter((x) => x.top === lines[lines.length - 1]).map((x) => x.w) };
          });
          if (r.lines > 1 && r.last.length < 2) problems.push(`${p}: "${r.text}" ends with the single word "${r.last[0]}" on its last line`);
        }
        expectNone(problems, `one-word heading lines at ${width} px`);
      } finally {
        await ctx.close();
      }
    });
  }

  test('1366 px: the 404 page links sit on one row', { timeout: 60000 }, async () => {
    const ctx = await sizedContext(env, 1366, 900, { consent: 'denied' });
    try {
      const page = await ctx.newPage();
      await B.gotoPage(page, env.url('/no-such-page/'), { idle: false });
      const tops = await page.evaluate(() => [...new Set([...document.querySelectorAll('.page__link')].map((a) => Math.round(a.getBoundingClientRect().top)))]);
      assert.equal(tops.length, 1, `the 404 links wrap into ${tops.length} rows`);
    } finally {
      await ctx.close();
    }
  });

  test('280-1100 px: the 404 page links wrap into balanced rows (6, 3 + 3, 2 + 2 + 2 or one column), never with a pill alone', { timeout: 120000 }, async () => {
    // a phone context below 700 px, a desktop one above; after each resize two frames pass, so the media rules of
    // the new width apply (a style read at once can still have those of the previous width)
    const problems = [];
    for (const [from, to] of [[280, 699], [700, 1100]]) {
      const ctx = await sizedContext(env, from, 800, { consent: 'denied' });
      try {
        const page = await ctx.newPage();
        await B.gotoPage(page, env.url('/no-such-page/'), { idle: false });
        await B.fontsReady(page);
        for (let w = from; w <= to; w += 6) {
          await page.setViewportSize({ width: w, height: 800 });
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const r = await page.evaluate(() => {
            const tops = new Map();
            for (const a of document.querySelectorAll('.page__link')) {
              const t = Math.round(a.getBoundingClientRect().top);
              tops.set(t, (tops.get(t) || 0) + 1);
            }
            return { rows: [...tops.values()], scrollbar: innerWidth - document.documentElement.clientWidth };
          });
          if (new Set(r.rows).size > 1) problems.push(`${w} px${r.scrollbar ? ` (scrollbar ${r.scrollbar} px)` : ''}: rows of ${r.rows.join(' + ')}`);
        }
      } finally {
        await ctx.close();
      }
    }
    expectNone(problems, 'unbalanced 404 link rows');
  });
});

describe('layout: the nav row is aligned with the page content', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  /* Runs in the page: the gallery grid's outer card edges (the content container) against the nav logo's left
     edge and the right edge of the last visible item of the nav row (the language flag). */
  const measure = () => {
    const cards = [...document.querySelectorAll('main .gallery__grid article.card')].map((c) => c.getBoundingClientRect());
    const flags = [...document.querySelectorAll('#site-nav .site-nav__langs .flag')].map((f) => f.getBoundingClientRect()).filter((r) => r.width > 0);
    const logo = document.querySelector('#site-nav .site-nav__logo').getBoundingClientRect();
    // up to 680 px the flag scrolls with the links: the row itself ends at the content edge
    const row = document.querySelector('#site-nav .site-nav__links').getBoundingClientRect();
    return {
      contentLeft: Math.min(...cards.map((r) => r.left)),
      contentRight: Math.max(...cards.map((r) => r.right)),
      logoLeft: logo.left,
      lastRight: flags.length ? flags[flags.length - 1].right : row.right,
    };
  };

  for (const width of [1920, 1366, 1295, 1024, 768, 600, 390]) {
    test(`${width} px: the nav logo starts and the last nav item ends at the edges of the content container (±2 px), in English and German`, { timeout: 60000 }, async () => {
      const ctx = await sizedContext(env, width, 900, { consent: 'denied' });
      try {
        const problems = [];
        for (const p of [`/${data.hubs[1].path}/`, `/de/${data.hubs[1].path}/`]) {
          const page = await openPage(ctx, env, p);
          const m = await page.evaluate(measure);
          if (Math.abs(m.logoLeft - m.contentLeft) > 2) problems.push(`${p}: logo left ${m.logoLeft.toFixed(1)}, content left ${m.contentLeft.toFixed(1)}`);
          if (m.lastRight === null || Math.abs(m.lastRight - m.contentRight) > 2) problems.push(`${p}: last nav item right ${m.lastRight === null ? 'none' : m.lastRight.toFixed(1)}, content right ${m.contentRight.toFixed(1)}`);
          await page.close();
        }
        expectNone(problems, `nav alignment at ${width} px`);
      } finally { await ctx.close(); }
    });
  }
});
