'use strict';
// SPEC browser 12.1 (every page type loads cleanly) and 12.10 (custom 404).
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { expectNone } = require('../lib/checks');
const B = require('../lib/browser');

const PAGES = B.samplePages();

describe('browser 1: every page type loads without errors and without third-party requests', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const vp of B.VIEWPORT_NAMES) {
    for (const p of PAGES) {
      test(`${vp} ${p.label} ${p.path}: HTTP 200, no console errors, no failed local requests, no Tilda/Google/third-party request before consent`, { timeout: 120000 }, async () => {
        const ctx = await B.newContext(env, vp);
        try {
          const page = await ctx.newPage();
          const rec = B.trackPage(page, env);
          const resp = await B.gotoPage(page, env.url(p.path));
          await page.waitForTimeout(500);
          const problems = [];
          if (!resp || resp.status() !== 200) problems.push(`HTTP ${resp ? resp.status() : 'no response'} for ${p.path}`);
          problems.push(...rec.pageErrors.map((e) => `uncaught exception: ${e}`));
          // the browser logs the page's own 404 as a console error; it is reported once above
          problems.push(...rec.consoleErrors.filter((e) => !(resp && resp.status() >= 400 && e.startsWith('Failed to load resource') && e.endsWith(`(${p.path})`))).map((e) => `console error: ${e}`));
          problems.push(...rec.failedLocal.map((e) => `failed local request: ${e}`));
          for (const r of rec.external()) {
            if (B.TILDA_HOST_RE.test(r.host)) problems.push(`request to a Tilda host: ${r.url}`);
            else if (B.GOOGLE_HOST_RE.test(r.host)) problems.push(`request to Google before consent: ${r.url}`);
            else problems.push(`third-party request before consent: ${r.url}`);
          }
          expectNone(problems, `${p.path} at ${vp}`);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});

describe('browser 10: unknown URLs get the custom 404 page', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const path of ['/this-page-does-not-exist/', '/oil-paintings/no-such-artwork/']) {
    test(`${path} returns status 404 with the custom page (h1 "Page not found", noindex) and its CSS/JS load from the nested path`, { timeout: 60000 }, async () => {
      const ctx = await B.newContext(env, 'desktop');
      try {
        const page = await ctx.newPage();
        const rec = B.trackPage(page, env);
        const resp = await B.gotoPage(page, env.url(path));
        assert.equal(resp && resp.status(), 404, `status ${resp && resp.status()} for ${path}`);
        const h1 = (await page.locator('h1').allTextContents()).map((s) => s.trim());
        const robots = await page.evaluate(() => { const m = document.querySelector('meta[name="robots"]'); return m ? m.getAttribute('content') : null; });
        const sheets = await page.evaluate(() => [...document.styleSheets].filter((s) => s.href).length);
        const problems = [];
        if (h1.length !== 1 || h1[0] !== 'Page not found') problems.push(`h1 is ${JSON.stringify(h1)}, expected ["Page not found"]`);
        if (!robots || !/noindex/i.test(robots)) problems.push(`robots meta is ${JSON.stringify(robots)}, expected noindex`);
        if (!sheets) problems.push('no stylesheet loaded: the custom 404 page is missing or uses relative asset URLs');
        problems.push(...rec.failedLocal.map((e) => `failed local request: ${e}`));
        problems.push(...rec.pageErrors.map((e) => `uncaught exception: ${e}`));
        expectNone(problems, `404 page at ${path}`);
      } finally {
        await ctx.close();
      }
    });
  }
});
