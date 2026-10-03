'use strict';
// SPEC 12.1 (pages exist) and 12.2 (head and SEO tags per page), checked on the built files in APP_DIR.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { qsa, qs, attr, text, normSpace } = require('../lib/html');
const { expectNone, cpLen, imageSize, headingProblems } = require('../lib/checks');
const S = require('../lib/site');

const data = S.loadData();
const pages = S.sitePages(data);
const indexable = pages.filter((p) => p.indexable);
const SITE = S.siteUrl(data);

/** Run `fn(page, doc)` over existing pages; missing pages are reported as one problem so no check passes on an incomplete build. */
function checkPages(list, fn) {
  const problems = [];
  const missing = [];
  for (const page of list) {
    const loaded = S.loadAppHtml(page.file);
    if (!loaded) { missing.push(page.file); continue; }
    for (const p of fn(page, loaded.doc) || []) problems.push(`${page.file}: ${p}`);
  }
  if (missing.length) {
    problems.unshift(`${missing.length} of ${list.length} expected page(s) do not exist, e.g. ${missing.slice(0, 3).join(', ')} (see "1. pages exist")`);
  }
  return problems;
}

function metaContent(doc, key) {
  const el = qs(doc, `meta[property="${key}"]`) || qs(doc, `meta[name="${key}"]`);
  return el ? attr(el, 'content') : null;
}

function missingFiles(list) {
  return list.filter((p) => !S.appExists(p.file)).map((p) => `${p.file} (${p.url})`);
}

describe('1. pages exist (expected list from data.json)', () => {
  test('home page exists: index.html', () => {
    assert.ok(S.appExists('index.html'), `missing ${S.appFile('index.html')}`);
  });

  test('a hub page exists for every hub: <hub path>/index.html', () => {
    expectNone(missingFiles(pages.filter((p) => p.type === 'hub')), 'hub pages missing');
  });

  test(`an artwork page exists for every artwork in data.json: <hub path>/<slug>/index.html`, () => {
    const list = pages.filter((p) => p.type === 'artwork');
    assert.ok(list.length > 0, 'data.json lists no artworks');
    expectNone(missingFiles(list), `artwork pages missing (expected ${list.length})`);
  });

  test('about/index.html and contact/index.html exist', () => {
    expectNone(missingFiles(pages.filter((p) => p.type === 'about' || p.type === 'contact')), 'pages missing');
  });

  test('custom 404.html exists', () => {
    assert.ok(S.appExists('404.html'), `missing ${S.appFile('404.html')}`);
  });

  test('imprint/ and privacy/ exist only when data.json legal.imprint_html / legal.privacy_html is set', () => {
    const legal = data.legal || {};
    const problems = [];
    for (const [key, dir] of [['imprint_html', 'imprint'], ['privacy_html', 'privacy']]) {
      const exists = S.appExists(`${dir}/index.html`);
      if (legal[key] && !exists) problems.push(`${dir}/index.html is missing although legal.${key} is set`);
      if (!legal[key] && exists) problems.push(`${dir}/index.html exists although legal.${key} is null (no invented legal text)`);
    }
    expectNone(problems, 'legal pages do not follow data.json');
  });
});

describe('2. head and SEO tags of every page', () => {
  test('<html lang="en"> on every page (indexable pages and 404)', () => {
    expectNone(checkPages(pages, (page, doc) => {
      const html = qs(doc, 'html');
      const lang = html ? attr(html, 'lang') : null;
      return lang === 'en' ? [] : [`<html lang> is ${lang === null ? 'missing' : `"${lang}"`}`];
    }), '<html lang="en"> missing or wrong');
  });

  test('exactly one <h1> per page', () => {
    expectNone(checkPages(pages, (page, doc) => {
      const h1 = qsa(doc, 'h1');
      return h1.length === 1 ? [] : [`${h1.length} <h1> elements${h1.length ? `: ${h1.map((h) => JSON.stringify(normSpace(text(h)).slice(0, 50))).join(', ')}` : ''}`];
    }), 'pages without exactly one h1');
  });

  test('no skipped heading levels: the first heading is h1, then at most one level deeper at a time', () => {
    expectNone(checkPages(pages, (page, doc) => {
      const headings = qsa(doc, 'h1, h2, h3, h4, h5, h6');
      if (!headings.length) return ['no headings at all'];
      const levels = headings.map((h) => Number(h.tag[1]));
      return headingProblems(levels).map((p) => `${p} (outline: ${levels.map((l) => `h${l}`).join(' ')})`);
    }), 'heading outline problems');
  });

  test('<title> is present, at most 60 characters and unique across all indexable pages', () => {
    const seen = new Map();
    const problems = checkPages(indexable, (page, doc) => {
      const titles = qsa(doc, 'title');
      if (titles.length !== 1) return [`${titles.length} <title> elements`];
      const t = normSpace(text(titles[0]));
      const out = [];
      if (!t) out.push('empty <title>');
      if (cpLen(t) > 60) out.push(`<title> has ${cpLen(t)} characters (max 60): "${t}"`);
      if (seen.has(t)) out.push(`<title> "${t}" is also used by ${seen.get(t)}`); else seen.set(t, page.file);
      return out;
    });
    expectNone(problems, '<title> problems');
  });

  test('<title> follows data.json: seo_title of home/hubs/about/contact; artworks: "<title> — <medium_label>, <year> | Polina Shvedko" rule or seo_title', () => {
    expectNone(checkPages(indexable, (page, doc) => {
      const want = S.expectedTitle(page, data);
      const t = normSpace(text(qs(doc, 'title')));
      if (want) return t === want ? [] : [`<title> is "${t}", expected "${want}"`];
      if (page.type === 'artwork') {
        return t.endsWith(' | Polina Shvedko') && t.includes('…') ? [] : [`<title> "${t}" should be "<title cut at a word boundary>… | Polina Shvedko"`];
      }
      return [];
    }), '<title> does not match data.json');
  });

  test('meta description has 120-155 characters on every indexable page', () => {
    expectNone(checkPages(indexable, (page, doc) => {
      const els = qsa(doc, 'meta[name="description"]');
      if (els.length !== 1) return [`${els.length} <meta name="description"> elements`];
      const d = attr(els[0], 'content') || '';
      const n = cpLen(d);
      return n >= 120 && n <= 155 ? [] : [`description has ${n} characters (120-155): "${d}"`];
    }), 'meta description length problems');
  });

  test('meta description follows data.json (artworks: "<title>, <medium> by Polina Shvedko (<year>), <w> × <h> cm. <first line>")', () => {
    expectNone(checkPages(indexable, (page, doc) => {
      const d = attr(qs(doc, 'meta[name="description"]'), 'content');
      if (d === null) return ['no meta description'];
      const want = S.expectedDescription(page, data);
      const out = [];
      if (/[<>]/.test(d)) out.push('description contains HTML');
      if (want.exact && d !== want.exact) out.push(`description is "${d}", expected "${want.exact}"`);
      if (want.prefix && !d.startsWith(want.prefix)) out.push(`description "${d}" should start with "${want.prefix}"`);
      return out;
    }), 'meta description does not match data.json');
  });

  test('canonical link is the absolute https URL of the page with a trailing slash', () => {
    expectNone(checkPages(indexable, (page, doc) => {
      const links = qsa(doc, 'link[rel~="canonical"]');
      if (links.length !== 1) return [`${links.length} canonical links (expected 1: ${page.url})`];
      const href = attr(links[0], 'href');
      return href === page.url ? [] : [`canonical is "${href}", expected "${page.url}"`];
    }), 'canonical problems');
  });

  test('Open Graph tags: og:title, og:description, og:type=website, og:url = canonical, og:site_name', () => {
    expectNone(checkPages(indexable, (page, doc) => {
      const out = [];
      for (const key of ['og:title', 'og:description', 'og:site_name']) {
        const v = metaContent(doc, key);
        if (!v || !v.trim()) out.push(`${key} missing or empty`);
      }
      const type = metaContent(doc, 'og:type');
      if (type !== 'website') out.push(`og:type is ${type === null ? 'missing' : `"${type}"`}, expected "website"`);
      const ogUrl = metaContent(doc, 'og:url');
      const canonical = attr(qs(doc, 'link[rel~="canonical"]'), 'href');
      if (ogUrl !== page.url) out.push(`og:url is ${ogUrl === null ? 'missing' : `"${ogUrl}"`}, expected "${page.url}"`);
      if (canonical && ogUrl && ogUrl !== canonical) out.push(`og:url "${ogUrl}" differs from canonical "${canonical}"`);
      return out;
    }), 'Open Graph problems');
  });

  test('og:image is an absolute https URL of a JPEG that exists in app/ (1200 px variant) with matching og:image:width/height', () => {
    const manifest = S.loadManifest();
    // jpg variant URL -> { source, w, maxW }
    const variants = new Map();
    if (manifest) {
      for (const [source, entry] of Object.entries(manifest)) {
        const jpgs = (entry && entry.jpg) || [];
        const maxW = Math.max(0, ...jpgs.map((v) => v.w));
        for (const v of jpgs) variants.set(v.src, { source, w: v.w, maxW });
      }
    }
    expectNone(checkPages(indexable, (page, doc) => {
      const out = [];
      const img = metaContent(doc, 'og:image');
      if (!img) return ['og:image missing'];
      if (!img.startsWith(`${SITE}/`)) return [`og:image "${img}" is not an absolute URL on ${SITE}`];
      const r = S.resolveLocal(img, page.path, data);
      if (!r.file || !S.appExists(r.file)) return [`og:image file does not exist in app/: ${img}`];
      if (!/\.jpe?g$/i.test(r.file)) out.push(`og:image should be a JPEG (social networks do not all read WebP): ${img}`);
      const size = imageSize(fs.readFileSync(S.appFile(r.file)));
      const w = metaContent(doc, 'og:image:width');
      const h = metaContent(doc, 'og:image:height');
      if (!/^\d+$/.test(w || '') || !/^\d+$/.test(h || '')) out.push(`og:image:width/height missing or not integers (${w} x ${h})`);
      else if (size && (Number(w) !== size.width || Number(h) !== size.height)) out.push(`og:image:width/height ${w}x${h} do not match the file ${size.width}x${size.height}`);
      if (manifest) {
        const v = variants.get(r.path);
        if (!v) out.push(`og:image ${r.path} is not a JPEG variant from src/img/manifest.json`);
        else {
          if (v.w !== 1200 && v.w !== v.maxW) out.push(`og:image uses the ${v.w} px variant; use the 1200 px variant (or the largest when the original is narrower)`);
          if (page.type === 'artwork' && page.artwork.images && page.artwork.images[0] && v.source !== page.artwork.images[0].src) {
            out.push(`og:image comes from ${v.source}, expected the main image ${page.artwork.images[0].src}`);
          }
        }
      }
      return out;
    }), 'og:image problems');
  });

  test('twitter:card is summary_large_image', () => {
    expectNone(checkPages(indexable, (page, doc) => {
      const v = metaContent(doc, 'twitter:card');
      return v === 'summary_large_image' ? [] : [`twitter:card is ${v === null ? 'missing' : `"${v}"`}`];
    }), 'twitter:card problems');
  });

  test('charset utf-8, responsive viewport, favicon and apple-touch-icon on every page', () => {
    expectNone(checkPages(pages, (page, doc) => {
      const out = [];
      const charset = qs(doc, 'meta[charset]');
      if (!charset || String(attr(charset, 'charset')).toLowerCase() !== 'utf-8') out.push('<meta charset="utf-8"> missing');
      const vp = attr(qs(doc, 'meta[name="viewport"]'), 'content');
      if (!vp || !/width=device-width/.test(vp)) out.push('<meta name="viewport" content="width=device-width, ..."> missing');
      if (!qs(doc, 'link[rel~="icon"]')) out.push('favicon <link rel="icon"> missing');
      if (!qs(doc, 'link[rel~="apple-touch-icon"]')) out.push('<link rel="apple-touch-icon"> missing');
      return out;
    }), 'basic head tags missing');
  });

  test('404.html has <meta name="robots" content="noindex"> and no canonical link', () => {
    const page = pages.find((p) => p.type === '404');
    expectNone(checkPages([page], (p, doc) => {
      const out = [];
      const robots = attr(qs(doc, 'meta[name="robots"]'), 'content');
      if (!robots || !/noindex/i.test(robots)) out.push(`robots meta is ${robots === null ? 'missing' : `"${robots}"`} (needs noindex)`);
      if (qs(doc, 'link[rel~="canonical"]')) out.push('404 page must not have a canonical link');
      return out;
    }), '404 page problems');
  });

  test('indexable pages are not marked noindex', () => {
    expectNone(checkPages(indexable, (page, doc) => {
      const robots = attr(qs(doc, 'meta[name="robots"]'), 'content');
      return robots && /noindex|none/i.test(robots) ? [`robots meta "${robots}" blocks indexing`] : [];
    }), 'indexable pages blocked from indexing');
  });
});
