'use strict';
// SPEC 12.3: sitemap.xml and robots.txt.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { expectNone, parseXml, xmlChildren, xmlText, isIsoDate } = require('../lib/checks');
const S = require('../lib/site');

const data = S.loadData();
const SITE = S.siteUrl(data);
const indexable = S.indexablePages(data);
const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';

function readSitemap() {
  const file = S.appFile('sitemap.xml');
  assert.ok(fs.existsSync(file), `missing ${file}`);
  const xml = fs.readFileSync(file, 'utf8');
  let root;
  try {
    root = parseXml(xml);
  } catch (e) {
    assert.fail(`sitemap.xml is not well-formed XML: ${e.message}`);
  }
  const urls = xmlChildren(root, 'url').map((u) => ({
    locs: xmlChildren(u, 'loc').map((l) => xmlText(l).trim()),
    lastmods: xmlChildren(u, 'lastmod').map((l) => xmlText(l).trim()),
  }));
  return { root, urls };
}

describe('3. sitemap.xml and robots.txt', () => {
  test('sitemap.xml exists, is well-formed XML and has a <urlset> root in the sitemaps.org namespace', () => {
    const { root, urls } = readSitemap();
    assert.equal(root.name, 'urlset', `root element is <${root.name}>, expected <urlset>`);
    assert.equal(root.attrs.xmlns, SITEMAP_NS, `xmlns is "${root.attrs.xmlns}", expected "${SITEMAP_NS}"`);
    const bad = urls.map((u, i) => (u.locs.length === 1 ? null : `<url> #${i + 1} has ${u.locs.length} <loc> elements`)).filter(Boolean);
    expectNone(bad, '<url> entries without exactly one <loc>');
  });

  test('sitemap URL set equals exactly the indexable pages from data.json (home, hubs, artworks, about, contact)', () => {
    const { urls } = readSitemap();
    const listed = urls.map((u) => u.locs[0]).filter(Boolean);
    const expected = indexable.map((p) => p.url);
    const listedSet = new Set(listed);
    const expectedSet = new Set(expected);
    const missing = expected.filter((u) => !listedSet.has(u)).map((u) => `missing: ${u}`);
    const extra = [...listedSet].filter((u) => !expectedSet.has(u)).map((u) => `not an indexable page: ${u}`);
    const dupes = listed.filter((u, i) => listed.indexOf(u) !== i).map((u) => `listed twice: ${u}`);
    expectNone([...missing, ...extra, ...dupes], `sitemap lists ${listed.length} URLs, expected exactly ${expected.length}`);
  });

  test('every sitemap URL is an absolute https URL on the site with a trailing slash and maps to a built page', () => {
    const { urls } = readSitemap();
    const problems = [];
    for (const { locs } of urls) {
      const loc = locs[0];
      if (!loc) continue;
      if (!loc.startsWith(`${SITE}/`)) { problems.push(`${loc}: not under ${SITE}/`); continue; }
      if (!loc.endsWith('/')) problems.push(`${loc}: no trailing slash`);
      const r = S.resolveLocal(loc, '/', data);
      if (!r.file || !S.appExists(r.file)) problems.push(`${loc}: no file ${r.file || ''} in app/`);
    }
    expectNone(problems, 'sitemap URL problems');
  });

  test('every <url> has a <lastmod> in YYYY-MM-DD format equal to artwork.updated or site.lastmod', () => {
    const { urls } = readSitemap();
    const byUrl = new Map(indexable.map((p) => [p.url, p]));
    const problems = [];
    for (const { locs, lastmods } of urls) {
      const loc = locs[0];
      if (lastmods.length !== 1) { problems.push(`${loc}: ${lastmods.length} <lastmod> elements`); continue; }
      const lm = lastmods[0];
      if (!isIsoDate(lm)) { problems.push(`${loc}: lastmod "${lm}" is not a valid YYYY-MM-DD date`); continue; }
      const page = byUrl.get(loc);
      if (!page) continue;
      const want = (page.artwork && page.artwork.updated) || (data.site && data.site.lastmod);
      if (want && lm !== want) problems.push(`${loc}: lastmod ${lm}, expected ${want}`);
    }
    expectNone(problems, 'lastmod problems');
  });

  test('sitemap does not list the 404 page, retired URLs (blog, partials, index.html) or legal pages without text', () => {
    const { urls } = readSitemap();
    const legal = data.legal || {};
    const problems = [];
    for (const { locs } of urls) {
      const loc = locs[0] || '';
      if (/\/404(\.html)?\/?$/.test(loc)) problems.push(`${loc}: error page`);
      if (/\/(blog|partials)(\/|$)/.test(loc)) problems.push(`${loc}: retired URL`);
      if (/index\.html?$/.test(loc)) problems.push(`${loc}: index.html URL (use the directory URL)`);
      if (/\/imprint\/$/.test(loc) && !legal.imprint_html) problems.push(`${loc}: imprint page without text (legal.imprint_html is null)`);
      if (/\/privacy\/$/.test(loc) && !legal.privacy_html) problems.push(`${loc}: privacy page without text (legal.privacy_html is null)`);
    }
    expectNone(problems, 'sitemap lists pages that must not be there');
  });

  test(`robots.txt allows crawling and has "Sitemap: ${SITE}/sitemap.xml"`, () => {
    const file = S.appFile('robots.txt');
    assert.ok(fs.existsSync(file), `missing ${file}`);
    const robots = fs.readFileSync(file, 'utf8');
    const problems = [];
    if (!/^User-agent:\s*\*\s*$/im.test(robots)) problems.push('no "User-agent: *" line');
    if (!new RegExp(`^Sitemap:\\s*${SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/sitemap\\.xml\\s*$`, 'im').test(robots)) problems.push(`no "Sitemap: ${SITE}/sitemap.xml" line`);
    if (/^Disallow:\s*\/\s*$/im.test(robots)) problems.push('"Disallow: /" blocks the whole site');
    expectNone(problems, 'robots.txt problems');
  });
});
