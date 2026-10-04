'use strict';
// Motion and languages in the browser: smooth in-page scrolling, cross-document view transitions (the card image
// named "artwork-image" grows into the artwork's main image), fades when the artwork image switches and when lazy
// images load, all of it off with prefers-reduced-motion; the language switch (flag links) to the same page in the
// other language on desktop and phone; the German 404 page below /de/.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');
const B = require('../lib/browser');

const data = S.loadData();
const HUB = data.hubs[0];
const GALLERY = B.galleryArtwork(data);
const GALLERY_PATH = S.artworkPath(GALLERY.hub, GALLERY.artwork);

async function open(env, vp, p, motion = 'no-preference') {
  const ctx = await B.newContext(env, vp, { consent: 'denied', motion });
  const page = await ctx.newPage();
  const resp = await B.gotoPage(page, env.url(p));
  assert.equal(resp && resp.status(), 200, `HTTP ${resp && resp.status()} for ${p}`);
  return { ctx, page };
}

/* Click a link and record window.scrollY on every frame for a second: [values]. */
async function scrollTrace(page, selector) {
  await page.evaluate(() => {
    window.__trace = [];
    const start = performance.now();
    const step = () => {
      window.__trace.push(window.scrollY);
      if (performance.now() - start < 1500) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.locator(selector).first().click();
  await page.waitForTimeout(1700);
  return page.evaluate(() => window.__trace);
}

describe('motion: smooth scrolling, view transitions and fades (none with prefers-reduced-motion)', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  test(`Explore Artworks scrolls smoothly to #gallery-${HUB.key} (several frames in between, the address gets the hash); with reduced motion it jumps`, { timeout: 60000 }, async () => {
    const problems = [];
    for (const motion of ['no-preference', 'reduce']) {
      const { ctx, page } = await open(env, 'desktop', '/', motion);
      try {
        const trace = await scrollTrace(page, 'a.hero__cta');
        const end = trace[trace.length - 1];
        const between = new Set(trace.filter((y) => y > 0 && y < end - 1).map(Math.round)).size;
        const top = await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top, `gallery-${HUB.key}`);
        if (!(top > -10 && top < 200)) problems.push(`${motion}: #gallery-${HUB.key} ends at ${Math.round(top)} px`);
        if (motion === 'no-preference' && between < 3) problems.push(`no-preference: only ${between} scroll positions between start and end (not smooth)`);
        if (motion === 'reduce' && between > 1) problems.push(`reduce: ${between} positions between start and end (should jump)`);
        if (!page.url().endsWith(`#gallery-${HUB.key}`)) problems.push(`${motion}: the address is ${page.url()}`);
      } finally { await ctx.close(); }
    }
    expectNone(problems, 'in-page scrolling');
  });

  test('cross-document view transitions: the stylesheet opts in under no-preference only; a card click names the card image and the artwork main image "artwork-image"', { timeout: 60000 }, async () => {
    const problems = [];
    for (const motion of ['no-preference', 'reduce']) {
      const { ctx, page } = await open(env, 'desktop', `/${HUB.path}/`, motion);
      try {
        const rule = await page.evaluate(() => {
          const found = [];
          const visit = (rules, media) => {
            for (const r of rules) {
              if (r.cssRules && r.media) visit(r.cssRules, r.media.mediaText);
              else if (/^@view-transition/.test(r.cssText)) found.push({ media, text: r.cssText, active: matchMedia(media).matches });
            }
          };
          for (const sheet of document.styleSheets) visit(sheet.cssRules, 'all');
          return found;
        });
        if (rule.length !== 1 || !/navigation:\s*auto/.test(rule[0].text) || !/prefers-reduced-motion:\s*no-preference/.test(rule[0].media)) problems.push(`${motion}: @view-transition rule ${JSON.stringify(rule)}`);
        else if (rule[0].active !== (motion === 'no-preference')) problems.push(`${motion}: @view-transition is ${rule[0].active ? 'active' : 'inactive'}`);
        const target = S.artworkPath(HUB, HUB.artworks[1]);
        await page.evaluate(() => {
          window.addEventListener('pageswap', () => {
            const named = [...document.querySelectorAll('.card__img')].filter((el) => el.style.viewTransitionName === 'artwork-image');
            sessionStorage.setItem('named', String(named.length));
          });
        });
        await Promise.all([page.waitForURL((u) => u.pathname === target), page.locator(`a.card__link[href="${target}"]`).click()]);
        await page.waitForLoadState('load');
        const named = await page.evaluate(() => sessionStorage.getItem('named'));
        const main = await page.evaluate(() => getComputedStyle(document.querySelector('.artwork__main > picture:not([hidden])')).viewTransitionName);
        if (motion === 'no-preference') {
          // Chromium fires pageswap with a view transition for this same-origin navigation
          if (named !== '1') problems.push(`no-preference: ${named} card images were named on the way out, expected 1`);
          if (main !== 'artwork-image') problems.push(`no-preference: the artwork main image has view-transition-name ${main}`);
        } else {
          if (named === '1') problems.push('reduce: a card image was named although there is no transition');
          if (main !== 'none') problems.push(`reduce: the artwork main image has view-transition-name ${main}`);
        }
      } finally { await ctx.close(); }
    }
    expectNone(problems, 'view transitions');
  });

  test(`${GALLERY_PATH}: switching the image fades the new one in (also in the full-screen view); with reduced motion no animation runs`, { timeout: 60000 }, async () => {
    const problems = [];
    for (const motion of ['no-preference', 'reduce']) {
      const { ctx, page } = await open(env, 'desktop', GALLERY_PATH, motion);
      try {
        await B.clickOn(page, 'button.artwork__next', 'next image');
        const anims = await page.evaluate(() => document.querySelector('.artwork__main > picture:not([hidden])').getAnimations().length);
        await B.clickOn(page, 'button.artwork__zoom', 'full-screen view');
        await page.locator('#artwork-zoom .zoom__stage img').waitFor({ state: 'visible', timeout: 5000 });
        await page.keyboard.press('ArrowRight');
        const zoomAnims = await page.evaluate(() => document.querySelector('#artwork-zoom .zoom__picture').getAnimations().length);
        const want = motion === 'no-preference' ? 1 : 0;
        if (anims !== want) problems.push(`${motion}: ${anims} animations on the new main image, expected ${want}`);
        if (zoomAnims !== want) problems.push(`${motion}: ${zoomAnims} animations on the new full-screen image, expected ${want}`);
        await page.waitForTimeout(400);
        const opacity = await page.evaluate(() => getComputedStyle(document.querySelector('#artwork-zoom .zoom__picture')).opacity);
        if (opacity !== '1') problems.push(`${motion}: the full-screen image ends at opacity ${opacity}`);
      } finally { await ctx.close(); }
    }
    expectNone(problems, 'image switching');
  });

  test('lazy images fade in when they load (an opacity animation, no CSS transition); with reduced motion they appear at once', { timeout: 60000 }, async () => {
    const problems = [];
    for (const motion of ['no-preference', 'reduce']) {
      const ctx = await B.newContext(env, 'desktop', { consent: 'denied', motion });
      try {
        // the images load slowly, so the script sees them before they are complete
        await ctx.route(/\/img\/gallery\//, async (r) => { await new Promise((res) => setTimeout(res, 400)); await r.continue(); });
        const page = await ctx.newPage();
        await page.goto(env.url('/'), { waitUntil: 'load' });
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
        await page.waitForTimeout(1500);
        const r = await page.evaluate(() => ({
          faded: document.querySelectorAll('img.img-faded').length,
          transparent: [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth && getComputedStyle(i).opacity !== '1').length,
        }));
        if (motion === 'no-preference' && r.faded === 0) problems.push('no-preference: no lazy image faded in');
        if (motion === 'reduce' && r.faded !== 0) problems.push(`reduce: ${r.faded} images faded in`);
        if (r.transparent) problems.push(`${motion}: ${r.transparent} loaded images are not fully opaque after the fade`);
      } finally { await ctx.close(); }
    }
    expectNone(problems, 'image fade-in');
  });
});

describe('languages: switch and German 404', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const vp of B.VIEWPORT_NAMES) {
    test(`${vp}: the flag link switches to the same page in the other language and back (artwork, hub, home)`, { timeout: 90000 }, async () => {
      const problems = [];
      const ctx = await B.newContext(env, vp, { consent: 'denied' });
      try {
        const page = await ctx.newPage();
        for (const p of [GALLERY_PATH, `/${HUB.path}/`, '/about/']) {
          await B.gotoPage(page, env.url(p));
          await Promise.all([page.waitForURL((u) => u.pathname === `/de${p}`), page.locator('#site-nav a.site-nav__lang[hreflang="de"]:visible').click()]);
          if ((await page.getAttribute('html', 'lang')) !== 'de') problems.push(`/de${p}: lang is not de`);
          if (vp === 'mobile' && await page.locator('#site-nav a.site-nav__lang[hreflang="de"]:visible').count()) problems.push(`/de${p}: the current flag is shown on the phone (only the other one, in the link row)`);
          await Promise.all([page.waitForURL((u) => u.pathname === p), page.locator('#site-nav a.site-nav__lang[hreflang="en"]:visible').click()]);
          if ((await page.getAttribute('html', 'lang')) !== 'en') problems.push(`${p}: lang is not en after switching back`);
        }
      } finally { await ctx.close(); }
      expectNone(problems, 'language switch');
    });
  }

  test('/de/<unknown> answers 404 with the German page (lang="de", "Seite nicht gefunden"); /<unknown> with the English one', { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'desktop', { consent: 'denied' });
    try {
      const page = await ctx.newPage();
      const problems = [];
      for (const [p, lang, h1] of [['/de/gibt-es-nicht/', 'de', 'Seite nicht gefunden'], ['/no-such-page/', 'en', 'Page not found']]) {
        const resp = await page.goto(env.url(p));
        if (!resp || resp.status() !== 404) problems.push(`${p}: HTTP ${resp && resp.status()}`);
        if ((await page.getAttribute('html', 'lang')) !== lang) problems.push(`${p}: lang is not ${lang}`);
        if ((await page.locator('h1').innerText()).trim() !== h1) problems.push(`${p}: h1 is not "${h1}"`);
      }
      expectNone(problems, '404 pages');
    } finally { await ctx.close(); }
  });
});
