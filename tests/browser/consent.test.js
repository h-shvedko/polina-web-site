'use strict';
// SPEC browser 12.2 (consent banner, GA only after Accept) and 12.5 (contact tracking), behaviour from SPEC 9.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');
const B = require('../lib/browser');

const data = S.loadData();
const GA_ID = data.site.ga_measurement_id;
const PAGES = B.samplePages(data);
const HOME = '/';
const ARTWORK = PAGES.find((p) => p.type === 'artwork') || { path: '/oil-paintings/affectionate-farewell-cap-dantibes/', artwork: { slug: 'affectionate-farewell-cap-dantibes' } };

async function expectBanner(page, visible, where) {
  const ok = await page.locator('#cookie-consent').waitFor({ state: visible ? 'visible' : 'hidden', timeout: 5000 }).then(() => true, () => false);
  assert.ok(ok, `${where}: consent banner #cookie-consent should be ${visible ? 'visible' : 'hidden'}`);
}

function consentCalls(dl) {
  return dl.map((e, i) => ({ e, i })).filter(({ e }) => Array.isArray(e) && e[0] === 'consent');
}

describe('browser 2: consent banner and Google Analytics', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const vp of B.VIEWPORT_NAMES) {
    for (const p of PAGES) {
      test(`${vp} ${p.label} ${p.path}: first visit shows the banner with Accept and Decline, nothing is sent to Google`, { timeout: 60000 }, async () => {
        const ctx = await B.newContext(env, vp);
        try {
          const page = await ctx.newPage();
          const rec = B.trackPage(page, env);
          const resp = await B.gotoPage(page, env.url(p.path));
          assert.equal(resp && resp.status(), 200, `HTTP ${resp && resp.status()} for ${p.path}`);
          await page.locator('#cookie-consent').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
          const problems = [];
          if (!(await B.bannerVisible(page))) problems.push('consent banner #cookie-consent is not visible on the first visit');
          for (const id of ['#cookie-consent #cookie-accept', '#cookie-consent #cookie-decline']) {
            if (!(await page.locator(id).isVisible().catch(() => false))) problems.push(`${id} is not visible`);
          }
          problems.push(...rec.google().map((r) => `request to Google before consent: ${r.url}`));
          expectNone(problems, `first visit of ${p.path} at ${vp}`);
        } finally {
          await ctx.close();
        }
      });
    }
  }

  test('Decline hides the banner, stores cookie_consent_v2=denied, stays hidden after reload and never loads Google', { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'desktop');
    try {
      const page = await ctx.newPage();
      const rec = B.trackPage(page, env);
      await B.gotoPage(page, env.url(HOME));
      await expectBanner(page, true, 'first visit');
      await B.clickOn(page, '#cookie-decline', 'Decline button');
      await expectBanner(page, false, 'after Decline');
      assert.equal(await B.storedConsent(page), 'denied', `localStorage ${B.CONSENT_KEY}`);
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(500);
      await expectBanner(page, false, 'after reload');
      const next = await B.gotoPage(page, env.url(ARTWORK.path));
      assert.equal(next && next.status(), 200, `HTTP ${next && next.status()} for ${ARTWORK.path}`);
      await page.waitForTimeout(300);
      await expectBanner(page, false, 'on the next page');
      const status = await page.evaluate(() => (window.siteConsent && typeof window.siteConsent.status === 'function' ? window.siteConsent.status() : 'no window.siteConsent'));
      assert.equal(status, 'denied', 'window.siteConsent.status()');
      expectNone(rec.google().map((r) => r.url), 'requests to Google after Decline');
    } finally {
      await ctx.close();
    }
  });

  test(`Accept loads gtag.js?id=${GA_ID} once; dataLayer gets consent default (all denied), then update analytics_storage=granted, js and config`, { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'desktop');
    try {
      const page = await ctx.newPage();
      const rec = B.trackPage(page, env);
      await B.gotoPage(page, env.url(HOME));
      await expectBanner(page, true, 'first visit');
      const before = rec.mark();
      expectNone(rec.google().map((r) => r.url), 'requests to Google before Accept');
      await B.clickOn(page, '#cookie-accept', 'Accept button');
      await page.waitForRequest((r) => /googletagmanager\.com\/gtag\/js/.test(r.url()), { timeout: 5000 }).catch(() => null);
      await page.waitForTimeout(500);
      await expectBanner(page, false, 'after Accept');
      const gtag = rec.gtag(before);
      assert.equal(gtag.length, 1, `gtag.js requests after Accept: ${gtag.length} (${gtag.map((r) => r.url).join(', ')})`);
      assert.equal(new URL(gtag[0].url).searchParams.get('id'), GA_ID, `gtag.js id in ${gtag[0].url}`);
      assert.equal(await B.storedConsent(page), 'granted', `localStorage ${B.CONSENT_KEY}`);
      const dl = await B.readDataLayer(page);
      const calls = consentCalls(dl);
      const def = calls.find(({ e }) => e[1] === 'default');
      const upd = calls.find(({ e }) => e[1] === 'update' && e[2] && e[2].analytics_storage === 'granted');
      const problems = [];
      if (!def) problems.push(`no gtag('consent','default', ...) in dataLayer: ${JSON.stringify(dl).slice(0, 300)}`);
      else for (const k of ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']) if (!def.e[2] || def.e[2][k] !== 'denied') problems.push(`consent default ${k} is ${JSON.stringify(def.e[2] && def.e[2][k])}, expected "denied"`);
      if (!upd) problems.push("no gtag('consent','update',{analytics_storage:'granted'}) in dataLayer");
      if (def && upd && upd.i < def.i) problems.push('consent update comes before consent default');
      if (!dl.some((e) => Array.isArray(e) && e[0] === 'js')) problems.push("no gtag('js', new Date()) in dataLayer");
      if (!dl.some((e) => Array.isArray(e) && e[0] === 'config' && e[1] === GA_ID)) problems.push(`no gtag('config', '${GA_ID}') in dataLayer`);
      const status = await page.evaluate(() => (window.siteConsent && typeof window.siteConsent.status === 'function' ? window.siteConsent.status() : 'no window.siteConsent'));
      if (status !== 'granted') problems.push(`window.siteConsent.status() is ${JSON.stringify(status)}`);
      expectNone(problems, 'consent mode problems');
    } finally {
      await ctx.close();
    }
  });

  test('after Accept, the next page loads gtag.js without showing the banner', { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'mobile');
    try {
      const page = await ctx.newPage();
      const rec = B.trackPage(page, env);
      await B.gotoPage(page, env.url(HOME));
      await expectBanner(page, true, 'first visit');
      await B.clickOn(page, '#cookie-accept', 'Accept button');
      await page.waitForTimeout(500);
      const before = rec.mark();
      const resp = await B.gotoPage(page, env.url(ARTWORK.path));
      assert.equal(resp && resp.status(), 200, `HTTP ${resp && resp.status()} for ${ARTWORK.path}`);
      await page.waitForTimeout(500);
      await expectBanner(page, false, 'later visit with consent');
      assert.equal(rec.gtag(before).length, 1, 'gtag.js should load once on the next page');
    } finally {
      await ctx.close();
    }
  });

  test('#cookie-settings reopens the banner; switching to Decline deletes _ga cookies and stops GA on the next page', { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'desktop');
    try {
      const page = await ctx.newPage();
      const rec = B.trackPage(page, env);
      await B.gotoPage(page, env.url(HOME));
      await expectBanner(page, true, 'first visit');
      await B.clickOn(page, '#cookie-accept', 'Accept button');
      await expectBanner(page, false, 'after Accept');
      await ctx.addCookies([
        { name: '_ga', value: 'GA1.1.123.456', url: env.base },
        { name: `_ga_${GA_ID.replace(/^G-/, '')}`, value: 'GS1.1.1.1.0.1.0.0', url: env.base },
        { name: 'other', value: 'keep', url: env.base },
      ]);
      await B.clickOn(page, '#cookie-settings', 'footer cookie settings button');
      await expectBanner(page, true, 'after clicking #cookie-settings');
      await B.clickOn(page, '#cookie-decline', 'Decline button');
      await expectBanner(page, false, 'after Decline');
      assert.equal(await B.storedConsent(page), 'denied', `localStorage ${B.CONSENT_KEY}`);
      const left = (await ctx.cookies(env.base)).map((c) => c.name);
      expectNone(left.filter((n) => n.startsWith('_ga')), '_ga cookies not deleted after switching to Decline');
      assert.ok(left.includes('other'), 'unrelated cookies must stay');
      const before = rec.mark();
      const resp = await B.gotoPage(page, env.url(ARTWORK.path));
      assert.equal(resp && resp.status(), 200, `HTTP ${resp && resp.status()} for ${ARTWORK.path}`);
      await page.waitForTimeout(500);
      expectNone(rec.google(before).map((r) => r.url), 'Google requests on the next page after switching to Decline');
      await expectBanner(page, false, 'next page');
      const opened = await page.evaluate(() => {
        if (!window.siteConsent || typeof window.siteConsent.open !== 'function') return 'no window.siteConsent.open';
        window.siteConsent.open();
        return 'ok';
      });
      assert.equal(opened, 'ok');
      await expectBanner(page, true, 'after window.siteConsent.open()');
    } finally {
      await ctx.close();
    }
  });
});

describe('browser 5: contact tracking', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  test('before Accept: clicking the artwork CTA sends nothing to Google and pushes no contact_click', { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'desktop');
    try {
      const page = await ctx.newPage();
      const rec = B.trackPage(page, env);
      const resp = await B.gotoPage(page, env.url(ARTWORK.path));
      assert.equal(resp && resp.status(), 200, `HTTP ${resp && resp.status()} for ${ARTWORK.path}`);
      await B.clickOn(page, 'a.artwork__cta', 'artwork CTA');
      await page.waitForTimeout(500);
      const dl = await B.readDataLayer(page);
      expectNone(B.findEvents(dl, 'contact_click').map((e) => JSON.stringify(e)), 'contact_click pushed before consent');
      expectNone(rec.google().map((r) => r.url), 'requests to Google before consent');
    } finally {
      await ctx.close();
    }
  });

  test('after Accept: clicking the artwork CTA pushes contact_click with artwork_slug and link_location "artwork"', { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'mobile');
    try {
      const page = await ctx.newPage();
      const resp = await B.gotoPage(page, env.url(ARTWORK.path));
      assert.equal(resp && resp.status(), 200, `HTTP ${resp && resp.status()} for ${ARTWORK.path}`);
      await B.clickOn(page, '#cookie-accept', 'Accept button');
      await page.waitForTimeout(300);
      await B.clickOn(page, 'a.artwork__cta', 'artwork CTA');
      await page.waitForTimeout(300);
      const events = B.findEvents(await B.readDataLayer(page), 'contact_click');
      assert.equal(events.length, 1, `contact_click events: ${JSON.stringify(events)}`);
      const params = events[0][2] || {};
      assert.equal(params.artwork_slug, ARTWORK.artwork.slug, `artwork_slug in ${JSON.stringify(params)}`);
      assert.equal(params.link_location, 'artwork', `link_location in ${JSON.stringify(params)}`);
    } finally {
      await ctx.close();
    }
  });

  test('after Accept: the contact page email link pushes contact_click with link_location "contact"', { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'desktop', { consent: 'granted' });
    try {
      const page = await ctx.newPage();
      const resp = await B.gotoPage(page, env.url('/contact/'));
      assert.equal(resp && resp.status(), 200, `HTTP ${resp && resp.status()} for /contact/`);
      await B.clickOn(page, 'a[href^="mailto:"][data-location="contact"]', 'contact page email link');
      await page.waitForTimeout(300);
      const events = B.findEvents(await B.readDataLayer(page), 'contact_click');
      assert.equal(events.length, 1, `contact_click events: ${JSON.stringify(events)}`);
      assert.equal((events[0][2] || {}).link_location, 'contact');
      assert.ok(!('artwork_slug' in (events[0][2] || {})), 'no artwork_slug outside artwork pages');
    } finally {
      await ctx.close();
    }
  });
});
