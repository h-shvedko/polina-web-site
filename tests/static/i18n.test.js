'use strict';
// Two languages: English at the root, German below /de/ with the same paths (scripts/build-site.js I18N, data.de.json).
// hreflang pairs and x-default, canonical per language, the sitemap alternates, the language switch in the nav,
// German texts on German pages, the German 404 page, and no long dashes (U+2013/U+2014) anywhere in the built HTML.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { qsa, qs, attr, text, normSpace } = require('../lib/html');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');
const { I18N, LANGS } = require('../../scripts/build-site.js');

const data = S.loadData();
const SITE = S.siteUrl(data);
const pages = S.sitePages(data);
const indexable = pages.filter((p) => p.indexable);

/** The path of a page in another language: /x/ <-> /de/x/. */
const pairPath = (p, lang) => S.LANG_PREFIX[lang] + p.path.replace(/^\/de(?=\/)/, '');

function forPages(list, fn) {
  const problems = [];
  for (const page of list) {
    const loaded = S.loadAppHtml(page.file);
    if (!loaded) { problems.push(`${page.file}: not built`); continue; }
    for (const p of fn(page, loaded.doc, loaded.source) || []) problems.push(`${page.file}: ${p}`);
  }
  return problems;
}

describe('i18n: English and German pages', () => {
  test('every page exists in both languages: the German page has the English path below /de/', () => {
    const en = pages.filter((p) => p.lang === 'en').map((p) => p.path);
    const de = pages.filter((p) => p.lang === 'de').map((p) => p.path);
    assert.deepEqual(de, en.map((p) => `/de${p}`));
    expectNone(pages.filter((p) => !S.appExists(p.file)).map((p) => `${p.file} missing`), 'pages missing');
  });

  test('hreflang: every indexable page links en, de and x-default (= English) as absolute URLs, and its canonical is its own language', () => {
    expectNone(forPages(indexable, (page, doc) => {
      const out = [];
      const links = qsa(doc, 'link[rel="alternate"][hreflang]').map((l) => [attr(l, 'hreflang'), attr(l, 'href')]);
      const want = [...LANGS.map((l) => [l, SITE + pairPath(page, l)]), ['x-default', SITE + pairPath(page, 'en')]];
      if (JSON.stringify(links) !== JSON.stringify(want)) out.push(`hreflang links ${JSON.stringify(links)}, expected ${JSON.stringify(want)}`);
      const canonical = attr(qs(doc, 'link[rel="canonical"]'), 'href');
      if (canonical !== page.url) out.push(`canonical ${canonical}, expected ${page.url}`);
      const locale = attr(qs(doc, 'meta[property="og:locale"]'), 'content');
      if (locale !== I18N[page.lang].locale) out.push(`og:locale ${locale}, expected ${I18N[page.lang].locale}`);
      return out;
    }), 'hreflang problems');
  });

  test('404 pages: lang of their language, noindex, no hreflang; /de/404.html is German', () => {
    expectNone(forPages(pages.filter((p) => p.type === '404'), (page, doc) => {
      const out = [];
      if (qsa(doc, 'link[rel="alternate"][hreflang]').length) out.push('404 page has hreflang links');
      if (attr(qs(doc, 'html'), 'lang') !== page.lang) out.push(`lang is not ${page.lang}`);
      if (normSpace(text(qs(doc, 'h1'))) !== I18N[page.lang].t.not_found) out.push('h1 is not in the page language');
      return out;
    }), '404 problems');
  });

  test('sitemap: every URL lists its en, de and x-default alternates (xhtml:link), the same pairs as the pages', () => {
    const xml = fs.readFileSync(path.join(S.APP_DIR, 'sitemap.xml'), 'utf8');
    assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9" xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml">/);
    const problems = [];
    const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
    assert.equal(blocks.length, indexable.length, 'one <url> per indexable page');
    for (const page of indexable) {
      const block = blocks.find((b) => b.includes(`<loc>${page.url}</loc>`));
      if (!block) { problems.push(`${page.url}: not in the sitemap`); continue; }
      const links = [...block.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)"\/>/g)].map((m) => [m[1], m[2]]);
      const want = [...LANGS.map((l) => [l, SITE + pairPath(page, l)]), ['x-default', SITE + pairPath(page, 'en')]];
      if (JSON.stringify(links) !== JSON.stringify(want)) problems.push(`${page.url}: alternates ${JSON.stringify(links)}`);
    }
    expectNone(problems, 'sitemap alternates');
  });

  test('language switch in the nav: one flag link per language (inline SVG, aria-label English / Deutsch, hreflang and lang), to the same page in that language; the current one has aria-current="true"', () => {
    expectNone(forPages(pages, (page, doc) => {
      const out = [];
      const list = qs(doc, '#site-nav ul.site-nav__langs');
      if (!list) return ['no ul.site-nav__langs in #site-nav'];
      if (attr(list, 'aria-label') !== I18N[page.lang].t.lang_label) out.push('ul.site-nav__langs needs an aria-label in the page language');
      const links = qsa(list, 'a.site-nav__lang');
      if (links.length !== LANGS.length) return [...out, `${links.length} language links, expected ${LANGS.length}`];
      LANGS.forEach((lang, i) => {
        const a = links[i];
        const want = page.type === '404' ? `${S.LANG_PREFIX[lang]}/` : pairPath(page, lang);
        if (attr(a, 'href') !== want) out.push(`${lang} link goes to ${attr(a, 'href')}, expected ${want}`);
        if (attr(a, 'aria-label') !== I18N[lang].name) out.push(`${lang} link needs aria-label="${I18N[lang].name}"`);
        if (attr(a, 'hreflang') !== lang || attr(a, 'lang') !== lang) out.push(`${lang} link needs hreflang and lang "${lang}"`);
        if (!qs(a, 'svg.flag[aria-hidden="true"]')) out.push(`${lang} link has no inline svg.flag (aria-hidden)`);
        const current = attr(a, 'aria-current');
        if (lang === page.lang ? current !== 'true' : current !== null) out.push(`${lang} link aria-current is ${JSON.stringify(current)}`);
      });
      // phones: the flag of the other language as the last item of the link row
      const phone = qsa(doc, '#site-nav ul.site-nav__links li.site-nav__item--lang a.site-nav__lang');
      const other = LANGS.find((l) => l !== page.lang);
      const wantPhone = page.type === '404' ? `${S.LANG_PREFIX[other]}/` : pairPath(page, other);
      if (phone.length !== 1 || attr(phone[0], 'href') !== wantPhone || attr(phone[0], 'aria-label') !== I18N[other].name) out.push(`the link row needs one li.site-nav__item--lang linking to ${wantPhone} (${I18N[other].name})`);
      const items = qsa(doc, '#site-nav ul.site-nav__links > li');
      if (items.length && !String(attr(items[items.length - 1], 'class')).includes('site-nav__item--lang')) out.push('the phone flag is not the last item of the link row');
      return out;
    }), 'language switch problems');
  });

  test('German pages carry German texts: none of the English interface strings, the German ones instead', () => {
    const en = I18N.en.t;
    const de = I18N.de.t;
    const english = [en.skip, en.cookie_settings, en.decline, en.accept, en.explore, en.more_about, en.intro_heading, en.not_found];
    expectNone(forPages(pages.filter((p) => p.lang === 'de'), (page, doc, source) => {
      const out = [];
      const body = normSpace(text(qs(doc, 'body')));
      for (const s of english) if (body.includes(s)) out.push(`English text "${s}" on a German page`);
      if (!body.includes(de.skip) || !body.includes(de.cookie_settings)) out.push('German skip link or Cookie-Einstellungen missing');
      if (/\b(Oil on canvas|Pastel on paper|Watercolour and ink)\b/.test(body)) out.push('an English medium on a German page');
      if (page.indexable && !/"inLanguage":("de"|\["en","de"\])/.test(source)) out.push('JSON-LD without inLanguage "de"');
      return out;
    }), 'German page problems');
  });

  test('German sizes use the decimal comma ("42 × 29,7 cm"); English the point', () => {
    const a = S.allArtworks().find(({ artwork }) => !Number.isInteger(artwork.width_cm) || !Number.isInteger(artwork.height_cm));
    assert.ok(a, 'no artwork with a decimal size');
    const en = S.loadAppHtml(`${a.hub.path}/${a.artwork.slug}/index.html`);
    const de = S.loadAppHtml(`de/${a.hub.path}/${a.artwork.slug}/index.html`);
    const size = (doc) => normSpace(text(qs(doc, '.artwork__fact--size dd'))).replace(/ /g, ' ');
    assert.equal(size(en.doc), S.sizeText(a.artwork));
    assert.equal(size(de.doc), S.sizeText(a.artwork, 'de'));
    assert.match(size(de.doc), /,\d/);
  });
});

describe('no long dashes', () => {
  test('no built HTML file or the sitemap contains U+2013 / U+2014 or their entities (&ndash; &mdash; &#8211; &#8212; &#x2013; &#x2014;)', () => {
    const re = /[–—]|&(?:ndash|mdash);|&#0*82(?:11|12);|&#[xX]0*201[34];/;
    const files = S.appTextFiles().filter((f) => /\.(html|xml)$/.test(f.rel));
    assert.ok(files.length > 70, `only ${files.length} HTML/XML files`);
    const problems = [];
    for (const f of files) {
      const lines = fs.readFileSync(f.abs, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = re.exec(line);
        if (m) problems.push(`${f.rel}:${i + 1}: ${JSON.stringify(line.slice(Math.max(0, m.index - 40), m.index + 40))}`);
      });
    }
    expectNone(problems, 'long dashes');
  });

  test('the sources of visible text have none either: data.json, data.de.json, templates, build-site.js strings', () => {
    const re = /[–—]|&(?:ndash|mdash);/;
    const files = ['data.json', 'data.de.json', ...fs.readdirSync(path.join(S.ROOT, 'src/templates/pages')).map((f) => `src/templates/pages/${f}`),
      ...fs.readdirSync(path.join(S.ROOT, 'src/templates/partials')).map((f) => `src/templates/partials/${f}`)];
    const problems = files.filter((f) => re.test(fs.readFileSync(path.join(S.ROOT, f), 'utf8')));
    // build-site.js: quoted strings and template literals only (a regular expression may name the characters)
    const src = fs.readFileSync(path.join(S.ROOT, 'scripts/build-site.js'), 'utf8');
    for (const m of src.matchAll(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)) if (re.test(m[0])) problems.push(`scripts/build-site.js: ${m[0].slice(0, 80)}`);
    expectNone(problems, 'long dashes in sources');
  });
});
