'use strict';
// Firefox and WebKit (Safari and every iOS browser) for behaviour that differs between browser engines, from the
// round-3 review. They run in Playwright's Docker image (tests/lib/engines.js); without Docker or the image the
// tests skip with a message. Every non-local request is blocked, as in the Chromium tests.
//   - WebKit runs the deferred scripts before the stylesheet in <head> has loaded: a layout read in a script then
//     computes the browser's default styles, and every property with a transition animates from them once
//     site.css arrives (blue nav links, grey cookie buttons, the nav sliding up). The stylesheet is delayed here,
//     and no transition may run while the page loads.
//   - Firefox and WebKit fire no load event for a frame that a content blocker (or a firewall, or no connection)
//     keeps from loading: the hero player must still be removed and the button must read "Play the video" again.
//   - The hero player is sized with container query units: the video covers the hero, and the player's title bar
//     and logo lie outside it, in these engines too (layout.test.js checks more window sizes in Chromium).
const { describe, test, before, after } = require('node:test');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');
const B = require('../lib/browser');
const E = require('../lib/engines');
const { startServer } = require('../../scripts/serve.js');

const data = S.loadData();
// one page per type; the artwork with the most images (thumbnails, previous/next, full-screen view)
const GALLERY = S.allArtworks(data).reduce((best, x) => (!best || x.artwork.images.length > best.artwork.images.length ? x : best), null);
const PAGES = ['/', `/${data.hubs[0].path}/`, S.artworkPath(GALLERY.hub, GALLERY.artwork), '/about/', '/contact/'];
const PROFILES = {
  desktop: { viewport: { width: 1366, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
};
const CSS_DELAY = 400;

const reason = E.skipReason();

describe(`engines: Firefox and WebKit (${E.IMAGE})`, { skip: reason || false }, () => {
  let server = null;
  let remote = null;
  const browsers = {};
  before(async () => {
    server = await startServer({ root: S.APP_DIR, port: 0 });
    remote = await E.startRemote();
    for (const engine of E.ENGINES) browsers[engine] = await remote.connect(engine);
  });
  after(async () => {
    for (const b of Object.values(browsers)) await b.close().catch(() => {});
    if (remote) await remote.stop();
    if (server) await server.close();
  });

  const isLocal = (url) => url === server.url || url.startsWith(`${server.url}/`);

  /** A context with every non-local request blocked; Firefox has no isMobile. */
  async function context(engine, profile, consent = null) {
    const opts = { ...PROFILES[profile], locale: 'en-US' };
    if (engine === 'firefox') delete opts.isMobile;
    const ctx = await browsers[engine].newContext(opts);
    await ctx.route((u) => !isLocal(u.href) && !/^(data|blob):/.test(u.href), (r) => r.abort('blockedbyclient'));
    if (consent) await ctx.addInitScript((v) => { try { localStorage.setItem('cookie_consent_v2', v); } catch (e) { /* */ } }, consent);
    return ctx;
  }

  for (const engine of E.ENGINES) {
    test(`${engine}: with a stylesheet that arrives ${CSS_DELAY} ms late, no CSS transition runs while the page loads (first visit: banner open), and the nav edge fades and the banner room are still right`, { timeout: 180000 }, async () => {
      const problems = [];
      for (const profile of Object.keys(PROFILES)) {
        for (const p of PAGES) {
          const ctx = await context(engine, profile);
          try {
            await ctx.route(/\/css\/site\.css(\?.*)?$/, async (r) => {
              await new Promise((resolve) => setTimeout(resolve, CSS_DELAY));
              await r.continue();
            });
            await ctx.addInitScript(() => {
              window.__transitions = [];
              document.addEventListener('transitionrun', (e) => {
                const t = e.target;
                window.__transitions.push(`${t.id ? `#${t.id}` : `${t.tagName.toLowerCase()}.${String(t.className).split(' ')[0]}`} ${e.propertyName}`);
              }, true);
            });
            const page = await ctx.newPage();
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
            const resp = await page.goto(server.url + p, { waitUntil: 'load', timeout: 60000 });
            await page.waitForTimeout(600);
            const r = await page.evaluate(() => {
              const row = document.querySelector('.site-nav__links');
              const links = row ? [...row.querySelectorAll('.site-nav__link')].filter((l) => l.getClientRects().length) : [];
              const last = links[links.length - 1];
              const pad = last ? parseFloat(getComputedStyle(last).paddingRight) || 0 : 0;
              const banner = document.getElementById('cookie-consent');
              return {
                transitions: window.__transitions,
                running: document.getAnimations().filter((a) => a.transitionProperty).length,
                moreEnd: row ? row.classList.contains('site-nav__links--more-end') : null,
                cutEnd: last ? last.getBoundingClientRect().right - pad > row.getBoundingClientRect().right + 0.5 : null,
                bannerShown: Boolean(banner && !banner.hidden),
                consentOpen: document.documentElement.classList.contains('consent-open'),
                consentH: document.documentElement.style.getPropertyValue('--consent-h'),
                bannerH: banner ? `${banner.offsetHeight}px` : null,
              };
            });
            const where = `${profile} ${p}`;
            if (!resp || resp.status() !== 200) problems.push(`${where}: HTTP ${resp && resp.status()}`);
            if (r.transitions.length || r.running) problems.push(`${where}: ${r.transitions.length} transitions ran while the page loaded (${r.running} still running): ${JSON.stringify([...new Set(r.transitions)].slice(0, 6))}`);
            if (r.moreEnd !== r.cutEnd) problems.push(`${where}: the nav row's right edge ${r.cutEnd ? 'cuts a label' : 'cuts nothing'}, but site-nav__links--more-end is ${r.moreEnd ? 'set' : 'not set'}`);
            if (!r.bannerShown || !r.consentOpen || r.consentH !== r.bannerH) problems.push(`${where}: banner ${r.bannerShown ? 'shown' : 'hidden'}, html.consent-open ${r.consentOpen}, --consent-h "${r.consentH}" (banner ${r.bannerH})`);
            problems.push(...errors.map((e) => `${where}: page error ${e}`));
          } finally {
            await ctx.close();
          }
        }
      }
      expectNone(problems, `${engine}: page load with a late stylesheet`);
    });
  }

  test(`${E.ENGINES.join(' and ')}: the video starts on load (no click), and its 16:9 area covers the hero (also when the hero is taller than the window), and the player's title bar and logo strips lie outside it`, { timeout: 120000 }, async () => {
    const problems = [];
    for (const engine of E.ENGINES) {
      for (const [w, h] of [[1920, 1080], [1366, 900], [1024, 600], [667, 375], [390, 844]]) {
        const ctx = await browsers[engine].newContext({ viewport: { width: w, height: h } });
        try {
          await ctx.route((u) => !isLocal(u.href) && !/^(data|blob):/.test(u.href), (r) => (/^https:\/\/www\.youtube-nocookie\.com\//.test(r.request().url())
            ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: B.BLANK_PLAYER })
            : r.abort('blockedbyclient')));
          await ctx.addInitScript(() => { try { localStorage.setItem('cookie_consent_v2', 'denied'); } catch (e) { /* */ } });
          const page = await ctx.newPage();
          await page.goto(`${server.url}/`, { waitUntil: 'load', timeout: 60000 });
          await page.locator('iframe.hero__video').waitFor({ state: 'attached', timeout: 5000 });
          problems.push(...B.heroVideoProblems(await page.evaluate(B.heroVideoGeometry), `${engine} ${w}x${h}`));
        } finally {
          await ctx.close();
        }
      }
    }
    expectNone(problems, 'hero video geometry');
  });

  test(`${E.ENGINES.join(' and ')}: a player that starts on load but that a content blocker stops (no load event) is removed after about 20 s; the button reads "Play the video" again over the poster, and Play starts it again`, { timeout: 120000 }, async () => {
    const problems = [];
    await Promise.all(E.ENGINES.map(async (engine) => {
      const ctx = await context(engine, 'desktop', 'denied');
      try {
        const page = await ctx.newPage();
        const clicked = Date.now(); // the player starts with the page
        await page.goto(`${server.url}/`, { waitUntil: 'load', timeout: 60000 });
        await page.locator('iframe.hero__video').waitFor({ state: 'attached', timeout: 5000 });
        const label = () => page.evaluate(() => document.querySelector('.hero__play').getAttribute('aria-label'));
        if ((await label()) !== 'Pause the video') problems.push(`${engine}: while the video starts the button reads ${JSON.stringify(await label())}`);
        const gone = await page.waitForFunction(() => !document.querySelector('iframe.hero__video'), null, { timeout: 35000, polling: 250 }).then(() => true, () => false);
        const waited = Date.now() - clicked;
        const s = await page.evaluate(() => {
          const poster = document.querySelector('.hero__poster img');
          return { label: document.querySelector('.hero__play').getAttribute('aria-label'), poster: Boolean(poster && poster.getClientRects().length) };
        });
        if (!gone) problems.push(`${engine}: the blocked player is still there 35 s after the page load; the button reads ${JSON.stringify(s.label)}`);
        else {
          if (waited < 8000) problems.push(`${engine}: the player was removed after ${waited} ms (it must get time to load)`);
          if (s.label !== 'Play the video') problems.push(`${engine}: after the player was removed the button reads ${JSON.stringify(s.label)}`);
          if (!s.poster) problems.push(`${engine}: the poster is gone`);
          await page.click('.hero__play');
          const again = await page.locator('iframe.hero__video').waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false);
          if (!again || (await label()) !== 'Pause the video') problems.push(`${engine}: a second click does not start the player again`);
        }
      } finally {
        await ctx.close();
      }
    }));
    expectNone(problems, 'blocked hero player');
  });
});
