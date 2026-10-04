'use strict';
// SPEC browser 12.9: axe-core on every page type at both viewports. No critical or serious violation may remain.
// color-contrast findings are printed as warnings only (the colours are kept from the current design).
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { AxeBuilder } = require('@axe-core/playwright');
const { expectNone } = require('../lib/checks');
const B = require('../lib/browser');

const PAGES = B.samplePages();
const WARN_ONLY = new Set(['color-contrast']);
const warnings = {};

describe('browser 9: accessibility (axe-core)', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => {
    if (Object.keys(warnings).length) B.writeArtifact('axe-warnings.json', warnings);
    if (env) await env.close();
  });

  for (const vp of B.VIEWPORT_NAMES) {
    for (const p of PAGES) {
      test(`${vp} ${p.label} ${p.path}: no critical or serious axe violations (color-contrast is a warning)`, { timeout: 120000 }, async (t) => {
        const ctx = await B.newContext(env, vp);
        try {
          const page = await ctx.newPage();
          const resp = await B.gotoPage(page, env.url(p.path));
          assert.equal(resp && resp.status(), 200, `HTTP ${resp && resp.status()} for ${p.path}`);
          await page.waitForTimeout(300);
          const result = await new AxeBuilder({ page }).analyze();
          const severe = result.violations.filter((v) => (v.impact === 'critical' || v.impact === 'serious') && !WARN_ONLY.has(v.id));
          const warn = result.violations.filter((v) => WARN_ONLY.has(v.id));
          for (const v of warn) {
            const targets = v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')}${n.any && n.any[0] && n.any[0].data ? ` (${n.any[0].data.contrastRatio}:1, ${n.any[0].data.fgColor} on ${n.any[0].data.bgColor})` : ''}`);
            t.diagnostic(`warning ${v.id} (${v.impact}) on ${v.nodes.length} element(s): ${targets.join('; ')}`);
            warnings[`${vp} ${p.path}`] = (warnings[`${vp} ${p.path}`] || []).concat(targets);
          }
          expectNone(severe.map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} element(s), e.g. ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), `axe violations on ${p.path} at ${vp}`);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});

describe('browser 9b: keyboard, link names, contrast themes and no JavaScript', () => {
  const S = require('../lib/site');
  const data = S.loadData();
  const art = S.allArtworks(data);
  const privateWork = art.find((x) => x.artwork.status === 'private-collection');
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const vp of B.VIEWPORT_NAMES) {
    test(`${vp}: the first Tab stop is a visible "Skip to content" link; Enter moves on to the main content`, { timeout: 60000 }, async () => {
      const ctx = await B.newContext(env, vp, { consent: 'denied' });
      try {
        const page = await ctx.newPage();
        await B.gotoPage(page, env.url(S.artworkPath(art[0].hub, art[0].artwork)), { idle: false });
        await page.keyboard.press('Tab');
        const skip = await page.evaluate(() => {
          const a = document.activeElement;
          const b = a.getBoundingClientRect();
          return { cls: a.className, href: a.getAttribute('href'), text: a.textContent.trim(), inView: b.top >= 0 && b.bottom <= innerHeight && b.width > 0 };
        });
        assert.equal(skip.cls, 'skip-link', `the first Tab stop is ${JSON.stringify(skip)}`);
        assert.ok(skip.inView, 'the focused skip link is not visible');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');
        const next = await page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest('main')));
        assert.ok(next, 'after the skip link, Tab should go to the first control in <main>');
      } finally { await ctx.close(); }
    });
  }

  test('card links are named by the title (plus "Private collection"), not by the image alt, title and MORE', { timeout: 60000 }, async () => {
    const ctx = await B.newContext(env, 'desktop', { consent: 'denied' });
    try {
      const page = await ctx.newPage();
      await B.gotoPage(page, env.url('/'), { idle: false });
      const problems = [];
      for (const { artwork } of [art[0], art[1], privateWork]) {
        const name = artwork.status === 'private-collection' ? `${artwork.title} Private collection` : artwork.title;
        const n = await page.getByRole('link', { name, exact: true }).count();
        if (n !== 1) problems.push(`${n} links named exactly "${name}"`);
      }
      expectNone(problems, 'card link names');
    } finally { await ctx.close(); }
  });

  test('forced colours (Windows contrast themes): both consent buttons keep a visible border', { timeout: 60000 }, async () => {
    const ctx = await env.browser.newContext({ viewport: { width: 1366, height: 900 }, forcedColors: 'active' });
    try {
      await ctx.route((url) => !env.isLocal(url.href), (r) => r.abort('blockedbyclient'));
      const page = await ctx.newPage();
      await B.gotoPage(page, env.url('/'), { idle: false });
      await page.locator('#cookie-consent').waitFor({ state: 'visible', timeout: 5000 });
      const borders = await page.evaluate(() => ['cookie-accept', 'cookie-decline'].map((id) => {
        const st = getComputedStyle(document.getElementById(id));
        return { id, width: parseFloat(st.borderTopWidth), style: st.borderTopStyle, color: st.borderTopColor };
      }));
      expectNone(borders.filter((b) => !(b.width >= 1 && b.style !== 'none' && !/rgba\(0, 0, 0, 0\)|transparent/.test(b.color))).map((b) => `#${b.id}: border ${b.width}px ${b.style} ${b.color}`), 'consent buttons without a visible border in forced colours');
    } finally { await ctx.close(); }
  });

  for (const p of ['/', S.artworkPath(art[0].hub, art[0].artwork)]) {
    test(`without JavaScript ${p}: no control that needs it is shown (Cookie settings, play, full-screen view)`, { timeout: 60000 }, async () => {
      const ctx = await env.browser.newContext({ viewport: { width: 1366, height: 900 }, javaScriptEnabled: false });
      try {
        await ctx.route((url) => !env.isLocal(url.href), (r) => r.abort('blockedbyclient'));
        const page = await ctx.newPage();
        await B.gotoPage(page, env.url(p), { idle: false });
        const shown = [];
        for (const sel of ['#cookie-settings', '.hero__play', '.artwork__zoom', '#cookie-consent']) {
          if (await page.locator(sel).first().isVisible().catch(() => false)) shown.push(sel);
        }
        expectNone(shown, `controls without a function shown without JavaScript on ${p}`);
      } finally { await ctx.close(); }
    });
  }
});
