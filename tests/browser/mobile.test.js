'use strict';
// SPEC browser 12.7: layout at 390 px (no horizontal scroll, tap targets >= 24x24 CSS px, text >= 12 px).
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { expectNone } = require('../lib/checks');
const B = require('../lib/browser');

const PAGES = [...B.samplePages(), { key: '404', label: '404', type: '404', path: '/this-page-does-not-exist/' }];

/** Runs in the page: layout measurements at the current viewport. */
function measureLayout() {
  const describeEl = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    if (el.classList.length) s += `.${[...el.classList].slice(0, 3).join('.')}`;
    const href = el.getAttribute && el.getAttribute('href');
    if (href) s += `[href="${href.length > 50 ? `${href.slice(0, 47)}...` : href}"]`;
    return s;
  };
  const isShown = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden) return false;
      const st = getComputedStyle(e);
      if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return false;
    }
    return true;
  };
  const clipsX = (el) => {
    const st = getComputedStyle(el);
    return ['hidden', 'auto', 'scroll', 'clip'].includes(st.overflowX);
  };
  const vw = document.documentElement.clientWidth;
  const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const overflow = [];
  if (scrollWidth > vw + 1) {
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (clipsX(p)) { clipped = true; break; }
      if (!clipped && isShown(el)) overflow.push(`${describeEl(el)} right edge at ${Math.round(r.right)} px`);
      if (overflow.length >= 20) break;
    }
  }
  const targets = [];
  const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll(sel)) {
    if (!isShown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const inlineInParagraph = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p');
    if (inlineInParagraph) continue;
    if (r.width < 23.5 || r.height < 23.5) targets.push(`${describeEl(el)} is ${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10} px`);
  }
  const small = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
    seen.add(el);
    if (!isShown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 12) small.push(`${describeEl(el)} ${size}px: "${n.nodeValue.trim().slice(0, 40)}"`);
  }
  return { vw, scrollWidth, overflow, targets, small };
}

describe('browser 7: 390 px layout on every page type', () => {
  let env;
  before(async () => { env = await B.startEnv(); });
  after(async () => { if (env) await env.close(); });

  for (const p of PAGES) {
    test(`mobile ${p.label} ${p.path}: no horizontal scroll, tap targets >= 24x24 px (inline links in paragraphs excepted), text >= 12 px`, { timeout: 90000 }, async () => {
      const ctx = await B.newContext(env, 'mobile');
      try {
        const page = await ctx.newPage();
        const resp = await B.gotoPage(page, env.url(p.path));
        const wantStatus = p.type === '404' ? 404 : 200;
        assert.equal(resp && resp.status(), wantStatus, `HTTP ${resp && resp.status()} for ${p.path}`);
        await page.evaluate(() => (document.fonts && document.fonts.ready) || null);
        const m = await page.evaluate(measureLayout);
        const problems = [];
        if (p.type === '404') {
          const h1 = (await page.locator('h1').allTextContents()).map((x) => x.trim());
          if (!h1.includes('Page not found')) problems.push('the custom 404 page (h1 "Page not found") is not served');
        }
        if (m.scrollWidth > m.vw + 1) problems.push(`horizontal scroll: page is ${m.scrollWidth} px wide at a ${m.vw} px viewport; wide elements: ${m.overflow.slice(0, 8).join('; ') || 'unknown'}`);
        problems.push(...m.targets.map((x) => `small tap target: ${x}`));
        problems.push(...m.small.map((x) => `text below 12 px: ${x}`));
        expectNone(problems, `${p.path} at 390 px`);
      } finally {
        await ctx.close();
      }
    });
  }
});
