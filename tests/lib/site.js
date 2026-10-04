'use strict';
// Site model for the tests: paths, data.json, the expected page list (SPEC section 4), URL <-> file mapping,
// file walking and a parse cache for built HTML pages.
//
// Env:
//   APP_DIR  directory under test (default "app"; relative to the repository root, or absolute)

const fs = require('node:fs');
const path = require('node:path');
const { parseHtml } = require('./html');
const { cpLen } = require('./checks');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_DIR = path.resolve(ROOT, process.env.APP_DIR || 'app');
const DATA_FILE = path.join(ROOT, 'data.json');
const DATA_DE_FILE = path.join(ROOT, 'data.de.json');
const LANGS = ['en', 'de'];
/** URL prefix of a language: English at the root, German below /de/. */
const LANG_PREFIX = { en: '', de: '/de' };
const MANIFEST_FILE = path.join(ROOT, 'src', 'img', 'manifest.json');
const DEFAULT_SITE_URL = 'https://polina-shvedko.art';

const ALLOWED_STATUS = ['available', 'private-collection'];
const ALLOWED_CARD = ['wide', 'standard'];
const REMOVED_FIELDS = ['lid', 'price', 'sold', 'col_class', 'clear_after', 'img_padding', 'preview1', 'preview2',
  'detail_images', 'dimensions', 'blog_posts', 'oil_gallery', 'pastel_gallery', 'aquarell_gallery'];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TEXT_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.json', '.xml', '.txt', '.svg',
  '.webmanifest', '.map', '.md']);

let dataCache = null;
function loadData() {
  if (!dataCache) dataCache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return dataCache;
}

let dataDeCache = null;
function loadDataDe() {
  if (!dataDeCache) dataDeCache = JSON.parse(fs.readFileSync(DATA_DE_FILE, 'utf8'));
  return dataDeCache;
}

/** data.json with the German texts in place (the build's own localizeData(), so the tests see what it renders). */
function localizedData(lang, data = loadData()) {
  if (lang === 'en') return data;
  const { localizeData } = require('../../scripts/build-site.js');
  return localizeData(data, loadDataDe());
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_FILE)) return null;
  return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
}

function siteUrl(data = loadData()) {
  return String((data.site && data.site.url) || DEFAULT_SITE_URL).replace(/\/+$/, '');
}

function siteHost(data = loadData()) {
  return new URL(siteUrl(data)).host;
}

/** Display size string used on pages and in meta descriptions: "29.7 × 42 cm" (U+00D7). */
function sizeText(artwork, lang = 'en') {
  const n = (v) => (lang === 'de' ? String(v).replace('.', ',') : String(v));
  return `${n(artwork.width_cm)} × ${n(artwork.height_cm)} cm`;
}

/**
 * Every page the build must produce, from data.json (SPEC sections 3 and 4).
 * Page: { type, key, path, url, file (relative to APP_DIR, posix), indexable, hub?, artwork?, index?, prev?, next? }
 */
function sitePages(data = loadData(), langs = LANGS) {
  const pages = [];
  for (const lang of langs) pages.push(...langPages(lang === 'en' ? data : localizedData(lang, data), lang));
  return pages;
}

/** The pages of one language (data: localized data.json); keys and files carry the /de prefix for German. */
function langPages(data, lang) {
  const base = siteUrl(data);
  const P = LANG_PREFIX[lang];
  const F = P ? `${P.slice(1)}/` : '';
  const K = lang === 'en' ? '' : `${lang}:`;
  const pages = [];
  const add = (p) => { pages.push({ ...p, lang, data, key: K + p.key, path: P + p.path, file: F + p.file, url: base + P + p.path }); };
  add({ type: 'home', key: 'home', path: '/', file: 'index.html', indexable: true });
  for (const hub of data.hubs || []) {
    add({ type: 'hub', key: `hub:${hub.key}`, path: `/${hub.path}/`, file: `${hub.path}/index.html`, indexable: true, hub });
    const list = hub.artworks || [];
    list.forEach((artwork, index) => {
      add({
        type: 'artwork',
        key: `artwork:${artwork.slug}`,
        path: `/${hub.path}/${artwork.slug}/`,
        file: `${hub.path}/${artwork.slug}/index.html`,
        indexable: true,
        hub,
        artwork,
        index,
        prev: index > 0 ? list[index - 1] : null,
        next: index < list.length - 1 ? list[index + 1] : null,
        first: list[0],
        last: list[list.length - 1],
      });
    });
  }
  add({ type: 'about', key: 'about', path: '/about/', file: 'about/index.html', indexable: true });
  add({ type: 'contact', key: 'contact', path: '/contact/', file: 'contact/index.html', indexable: true });
  const legal = data.legal || {};
  if (legal.imprint_html) add({ type: 'imprint', key: 'imprint', path: '/imprint/', file: 'imprint/index.html', indexable: true });
  if (legal.privacy_html) add({ type: 'privacy', key: 'privacy', path: '/privacy/', file: 'privacy/index.html', indexable: true });
  add({ type: '404', key: '404', path: '/404.html', file: '404.html', indexable: false });
  return pages;
}

function indexablePages(data = loadData(), langs = LANGS) {
  return sitePages(data, langs).filter((p) => p.indexable);
}

function artworkPath(hub, artwork, lang = 'en') {
  return `${LANG_PREFIX[lang]}/${hub.path}/${artwork.slug}/`;
}

/** Artwork <title> candidates (SPEC section 6); returns the expected title. */
function expectedArtworkTitle(hub, artwork) {
  if (artwork.seo_title) return artwork.seo_title;
  const suffix = ' | Polina Shvedko';
  const candidates = [
    `${artwork.title} - ${hub.medium_label}, ${artwork.year}${suffix}`,
    `${artwork.title} - ${hub.medium_label}${suffix}`,
    `${artwork.title}${suffix}`,
  ];
  for (const c of candidates) if (cpLen(c) <= 60) return c;
  return null; // rule 4 (title cut at a word boundary + "…"): checked by shape, not by exact text
}

/** Expected <title> for a page, or null when only the shape can be checked. */
function expectedTitle(page, data = page.data || loadData()) {
  switch (page.type) {
    case 'home': return data.site && data.site.seo_title;
    case 'hub': return page.hub.seo_title;
    case 'about': case 'contact': return data.pages && data.pages[page.type] && data.pages[page.type].seo_title;
    case 'artwork': return expectedArtworkTitle(page.hub, page.artwork);
    default: return null;
  }
}

/** Expected meta description (exact) or, for artworks, the fixed prefix the generated text starts with. */
function expectedDescription(page, data = page.data || loadData()) {
  switch (page.type) {
    case 'home': return { exact: data.site && data.site.seo_description };
    case 'hub': return { exact: page.hub.seo_description };
    case 'about': case 'contact': return { exact: data.pages && data.pages[page.type] && data.pages[page.type].seo_description };
    case 'artwork': {
      const a = page.artwork;
      if (a.seo_description) return { exact: a.seo_description };
      if (page.lang === 'de') return { prefix: `${a.title}, ${a.medium} von Polina Shvedko (${a.year}), ${sizeText(a, 'de')}.` };
      return { prefix: `${a.title}, ${String(a.medium).toLowerCase()} by Polina Shvedko (${a.year}), ${sizeText(a)}.` };
    }
    default: return {};
  }
}

// ---------------------------------------------------------------------------------------------------
// URL -> file

/**
 * Resolve a URL found in a page (href/src) to a file path relative to APP_DIR.
 * Returns { external: true } for other hosts and non-http schemes, { file, path, hash } otherwise.
 * `fromPath` is the URL path of the page (or CSS file) that contains the reference.
 */
function resolveLocal(ref, fromPath, data = loadData()) {
  const raw = String(ref || '').trim();
  if (!raw) return { empty: true };
  if (/^(mailto|tel|javascript|data|blob|sms|whatsapp):/i.test(raw)) return { external: true, scheme: raw.split(':')[0].toLowerCase() };
  let u;
  try {
    u = new URL(raw, `${siteUrl(data)}${fromPath.startsWith('/') ? fromPath : `/${fromPath}`}`);
  } catch {
    return { invalid: true };
  }
  const host = siteHost(data);
  if (u.host !== host && u.host !== `www.${host}`) return { external: true, host: u.host };
  if (!/^https?:$/.test(u.protocol)) return { external: true, scheme: u.protocol };
  let p;
  try { p = decodeURIComponent(u.pathname); } catch { p = u.pathname; }
  let file = p.replace(/^\/+/, '');
  if (file === '' || file.endsWith('/')) file += 'index.html';
  return { file, path: u.pathname, hash: u.hash ? u.hash.slice(1) : '', search: u.search, url: u.href };
}

function appFile(rel) {
  return path.join(APP_DIR, ...String(rel).split('/'));
}

function appExists(rel) {
  try {
    return fs.statSync(appFile(rel)).isFile();
  } catch {
    return false;
  }
}

function relApp(abs) {
  return path.relative(APP_DIR, abs).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------------------------------
// File walking

/** All files below `dir` (symlinked directories followed once), as absolute paths, sorted. */
function walkFiles(dir) {
  const out = [];
  const seen = new Set();
  const visit = (d) => {
    let real;
    try { real = fs.realpathSync(d); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) visit(full); else if (st.isFile()) out.push(full);
    }
  };
  visit(dir);
  return out.sort();
}

function isTextFile(file) {
  const base = path.basename(file);
  if (base === '.htaccess' || base === 'robots.txt' || base === '_redirects') return true;
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/** Text files in APP_DIR: [{ abs, rel }] */
function appTextFiles() {
  if (!fs.existsSync(APP_DIR)) return [];
  return walkFiles(APP_DIR).filter(isTextFile).map((abs) => ({ abs, rel: relApp(abs) }));
}

function appHtmlFiles() {
  return appTextFiles().filter((f) => /\.html?$/i.test(f.rel));
}

// ---------------------------------------------------------------------------------------------------
// Parsed page cache

const pageCache = new Map();
/** Parsed HTML of a built file (relative to APP_DIR) or null when the file does not exist. */
function loadAppHtml(rel) {
  if (pageCache.has(rel)) return pageCache.get(rel);
  let result = null;
  if (appExists(rel)) {
    const source = fs.readFileSync(appFile(rel), 'utf8');
    result = { rel, source, doc: parseHtml(source) };
  }
  pageCache.set(rel, result);
  return result;
}

/** The URL path a built HTML file is served at ("oil-paintings/index.html" -> "/oil-paintings/"). */
function urlPathForFile(rel) {
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  return `/${rel}`;
}

// ---------------------------------------------------------------------------------------------------
// Data helpers

/** Every image path referenced by data.json, with where it is used (SPEC section 5 list). */
function dataImageRefs(data = loadData()) {
  const refs = [];
  const add = (src, where) => { if (typeof src === 'string' && src) refs.push({ src, where }); };
  const images = (data.site && data.site.images) || {};
  for (const [k, v] of Object.entries(images)) add(v, `site.images.${k}`);
  for (const hub of data.hubs || []) {
    for (const a of hub.artworks || []) {
      add(a.preview, `${a.slug}.preview`);
      add(a.preview_hover, `${a.slug}.preview_hover`);
      (a.images || []).forEach((im, n) => add(im && im.src, `${a.slug}.images[${n}]`));
      for (const m of String(a.story_html || '').matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) add(m[1], `${a.slug}.story_html`);
    }
  }
  (data.socialmedia_images || []).forEach((im, n) => add(im && im.src, `socialmedia_images[${n}]`));
  return refs;
}

function allArtworks(data = loadData()) {
  const out = [];
  for (const hub of data.hubs || []) for (const a of hub.artworks || []) out.push({ hub, artwork: a });
  return out;
}

module.exports = {
  ROOT,
  APP_DIR,
  DATA_FILE,
  DATA_DE_FILE,
  LANGS,
  LANG_PREFIX,
  loadDataDe,
  localizedData,
  MANIFEST_FILE,
  DEFAULT_SITE_URL,
  ALLOWED_STATUS,
  ALLOWED_CARD,
  REMOVED_FIELDS,
  SLUG_RE,
  loadData,
  loadManifest,
  siteUrl,
  siteHost,
  sizeText,
  sitePages,
  indexablePages,
  artworkPath,
  expectedArtworkTitle,
  expectedTitle,
  expectedDescription,
  resolveLocal,
  appFile,
  appExists,
  relApp,
  walkFiles,
  isTextFile,
  appTextFiles,
  appHtmlFiles,
  loadAppHtml,
  urlPathForFile,
  dataImageRefs,
  allArtworks,
};
