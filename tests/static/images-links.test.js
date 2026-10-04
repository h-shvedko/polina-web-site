'use strict';
// SPEC 12.7 (images and local references) and 12.8 (internal links).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { qsa, qs, attr, rawText, describe: desc } = require('../lib/html');
const { expectNone, imageSize, parseSrcset, cssUrls } = require('../lib/checks');
const S = require('../lib/site');

const data = S.loadData();
const pages = S.sitePages(data);
const indexable = pages.filter((p) => p.indexable);

const sizeCache = new Map();
function fileSize(rel) {
  if (!sizeCache.has(rel)) {
    let size = null;
    try { size = imageSize(fs.readFileSync(S.appFile(rel))); } catch { size = null; }
    sizeCache.set(rel, size);
  }
  return sizeCache.get(rel);
}

/** All HTML files in app/ with their URL path (pages and anything else that is there). */
function htmlFiles() {
  assert.ok(fs.existsSync(S.APP_DIR), `APP_DIR does not exist: ${S.APP_DIR}`);
  const files = S.appHtmlFiles().filter((f) => !f.rel.startsWith('img/'));
  assert.ok(files.length > 0, `no HTML files in ${S.APP_DIR}`);
  return files.map((f) => ({ ...f, urlPath: S.urlPathForFile(f.rel), loaded: S.loadAppHtml(f.rel) }));
}

/** Pages from data.json that exist, with parsed HTML; missing pages are returned separately. */
function existingPages(list) {
  const present = [];
  const missing = [];
  for (const p of list) {
    const loaded = S.loadAppHtml(p.file);
    if (loaded) present.push({ ...p, doc: loaded.doc }); else missing.push(p.file);
  }
  return { present, missing };
}

function missingNote(missing, total) {
  return missing.length ? [`${missing.length} of ${total} expected page(s) do not exist, e.g. ${missing.slice(0, 3).join(', ')} (see "1. pages exist")`] : [];
}

describe('7. images and local file references', () => {
  test('every <img> has a non-empty alt and numeric width and height attributes', () => {
    const problems = [];
    let count = 0;
    for (const f of htmlFiles()) {
      for (const img of qsa(f.loaded.doc, 'img')) {
        count++;
        const alt = attr(img, 'alt');
        const w = attr(img, 'width');
        const h = attr(img, 'height');
        const issues = [];
        if (alt === null || !alt.trim()) issues.push(alt === null ? 'no alt' : 'empty alt');
        if (!/^\d+$/.test(w || '') || Number(w) === 0) issues.push(`width=${w === null ? 'missing' : `"${w}"`}`);
        if (!/^\d+$/.test(h || '') || Number(h) === 0) issues.push(`height=${h === null ? 'missing' : `"${h}"`}`);
        if (issues.length) problems.push(`${f.rel}: ${desc(img)}: ${issues.join(', ')}`);
      }
    }
    assert.ok(count > 0, 'no <img> elements found at all');
    expectNone(problems, `images without alt/width/height (of ${count} <img>)`);
  });

  test('<img> width/height match the aspect ratio of the image file (no distortion, no layout shift)', () => {
    const problems = [];
    const unverifiable = [];
    for (const f of htmlFiles()) {
      for (const img of qsa(f.loaded.doc, 'img')) {
        const w = Number(attr(img, 'width'));
        const h = Number(attr(img, 'height'));
        const src = attr(img, 'src');
        if (!w || !h || !src) { unverifiable.push(`${f.rel}: ${desc(img)}: no numeric width/height or src`); continue; }
        const r = S.resolveLocal(src, f.urlPath, data);
        if (r.external) { unverifiable.push(`${f.rel}: ${desc(img)}: external image`); continue; }
        if (!r.file || !S.appExists(r.file)) { unverifiable.push(`${f.rel}: ${desc(img)}: file app/${r.file} missing`); continue; }
        if (/\.svg$/i.test(r.file)) continue;
        const size = fileSize(r.file);
        if (!size) { unverifiable.push(`${f.rel}: ${desc(img)}: unknown image format`); continue; }
        const want = size.width / size.height;
        const got = w / h;
        if (Math.abs(got - want) / want > 0.02) problems.push(`${f.rel}: ${desc(img)}: ${w}x${h} (ratio ${got.toFixed(3)}) but the file is ${size.width}x${size.height} (ratio ${want.toFixed(3)})`);
      }
    }
    expectNone([...problems, ...unverifiable.map((u) => `cannot verify ${u}`)], 'width/height do not match the image file');
  });

  test('every <picture> has a <source type="image/webp"> and an <img> fallback', () => {
    const problems = [];
    let count = 0;
    for (const f of htmlFiles()) {
      for (const pic of qsa(f.loaded.doc, 'picture')) {
        count++;
        if (!qs(pic, 'source[type="image/webp"]')) problems.push(`${f.rel}: ${desc(pic)} has no <source type="image/webp">`);
        if (!qs(pic, 'img')) problems.push(`${f.rel}: ${desc(pic)} has no <img> fallback`);
      }
    }
    assert.ok(count > 0, 'no <picture> elements found (images must be served as WebP with JPEG fallback via <picture>)');
    expectNone(problems, '<picture> problems');
  });

  test('every local file referenced by src, srcset, poster, <link href>, file links and CSS url() exists in app/', () => {
    const problems = [];
    const check = (ref, fromPath, where) => {
      const r = S.resolveLocal(ref, fromPath, data);
      if (r.external || r.empty) return;
      if (r.invalid) { problems.push(`${where}: invalid URL "${ref}"`); return; }
      if (!S.appExists(r.file)) problems.push(`${where}: "${ref}" -> app/${r.file} does not exist`);
    };
    for (const f of htmlFiles()) {
      const doc = f.loaded.doc;
      for (const el of qsa(doc, '[src]')) check(attr(el, 'src'), f.urlPath, `${f.rel}: ${desc(el)}`);
      for (const el of qsa(doc, '[srcset]')) for (const u of parseSrcset(attr(el, 'srcset'))) check(u, f.urlPath, `${f.rel}: ${desc(el)} srcset`);
      for (const el of qsa(doc, '[poster]')) check(attr(el, 'poster'), f.urlPath, `${f.rel}: ${desc(el)} poster`);
      for (const el of qsa(doc, 'link[href]')) {
        const rel = (attr(el, 'rel') || '').toLowerCase();
        if (/\b(canonical|alternate|preconnect|dns-prefetch)\b/.test(rel)) continue;
        check(attr(el, 'href'), f.urlPath, `${f.rel}: ${desc(el)}`);
      }
      for (const el of qsa(doc, 'a[href]')) {
        const href = attr(el, 'href');
        const r = S.resolveLocal(href, f.urlPath, data);
        if (r.file && /\.[a-z0-9]{2,5}$/i.test(r.file) && !/\.html?$/i.test(r.file)) check(href, f.urlPath, `${f.rel}: ${desc(el)}`);
      }
      for (const el of qsa(doc, 'meta[name="twitter:image"], meta[name="msapplication-TileImage"], meta[property="og:image"]')) {
        check(attr(el, 'content'), f.urlPath, `${f.rel}: ${desc(el)}`);
      }
      for (const el of qsa(doc, '[style]')) for (const u of cssUrls(attr(el, 'style'))) check(u, f.urlPath, `${f.rel}: ${desc(el)} style url()`);
      for (const el of qsa(doc, 'style')) for (const u of cssUrls(rawText(el))) check(u, f.urlPath, `${f.rel}: <style> url()`);
    }
    for (const css of S.appTextFiles().filter((x) => /\.css$/i.test(x.rel))) {
      const content = fs.readFileSync(css.abs, 'utf8');
      for (const u of cssUrls(content)) check(u, `/${css.rel}`, `${css.rel} url()`);
    }
    expectNone(problems, 'missing local files');
  });
});

/** Local <a href> targets of a page: [{ el, href, r }] */
function pageLinks(doc, fromPath) {
  return qsa(doc, 'a[href]').map((el) => ({ el, href: attr(el, 'href'), r: S.resolveLocal(attr(el, 'href'), fromPath, data) }));
}

function buildGraph(list) {
  const graph = new Map();
  for (const p of list) {
    const targets = new Set();
    for (const { r } of pageLinks(p.doc, p.path)) {
      if (!r.file || r.external) continue;
      targets.add(`/${r.file.replace(/index\.html$/, '')}`);
    }
    graph.set(p.path, targets);
  }
  return graph;
}

describe('8. internal links', () => {
  test('every local <a href> resolves to an existing page or file (fragment ignored)', () => {
    const problems = [];
    for (const f of htmlFiles()) {
      for (const { el, href, r } of pageLinks(f.loaded.doc, f.urlPath)) {
        if (r.external || r.empty) continue;
        if (r.invalid) { problems.push(`${f.rel}: ${desc(el)}: invalid href`); continue; }
        if (href.startsWith('#')) continue;
        if (S.appExists(r.file)) continue;
        const asDir = `${r.file}/index.html`;
        if (S.appExists(asDir)) continue; // reported by the canonical-form test
        problems.push(`${f.rel}: ${desc(el)} -> app/${r.file} does not exist`);
      }
    }
    expectNone(problems, 'broken internal links');
  });

  test('internal page links use the canonical form (directory URL with trailing slash, no index.html)', () => {
    const problems = [];
    for (const f of htmlFiles()) {
      for (const { el, href, r } of pageLinks(f.loaded.doc, f.urlPath)) {
        if (r.external || r.empty || r.invalid || href.startsWith('#')) continue;
        if (/(^|\/)index\.html?$/i.test(r.path)) problems.push(`${f.rel}: ${desc(el)} links to index.html (use the directory URL)`);
        else if (!r.path.endsWith('/') && S.appExists(`${r.file}/index.html`)) problems.push(`${f.rel}: ${desc(el)} has no trailing slash (causes a redirect)`);
      }
    }
    expectNone(problems, 'non-canonical internal links');
  });

  test('in-page anchors (#id, /page/#id) point to an existing id on the target page', () => {
    const problems = [];
    const idsCache = new Map();
    const idsOf = (file) => {
      if (!idsCache.has(file)) {
        const loaded = S.loadAppHtml(file);
        idsCache.set(file, loaded ? new Set(qsa(loaded.doc, '[id]').map((e) => attr(e, 'id'))) : null);
      }
      return idsCache.get(file);
    };
    for (const f of htmlFiles()) {
      for (const { el, r } of pageLinks(f.loaded.doc, f.urlPath)) {
        if (!r.file || !r.hash || r.hash === 'top') continue;
        const ids = idsOf(r.file);
        if (ids && !ids.has(decodeURIComponent(r.hash))) problems.push(`${f.rel}: ${desc(el)}: no element with id="${r.hash}" on /${r.file.replace(/index\.html$/, '')}`);
      }
    }
    expectNone(problems, 'anchors without target');
  });

  test('every indexable (sitemap) page is linked from at least one other page', () => {
    const { present, missing } = existingPages(indexable);
    const graph = buildGraph(present);
    const problems = [...missingNote(missing, indexable.length)];
    for (const p of present) {
      if (p.type === 'home') continue;
      const linkedFrom = present.filter((q) => q.path !== p.path && graph.get(q.path).has(p.path));
      if (!linkedFrom.length) problems.push(`${p.path} is not linked from any other page`);
    }
    expectNone(problems, 'orphan pages');
  });

  test('every artwork is reachable from the home page in at most 2 clicks', () => {
    const { present, missing } = existingPages(indexable);
    const graph = buildGraph(present);
    const depth = new Map([['/', 0]]);
    const queue = ['/'];
    while (queue.length) {
      const cur = queue.shift();
      if (depth.get(cur) >= 2) continue;
      for (const next of graph.get(cur) || []) {
        if (!depth.has(next)) { depth.set(next, depth.get(cur) + 1); queue.push(next); }
      }
    }
    const problems = [...missingNote(missing, indexable.length)];
    for (const p of indexable.filter((x) => x.type === 'artwork')) {
      if (!depth.has(p.path)) problems.push(`${p.path} is not reachable from / in 2 clicks`);
    }
    expectNone(problems, 'artworks too deep');
  });

  test('each artwork page links to its hub and to its previous/next artwork (data.json order) with rel="prev"/rel="next"', () => {
    const list = indexable.filter((p) => p.type === 'artwork');
    const { present, missing } = existingPages(list);
    const problems = [...missingNote(missing, list.length)];
    for (const p of present) {
      const links = pageLinks(p.doc, p.path);
      const hubPath = `${S.LANG_PREFIX[p.lang]}/${p.hub.path}/`;
      if (!links.some((l) => l.r.path === hubPath && !l.r.hash)) problems.push(`${p.path}: no link to its hub ${hubPath}`);
      const relLinks = (rel) => links.filter((l) => (attr(l.el, 'rel') || '').split(/\s+/).includes(rel)).map((l) => l.r.path);
      const check = (rel, want, wrap) => {
        const got = relLinks(rel);
        const wantPath = want ? S.artworkPath(p.hub, want, p.lang) : null;
        const wrapPath = wrap ? S.artworkPath(p.hub, wrap, p.lang) : null;
        if (wantPath) {
          if (!got.includes(wantPath)) problems.push(`${p.path}: no <a rel="${rel}" href="${wantPath}"> (found: ${got.join(', ') || 'none'})`);
        } else if (got.length && !(wrapPath && got.every((g) => g === wrapPath))) {
          problems.push(`${p.path}: rel="${rel}" points to ${got.join(', ')}; at the end of the list expected none or ${wrapPath}`);
        }
      };
      check('prev', p.prev, p.last !== p.artwork ? p.last : null);
      check('next', p.next, p.first !== p.artwork ? p.first : null);
    }
    expectNone(problems, 'artwork navigation links');
  });
});
