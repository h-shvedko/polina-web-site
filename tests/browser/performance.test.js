'use strict';
// SPEC browser 12.8: budgets on load without scrolling: home < 3 MB and artwork page < 1.5 MB (sum of response
// bodies, 1 MB = 1,000,000 bytes) at both viewports; LCP < 2.5 s at 390 px; CLS < 0.1. The measured numbers are
// printed as test diagnostics and written to $SCREEN_DIR/performance.json.
//
// LCP is measured with network throttling (LCP_NETWORK, default "fast4g" = Chrome DevTools "Fast 4G":
// 9 Mbit/s, 165 ms latency); without throttling a local server makes every page fast. It is measured on the
// SPEC phone (390 px, DPR 3) and on Lighthouse's mobile emulation (412 px, DPR 1.75: the lab data of PageSpeed
// Insights), where the images take other srcset variants.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { expectNone } = require('../lib/checks');
const B = require('../lib/browser');

const BUDGET = { home: 3e6, artwork: 1.5e6 };
const CLS_MAX = 0.1;
const LCP_MAX = 2500;
const NETWORK = process.env.LCP_NETWORK || 'fast4g';
const PAGES = B.samplePages().filter((p) => p.type === 'home' || p.type === 'artwork');
const LCP_PHONES = {
  mobile: 'mobile',
  'Lighthouse phone': { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true },
};
const results = {};

async function measureLoad(env, vp, p) {
  const ctx = await B.newContext(env, vp);
  await ctx.addInitScript(B.PERF_OBSERVER_SCRIPT);
  try {
    const page = await ctx.newPage();
    const responses = [];
    const pending = [];
    page.on('requestfinished', (r) => {
      pending.push(r.sizes().then((s) => responses.push({ url: B.pathOf(r.url()), bytes: s.responseBodySize })).catch(() => {}));
    });
    const resp = await page.goto(env.url(p.path), { waitUntil: 'load', timeout: 120000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await Promise.all(pending);
    const perf = await page.evaluate(() => window.__perf || null);
    const bytes = responses.reduce((sum, r) => sum + (r.bytes > 0 ? r.bytes : 0), 0);
    const largest = [...responses].sort((a, b) => b.bytes - a.bytes).slice(0, 5).map((r) => `${B.formatBytes(r.bytes)} ${r.url}`);
    const shifts = (perf && perf.shifts) || [];
    return { status: resp ? resp.status() : null, bytes, requests: responses.length, largest, cls: B.clsFromShifts(shifts), shifts, lcp: perf && perf.lcp };
  } finally {
    await ctx.close();
  }
}

async function measureLcp(env, p, profileName, phone = 'mobile') {
  const profile = B.NETWORK_PROFILES[profileName];
  if (profile === undefined) throw new Error(`Unknown LCP_NETWORK "${profileName}" (use ${Object.keys(B.NETWORK_PROFILES).join(', ')})`);
  const ctx = await B.newContext(env, phone);
  await ctx.addInitScript(B.PERF_OBSERVER_SCRIPT);
  try {
    const page = await ctx.newPage();
    if (profile) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', profile);
    }
    const resp = await page.goto(env.url(p.path), { waitUntil: 'domcontentloaded', timeout: 120000 });
    let last = null;
    let lastChange = Date.now();
    const started = Date.now();
    let perf = null;
    while (Date.now() - started < 25000) {
      await page.waitForTimeout(250);
      perf = await page.evaluate(() => window.__perf || null);
      const cur = perf && perf.lcp ? perf.lcp.t : null;
      if (cur !== last) { last = cur; lastChange = Date.now(); }
      if (perf && perf.loadAt !== null && cur !== null && Date.now() - lastChange > 1500) break;
    }
    return { status: resp ? resp.status() : null, lcp: perf && perf.lcp, loaded: !!(perf && perf.loadAt !== null), cls: B.clsFromShifts((perf && perf.shifts) || []), shifts: (perf && perf.shifts) || [] };
  } finally {
    await ctx.close();
  }
}

describe('browser 8: page weight, LCP and CLS', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => {
    if (Object.keys(results).length) {
      const file = B.writeArtifact('performance.json', results);
      console.log(`performance numbers written to ${file}`);
    }
    if (env) await env.close();
  });

  for (const vp of B.VIEWPORT_NAMES) {
    for (const p of PAGES) {
      const budget = BUDGET[p.type];
      test(`${vp} ${p.path}: transferred on load without scrolling < ${budget / 1e6} MB and CLS < ${CLS_MAX}`, { timeout: 180000 }, async (t) => {
        const m = await measureLoad(env, vp, p);
        results[`${vp} ${p.path} load`] = { status: m.status, bytes: m.bytes, requests: m.requests, cls: Number(m.cls.toFixed(4)), largest: m.largest };
        t.diagnostic(`${vp} ${p.path}: ${B.formatBytes(m.bytes)} in ${m.requests} responses (budget ${B.formatBytes(budget)}), CLS ${m.cls.toFixed(3)}`);
        const problems = [];
        if (m.status !== 200) problems.push(`HTTP ${m.status} for ${p.path}`);
        if (m.bytes >= budget) problems.push(`${B.formatBytes(m.bytes)} transferred, budget ${B.formatBytes(budget)}; largest: ${m.largest.join(', ')}`);
        if (m.cls >= CLS_MAX) problems.push(`CLS ${m.cls.toFixed(3)} >= ${CLS_MAX}; shifts: ${m.shifts.slice(0, 5).map((s) => `${s.v.toFixed(3)} at ${Math.round(s.t)} ms (${s.sources.join(', ')})`).join('; ')}`);
        expectNone(problems, `${vp} ${p.path}`);
      });
    }
  }

  for (const [phoneName, phone] of Object.entries(LCP_PHONES)) {
    for (const p of PAGES) {
      test(`${phoneName} ${p.path}: LCP < ${LCP_MAX / 1000} s and CLS < ${CLS_MAX} with the "${NETWORK}" network profile`, { timeout: 180000 }, async (t) => {
        const m = await measureLcp(env, p, NETWORK, phone);
        results[`${phoneName} ${p.path} lcp (${NETWORK})`] = { status: m.status, lcp_ms: m.lcp ? Math.round(m.lcp.t) : null, lcp_element: m.lcp && m.lcp.el, lcp_url: m.lcp && m.lcp.url, loaded: m.loaded, cls: Number(m.cls.toFixed(4)) };
        t.diagnostic(`${phoneName} ${p.path} (${NETWORK}): LCP ${m.lcp ? `${Math.round(m.lcp.t)} ms on ${m.lcp.el}${m.lcp.url ? ` ${B.pathOf(m.lcp.url)}` : ''}` : 'none'}, CLS ${m.cls.toFixed(3)}${m.loaded ? '' : ', load event not reached in 25 s'}`);
        assert.equal(m.status, 200, `HTTP ${m.status} for ${p.path}`);
        const problems = [];
        if (!m.loaded) problems.push(`the load event did not fire within 25 s on the "${NETWORK}" network, so LCP is not final (page too heavy; last candidate ${m.lcp ? `${Math.round(m.lcp.t)} ms on ${m.lcp.el}` : 'none'})`);
        if (!m.lcp) problems.push('no largest-contentful-paint entry');
        else if (m.lcp.t >= LCP_MAX) problems.push(`LCP ${Math.round(m.lcp.t)} ms >= ${LCP_MAX} ms (element ${m.lcp.el}${m.lcp.url ? `, ${B.pathOf(m.lcp.url)}` : ''})`);
        if (m.cls >= CLS_MAX) problems.push(`CLS ${m.cls.toFixed(3)} >= ${CLS_MAX}; shifts: ${m.shifts.slice(0, 5).map((s) => `${s.v.toFixed(3)} at ${Math.round(s.t)} ms (${s.sources.join(', ')})`).join('; ')}`);
        expectNone(problems, `${phoneName} ${p.path}`);
      });
    }
  }
});
