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
