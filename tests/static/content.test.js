'use strict';
// SPEC 12.4 (forbidden content), 12.5 (removed files), 12.6 (no Cyrillic), 12.11 (no Google Analytics URL in HTML).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { qsa, attr, rawText, describe: desc } = require('../lib/html');
const { expectNone, findForbidden, findCyrillic, FORBIDDEN_PATTERNS, LICENSE_FILE_RE } = require('../lib/checks');
const S = require('../lib/site');

const data = S.loadData();

function textFilesOrFail() {
  assert.ok(fs.existsSync(S.APP_DIR), `APP_DIR does not exist: ${S.APP_DIR}`);
  const files = S.appTextFiles();
  assert.ok(files.length > 0, `no text files found in ${S.APP_DIR}`);
  return files;
}

function scan(labels, { skipLicenses = false } = {}) {
  const patterns = FORBIDDEN_PATTERNS.filter((p) => labels.includes(p.label));
  assert.equal(patterns.length, labels.length, 'unknown pattern label in test');
  const problems = [];
  for (const f of textFilesOrFail()) {
    if (skipLicenses && LICENSE_FILE_RE.test(f.rel)) continue;
    const content = fs.readFileSync(f.abs, 'utf8');
    for (const hit of findForbidden(content, { patterns })) {
      problems.push(`${f.rel}:${hit.line} [${hit.label}] "${hit.match}" in: ${hit.excerpt}`);
    }
  }
  return problems;
}

describe('4. forbidden content in every text file of app/ (URLs removed first)', () => {
  test('no Tilda references: tilda, t706, t754, t-store, data-tilda', () => {
    expectNone(scan(['tilda', 't706 (Tilda cart)', 't754 (Tilda catalog)', 't-store', 'data-tilda']), 'Tilda references found');
  });

  test('no shop words: price, cart, €, buy, shop/shopping, checkout, sold, "delivery across", "commissions welcome", schema.org Offer', () => {
    expectNone(scan(['price', 'cart', '€ (euro sign)', 'buy', 'shop/shopping', 'checkout', 'sold', 'delivery across',
      'commissions welcome', 'schema.org Offer'], { skipLicenses: true }), 'shop/sales words found (font licence files are skipped)');
  });

  test('no retired analytics events: cart_order, purchase_inquiry, artwork_view, gallery_filter', () => {
    expectNone(scan(['retired analytics event']), 'retired analytics events found');
  });

  test('no Tilda markup: t-*/tNNN classes, data-record-type, field=, rec<digits> ids, t_onReady/t_onFuncLoad', () => {
    const problems = [];
    for (const f of textFilesOrFail()) {
      const content = fs.readFileSync(f.abs, 'utf8');
      if (/\.html?$/i.test(f.rel)) {
        const loaded = S.loadAppHtml(f.rel);
        for (const el of qsa(loaded.doc, '*')) {
          const cls = (attr(el, 'class') || '').split(/\s+/).filter((c) => /^t-|^t\d/.test(c));
          if (cls.length) problems.push(`${f.rel}: ${desc(el)} has Tilda classes ${cls.slice(0, 3).join(' ')}`);
          for (const a of el.attrList) {
            if (a.name === 'data-record-type' || a.name === 'field' || a.name.startsWith('data-tilda')) problems.push(`${f.rel}: ${desc(el)} has attribute ${a.name}`);
          }
          const id = attr(el, 'id');
          if (id && /^rec\d+$/.test(id)) problems.push(`${f.rel}: ${desc(el)} has Tilda record id`);
        }
      }
      if (/\.css$/i.test(f.rel)) {
        const m = content.match(/\.(?:t-[a-z][\w-]*|t\d{2,}[\w-]*)/g);
        if (m) problems.push(`${f.rel}: Tilda selectors ${[...new Set(m)].slice(0, 5).join(' ')}`);
      }
      const helpers = content.match(/\bt_on(?:Ready|FuncLoad)\b/g);
      if (helpers) problems.push(`${f.rel}: ${helpers.length}x ${[...new Set(helpers)].join('/')}`);
    }
    expectNone(problems, 'Tilda markup remnants');
  });
});

describe('5. removed directories and files are gone from app/', () => {
  test('no app/partials/ and no app/blog/', () => {
    const problems = ['partials', 'blog'].filter((d) => fs.existsSync(path.join(S.APP_DIR, d))).map((d) => `${d}/ exists`);
    expectNone(problems, 'retired directories still in app/');
  });

  test('no Tilda CSS/JS (css/tilda*, js/tilda*) and no TildaSans font files', () => {
    assert.ok(fs.existsSync(S.APP_DIR), `APP_DIR does not exist: ${S.APP_DIR}`);
    const files = S.walkFiles(S.APP_DIR).map(S.relApp);
    const problems = files.filter((f) => /^css\/tilda/i.test(f) || /^js\/tilda/i.test(f) || /tildasans/i.test(f));
    expectNone(problems, 'Tilda files still in app/');
  });

  test('no retired scripts and styles (gallery-filter.js, hammer.min.js, script.min.js, w3.js, blog.css, nav.css, fonts-tildasans*.css)', () => {
    const retired = ['js/gallery-filter.js', 'js/hammer.min.js', 'js/script.min.js', 'js/w3.js', 'css/blog.css', 'css/nav.css',
      'css/fonts-tildasans.css', 'css/fonts-tildasans.min.css'];
    expectNone(retired.filter((f) => fs.existsSync(S.appFile(f))), 'retired files still in app/');
  });

  test('app/ contains no HTML file other than the expected pages and 404.html', () => {
    assert.ok(fs.existsSync(S.APP_DIR), `APP_DIR does not exist: ${S.APP_DIR}`);
    const expected = new Set(S.sitePages(data).map((p) => p.file));
    const html = S.walkFiles(S.APP_DIR).map(S.relApp).filter((f) => /\.html?$/i.test(f) && !f.startsWith('img/'));
    expectNone(html.filter((f) => !expected.has(f)), 'unexpected HTML files in app/ (old partials, blog or copies)');
  });
});

describe('6. no Cyrillic characters', () => {
  test('no Cyrillic character (U+0400-U+04FF) in any text file of app/', () => {
    const problems = [];
    for (const f of textFilesOrFail()) {
      const hits = findCyrillic(fs.readFileSync(f.abs, 'utf8'));
      if (hits.length) problems.push(`${f.rel}:${hits[0].line} ${hits.length} Cyrillic char(s), first ${hits[0].char} ${hits[0].code} in: ${hits[0].excerpt}`);
    }
    expectNone(problems, 'files with Cyrillic characters');
  });
});

describe('11. Google Analytics is loaded only by consent.js', () => {
  test('no googletagmanager.com / google-analytics.com URL in any HTML file', () => {
    const problems = [];
    for (const f of S.appHtmlFiles()) {
      const content = fs.readFileSync(f.abs, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (/googletagmanager\.com|google-analytics\.com/i.test(line)) problems.push(`${f.rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    assert.ok(S.appHtmlFiles().length > 0, `no HTML files in ${S.APP_DIR}`);
    expectNone(problems, 'Google Analytics URLs in HTML (GA must be injected by /js/consent.js after Accept)');
  });

  test('no inline gtag()/dataLayer code in HTML (no inline scripts except JSON-LD)', () => {
    const problems = [];
    for (const f of S.appHtmlFiles()) {
      const loaded = S.loadAppHtml(f.rel);
      for (const s of qsa(loaded.doc, 'script')) {
        if (attr(s, 'src') !== null) continue;
        const type = (attr(s, 'type') || '').toLowerCase();
        if (type === 'application/ld+json') continue;
        const code = rawText(s).trim();
        if (!code) continue;
        problems.push(`${f.rel}: inline <script${type ? ` type="${type}"` : ''}> (line ${loaded.doc.lineOf(s.start)}): ${code.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
      for (const el of qsa(loaded.doc, '*')) {
        for (const a of el.attrList) if (/^on[a-z]+$/.test(a.name)) problems.push(`${f.rel}: inline event handler ${a.name} on ${desc(el)}`);
      }
    }
    expectNone(problems, 'inline scripts or event handlers in HTML');
  });
});
