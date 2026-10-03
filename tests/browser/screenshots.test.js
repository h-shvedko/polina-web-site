'use strict';
// SPEC browser 12.11: full-page screenshots of every page type at both viewports, for the visual comparison
// with the current site. Files: $SCREEN_DIR/<viewport>-<page key>.png (consent declined, lazy images loaded),
// plus <viewport>-home-first-visit.png (first screen with the consent banner) and index.json.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../lib/browser');

const PAGES = [...B.samplePages(), { key: '404', label: '404', type: '404', path: '/this-page-does-not-exist/' }];
const index = {};

describe('browser 11: screenshots', () => {
  let env;
  before(async () => {
    env = await B.startEnv();
    B.ensureScreenDir();
    console.log(`screenshots go to ${B.SCREEN_DIR}`);
  });
  after(async () => {
    if (Object.keys(index).length) B.writeArtifact('index.json', index);
    if (env) await env.close();
  });

  for (const vp of B.VIEWPORT_NAMES) {
    for (const p of PAGES) {
      test(`${vp} ${p.label} ${p.path}: full-page screenshot saved to $SCREEN_DIR/${vp}-${p.key}.png`, { timeout: 120000 }, async (t) => {
        const ctx = await B.newContext(env, vp, { consent: 'denied' });
        try {
          const page = await ctx.newPage();
          const resp = await B.gotoPage(page, env.url(p.path));
          await B.settleForScreenshot(page);
          const file = path.join(B.SCREEN_DIR, `${vp}-${p.key}.png`);
          await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
          const status = resp ? resp.status() : null;
          index[`${vp}-${p.key}`] = { file: path.basename(file), path: p.path, status, bytes: fs.statSync(file).size };
          t.diagnostic(file);
          assert.ok(fs.statSync(file).size > 1000, `${file} is empty`);
          const want = p.type === '404' ? 404 : 200;
          assert.equal(status, want, `HTTP ${status} for ${p.path} (the screenshot shows ${status === 404 ? 'the 404 response' : 'an unexpected page'})`);
          if (p.type === '404') {
            const h1 = (await page.locator('h1').allTextContents()).map((x) => x.trim());
            assert.ok(h1.includes('Page not found'), `the custom 404 page (h1 "Page not found") is not served; h1: ${JSON.stringify(h1)}`);
          }
        } finally {
          await ctx.close();
        }
      });
    }

    test(`${vp} home: first-visit screenshot with the consent banner saved to $SCREEN_DIR/${vp}-home-first-visit.png`, { timeout: 60000 }, async (t) => {
      const ctx = await B.newContext(env, vp);
      try {
        const page = await ctx.newPage();
        await B.gotoPage(page, env.url('/'));
        await page.evaluate(() => (document.fonts && document.fonts.ready) || null);
        await page.waitForTimeout(500);
        const file = path.join(B.SCREEN_DIR, `${vp}-home-first-visit.png`);
        await page.screenshot({ path: file, animations: 'disabled' });
        index[`${vp}-home-first-visit`] = { file: path.basename(file), path: '/', bytes: fs.statSync(file).size };
        t.diagnostic(file);
        assert.ok(await B.bannerVisible(page), 'the consent banner is not visible on the first visit');
      } finally {
        await ctx.close();
      }
    });
  }
});
