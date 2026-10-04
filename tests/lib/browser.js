'use strict';
// Playwright helpers for tests/browser/ (Chromium only, no other test framework).
//
// Env:
//   APP_DIR        directory under test (see tests/lib/site.js)
//   SCREEN_DIR     where screenshots and performance.json go (default: <os tmpdir>/polina-shvedko-screens/<run id>)
//   BROWSER_PAGES  "all" = visit every page from data.json in the page-load test (default: one page per type)
//   LCP_NETWORK    network profile for the LCP measurement: fast4g (default), slow4g or none
//
// Network policy: the browser can reach only the local test server. Chromium resolves every other host to
// "not found" (--host-resolver-rules), and contexts route non-local requests: googletagmanager.com gets a stub
// script, everything else is aborted. Every non-local request is recorded.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('../../scripts/serve.js');
const S = require('./site');

const VIEWPORTS = {
  desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const VIEWPORT_NAMES = Object.keys(VIEWPORTS);

const CONSENT_KEY = 'cookie_consent_v2';
const GOOGLE_HOST_RE = /(^|\.)(google(?:tagmanager|-analytics|adservices|syndication|usercontent|apis)?\.[a-z.]+|gstatic\.com|doubleclick\.net|youtube(?:-nocookie)?\.com|ytimg\.com|googlevideo\.com|ggpht\.com)$/i;
const GTM_HOST_RE = /(^|\.)googletagmanager\.com$/i;
const YOUTUBE_HOST_RE = /(^|\.)(youtube(?:-nocookie)?\.com|ytimg\.com|googlevideo\.com)$/i;
/* The home hero player (youtube-nocookie.com, privacy-enhanced mode), which starts on page load: the one request to
   a Google host before consent, named in the privacy policy. rec.google() leaves it out, rec.heroPlayer() lists it. */
const HERO_PLAYER_RE = /^https:\/\/www\.youtube-nocookie\.com\/embed\//;
const TILDA_HOST_RE = /tilda/i;
const GTAG_STUB = '/* gtag.js test stub */ window.__gtagStubLoads = (window.__gtagStubLoads || 0) + 1;';

const RUN_ID = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
const SCREEN_DIR = path.resolve(process.env.SCREEN_DIR || path.join(os.tmpdir(), 'polina-shvedko-screens', RUN_ID));

const NETWORK_PROFILES = {
  // Chrome DevTools "Fast 4G": 9 Mbit/s down, 1.5 Mbit/s up, 165 ms latency (DevTools applies the 0.9 factor)
  fast4g: { offline: false, latency: 165, downloadThroughput: (9e6 / 8) * 0.9, uploadThroughput: (1.5e6 / 8) * 0.9 },
  // Chrome DevTools "Slow 4G" (formerly "Fast 3G"): 1.6 Mbit/s down, 750 kbit/s up, 562.5 ms latency
  slow4g: { offline: false, latency: 562.5, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 },
  none: null,
};

function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}

function pathOf(url) {
  try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
}

/** One page per type (SPEC 12 browser list): home, first hub, first artwork of each hub, about, contact, German home and artwork. */
function samplePages(data = S.loadData()) {
  const hubs = data.hubs || [];
  if (process.env.BROWSER_PAGES === 'all') {
    return S.indexablePages(data).map((p) => ({ key: p.key.replace(/[:]/g, '-'), label: p.type, path: p.path, type: p.type, hub: p.hub, artwork: p.artwork }));
  }
  const list = [{ key: 'home', label: 'home', type: 'home', path: '/' }];
  if (hubs[0]) list.push({ key: `hub-${hubs[0].key}`, label: `hub ${hubs[0].path}`, type: 'hub', path: `/${hubs[0].path}/`, hub: hubs[0] });
  for (const hub of hubs) {
    const artwork = (hub.artworks || [])[0];
    if (artwork) list.push({ key: `artwork-${hub.key}`, label: `artwork (${hub.path})`, type: 'artwork', path: S.artworkPath(hub, artwork), hub, artwork });
  }
  list.push({ key: 'about', label: 'about', type: 'about', path: '/about/' });
  list.push({ key: 'contact', label: 'contact', type: 'contact', path: '/contact/' });
  // German: home and the first artwork below /de/
  list.push({ key: 'de-home', label: 'German home', type: 'home', path: '/de/' });
  if (hubs[0] && hubs[0].artworks[0]) list.push({ key: 'de-artwork', label: 'German artwork', type: 'artwork', path: S.artworkPath(hubs[0], hubs[0].artworks[0], 'de'), hub: hubs[0], artwork: hubs[0].artworks[0] });
  return list;
}

/** The artwork with the most images (used by the image gallery tests). */
function galleryArtwork(data = S.loadData()) {
  let best = null;
  for (const hub of data.hubs || []) for (const a of hub.artworks || []) if (!best || a.images.length > best.artwork.images.length) best = { hub, artwork: a };
  return best;
}

async function startEnv() {
  const server = await startServer({ root: S.APP_DIR, port: 0 });
  let browser;
  try {
    browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'] });
  } catch (e) {
    await server.close();
    throw e;
  }
  const base = server.url;
  return {
    server,
    browser,
    base,
    url: (p) => base + p,
    isLocal: (url) => url === base || url.startsWith(`${base}/`),
    async close() {
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

/**
 * New browser context for a viewport: a name of VIEWPORTS, or the context options of another device
 * ({ viewport, deviceScaleFactor, isMobile, hasTouch }). Options:
 *   consent: null (first visit) | 'granted' | 'denied' — stored in localStorage before every page load
 *   route: true — stub googletagmanager.com and abort other third-party requests (false: only the DNS block)
 *   motion: 'no-preference' (default; the home hero video starts on load) | 'reduce' (prefers-reduced-motion:
 *     no autoplay, no smooth scrolling, no view transitions, no fades; the hero video waits for Play)
 */
async function newContext(env, vpName, { consent = null, route = true, motion = 'no-preference' } = {}) {
  const ctx = await env.browser.newContext({
    ...(typeof vpName === 'string' ? VIEWPORTS[vpName] : vpName),
    reducedMotion: motion,
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
    colorScheme: 'light',
  });
  if (route) {
    await ctx.route((url) => !env.isLocal(url.href) && !/^(data|blob):/.test(url.href), async (r) => {
      const host = hostOf(r.request().url());
      if (GTM_HOST_RE.test(host)) {
        await r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: GTAG_STUB });
        return;
      }
      await r.abort('blockedbyclient');
    });
  }
  if (consent !== null) {
    await ctx.addInitScript(([key, value]) => {
      try { localStorage.setItem(key, value); } catch (e) { /* storage blocked */ }
    }, [CONSENT_KEY, consent]);
  }
  return ctx;
}

/**
 * Record what a page does. rec.requests: every request ({ url, host, type, local, n }); rec.failedLocal,
 * rec.consoleErrors, rec.pageErrors: problems. Console errors caused by the test's own blocking of
 * third-party requests are ignored (those requests are reported separately).
 */
function trackPage(page, env) {
  const rec = { requests: [], failedLocal: [], consoleErrors: [], pageErrors: [], documentUrls: new Set() };
  page.on('request', (r) => {
    const url = r.url();
    if (/^(data|blob):/.test(url)) return;
    rec.requests.push({ url, host: hostOf(url), type: r.resourceType(), local: env.isLocal(url), n: rec.requests.length });
  });
  page.on('requestfailed', (r) => {
    if (!env.isLocal(r.url())) return;
    const err = (r.failure() && r.failure().errorText) || 'failed';
    if (/ERR_ABORTED/.test(err) && r.resourceType() !== 'document') return; // cancelled by navigation or image switch
    rec.failedLocal.push(`${err} ${pathOf(r.url())}`);
  });
  page.on('response', (r) => {
    if (!env.isLocal(r.url()) || r.status() < 400) return;
    if (r.request().isNavigationRequest() && r.request().frame() === page.mainFrame()) return; // reported by the caller
    rec.failedLocal.push(`HTTP ${r.status()} ${pathOf(r.url())}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = (m.location() && m.location().url) || '';
    if (/^Failed to load resource/.test(m.text()) && loc && !env.isLocal(loc)) return;
    rec.consoleErrors.push(`${m.text().slice(0, 200)}${loc ? ` (${pathOf(loc)})` : ''}`);
  });
  page.on('pageerror', (e) => rec.pageErrors.push(String(e && e.message ? e.message : e).slice(0, 300)));
  rec.mark = () => rec.requests.length;
  rec.external = (from = 0) => rec.requests.slice(from).filter((r) => !r.local);
  rec.google = (from = 0) => rec.external(from).filter((r) => GOOGLE_HOST_RE.test(r.host) && !HERO_PLAYER_RE.test(r.url));
  rec.heroPlayer = (from = 0) => rec.external(from).filter((r) => HERO_PLAYER_RE.test(r.url));
  rec.gtag = (from = 0) => rec.external(from).filter((r) => GTM_HOST_RE.test(r.host) && /\/gtag\/js/.test(r.url));
  rec.youtube = (from = 0) => rec.external(from).filter((r) => YOUTUBE_HOST_RE.test(r.host));
  rec.tilda = (from = 0) => rec.external(from).filter((r) => TILDA_HOST_RE.test(r.host));
  return rec;
}

async function gotoPage(page, url, { waitUntil = 'load', idle = true, timeout = 60000 } = {}) {
  const resp = await page.goto(url, { waitUntil, timeout });
  if (idle) await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  return resp;
}

/**
 * Wait until the site font (Jost, every @font-face of that family) is loaded and applied. document.fonts.ready
 * alone can resolve before layout has asked for a face, and text measured then has the fallback font's widths
 * (the swap comes later), so line breaks and wrapped rows differ from one run to the next.
 */
async function fontsReady(page) {
  await page.evaluate(async () => {
    if (!document.fonts) return;
    const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Jost');
    await Promise.all(faces.map((f) => f.load().catch(() => null)));
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** window.dataLayer as JSON (gtag() pushes Arguments objects; they become arrays). */
async function readDataLayer(page) {
  return page.evaluate(() => (Array.isArray(window.dataLayer) ? window.dataLayer : []).map((e) => {
    const value = Object.prototype.toString.call(e) === '[object Arguments]' ? Array.from(e) : e;
    try { return JSON.parse(JSON.stringify(value)); } catch (err) { return String(value); }
  }));
}

function findEvents(dataLayer, name) {
  return dataLayer.filter((e) => Array.isArray(e) && e[0] === 'event' && e[1] === name);
}

/** Click the first element matching `selector`; fail fast with a clear message when it is missing or stays hidden. */
async function clickOn(page, selector, what = selector, timeout = 10000) {
  const loc = page.locator(selector);
  const fail = (msg) => { const err = new Error(`${what}: ${msg}`); err.code = 'ERR_ASSERTION'; throw err; };
  if ((await loc.count()) === 0) fail(`no element matches ${selector}`);
  const visible = await loc.first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
  if (!visible) fail(`${selector} exists but is not visible`);
  await loc.first().click({ timeout });
}

async function storedConsent(page) {
  return page.evaluate((key) => { try { return localStorage.getItem(key); } catch (e) { return 'storage-error'; } }, CONSENT_KEY);
}

async function bannerVisible(page) {
  return page.locator('#cookie-consent').isVisible().catch(() => false);
}

/** Scroll through the page so lazy images load, wait for fonts and images, return to the top. */
async function settleForScreenshot(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { window.scrollTo(0, y); await sleep(80); }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(300);
    // Only rendered images: a lazy image in a hidden slide (display: none) never loads, so waiting for it
    // would only run into the 10 s cap below.
    const imgs = [...document.images].filter((i) => i.getClientRects().length > 0);
    await Promise.race([
      Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); })))),
      sleep(10000),
    ]);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    window.scrollTo(0, 0);
    await sleep(400);
  });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

function ensureScreenDir() {
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
  return SCREEN_DIR;
}

/** Merge `entries` into SCREEN_DIR/<file> (JSON object keyed by measurement name). */
function writeArtifact(file, entries) {
  ensureScreenDir();
  const target = path.join(SCREEN_DIR, file);
  let current = {};
  try { current = JSON.parse(fs.readFileSync(target, 'utf8')); } catch { current = {}; }
  fs.writeFileSync(target, `${JSON.stringify({ ...current, ...entries }, null, 2)}\n`);
  return target;
}

/** Chrome-style CLS: largest session window (gap < 1 s, window < 5 s) of shifts without recent input. */
function clsFromShifts(shifts) {
  let max = 0;
  let cur = 0;
  let start = -Infinity;
  let prev = -Infinity;
  for (const s of [...shifts].sort((a, b) => a.t - b.t)) {
    if (s.t - prev > 1000 || s.t - start > 5000) { cur = 0; start = s.t; }
    cur += s.v;
    prev = s.t;
    if (cur > max) max = cur;
  }
  return max;
}

/** Init script that records LCP and layout shifts into window.__perf. */
const PERF_OBSERVER_SCRIPT = () => {
  window.__perf = { lcp: null, shifts: [], loadAt: null };
  const describeEl = (el) => {
    if (!el) return null;
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    if (el.classList && el.classList.length) s += `.${[...el.classList].slice(0, 3).join('.')}`;
    return s;
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__perf.lcp = { t: e.startTime, size: e.size, url: e.url || '', el: describeEl(e.element) };
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__perf.shifts.push({ v: e.value, t: e.startTime, sources: (e.sources || []).map((src) => describeEl(src.node)).filter(Boolean).slice(0, 3) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (err) {
    window.__perf.error = String(err);
  }
  window.addEventListener('load', () => { window.__perf.loadAt = performance.now(); });
};

/**
 * Runs in the page after Play: the hero player's frame against the hero. The player letterboxes its 16:9 video
 * into the frame and draws its title bar along the top edge of the frame and its logo at the bottom right.
 */
function heroVideoGeometry() {
  const f = document.querySelector('iframe.hero__video').getBoundingClientRect();
  const hb = document.querySelector('.hero').getBoundingClientRect();
  const letterbox = f.width / f.height < 16 / 9;
  const vw = letterbox ? f.width : f.height * 16 / 9;
  const vh = letterbox ? f.width * 9 / 16 : f.height;
  const vl = f.left + (f.width - vw) / 2;
  const vt = f.top + (f.height - vh) / 2;
  return {
    hero: `${Math.round(hb.width)}x${Math.round(hb.height)}`,
    frame: `${Math.round(f.width)}x${Math.round(f.height)}`,
    bands: [vt - hb.top, hb.bottom - (vt + vh), vl - hb.left, hb.right - (vl + vw)],
    zoom: vw / Math.max(hb.width, hb.height * 16 / 9),
    above: hb.top - f.top,
    below: f.bottom - hb.bottom,
  };
}

/**
 * Problems in a heroVideoGeometry() result: like the old background video, the video covers the hero edge to edge
 * (no black bands; the hero can be taller than the window) without needless zoom, and the frame reaches at least
 * 100 px above and below the hero, so the title bar and the logo stay outside it.
 */
function heroVideoProblems(g, where) {
  const out = [];
  const at = `${where} (hero ${g.hero}, player frame ${g.frame})`;
  if (g.bands.some((b) => b > 0.5)) out.push(`${at}: black bands top/bottom/left/right ${g.bands.map((b) => Math.max(0, Math.round(b))).join('/')} px`);
  if (g.zoom > 1.01) out.push(`${at}: the video is drawn ${g.zoom.toFixed(2)}x larger than needed to cover the hero`);
  if (g.above < 100 || g.below < 100) out.push(`${at}: the player frame reaches only ${Math.round(g.above)} px above and ${Math.round(g.below)} px below the hero (its title bar and logo show inside it)`);
  return out;
}

/** A stand-in page for the youtube-nocookie.com player (geometry tests: only the frame's box matters). */
const BLANK_PLAYER = '<!doctype html><html lang="en"><title>player</title></html>';

function formatBytes(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${(n / 1e3).toFixed(0)} kB`;
}

module.exports = {
  VIEWPORTS,
  VIEWPORT_NAMES,
  CONSENT_KEY,
  GOOGLE_HOST_RE,
  YOUTUBE_HOST_RE,
  HERO_PLAYER_RE,
  TILDA_HOST_RE,
  SCREEN_DIR,
  RUN_ID,
  NETWORK_PROFILES,
  hostOf,
  pathOf,
  samplePages,
  galleryArtwork,
  startEnv,
  newContext,
  trackPage,
  gotoPage,
  fontsReady,
  readDataLayer,
  findEvents,
  clickOn,
  storedConsent,
  bannerVisible,
  settleForScreenshot,
  ensureScreenDir,
  writeArtifact,
  clsFromShifts,
  PERF_OBSERVER_SCRIPT,
  heroVideoGeometry,
  heroVideoProblems,
  BLANK_PLAYER,
  formatBytes,
};
