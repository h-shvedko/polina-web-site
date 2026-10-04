#!/usr/bin/env node
'use strict';
/*
 * HTML build for polina-shvedko.art (ADR-0003; implementation spec sections 3, 6, 7, 8).
 *
 *   node scripts/build-site.js [--out <dir>]      write every page and sitemap.xml
 *   gulp pages  (aliases: gulp html, gulp sitemap)
 *   require('./scripts/build-site.js').build({ root, outDir })  -> Promise<summary>
 *
 * Inputs (never anything in outDir, so a build into an empty directory works):
 *   data.json                    site, page meta, hubs with their artworks, Instagram images, legal texts
 *   src/img/manifest.json        image variants written by scripts/images.js (sharp is not needed here)
 *   src/templates/pages/*.mustache, src/templates/partials/*.mustache
 *   src/css/site.css, src/js/*.js   hashed for the ?v=<8 hex> query of their URLs
 *   src/css/webfonts/**\/*.woff2  preloaded in <head>
 *
 * Output: <outDir>/index.html, <hub>/index.html, <hub>/<slug>/index.html, about/, contact/, 404.html,
 * imprint/ and privacy/ only when data.json legal.*_html is set, and sitemap.xml. Files are rewritten only
 * when their content changes. The output is deterministic: no timestamps, data.json order everywhere.
 *
 * The build throws (CLI: exit code 1) on a missing manifest entry for a referenced image, a duplicate or
 * malformed slug, an unknown or incomplete hub, an unknown artwork status, a <title> over 60 characters or a
 * duplicate title, a meta description outside 120-155 characters, invalid JSON-LD, and a missing template,
 * partial, stylesheet or script (a mistyped {{> name}} would otherwise render as nothing).
 *
 * Line endings do not matter: templates are read with LF and the ?v= hashes ignore CR, so a checkout with CRLF
 * builds the same bytes. Run as root (the dev container), the output gets the owner of the repository.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Mustache = require('mustache');
const { matchOwner } = require('./file-owner');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

const TITLE_MAX = 60;
const DESCRIPTION_MIN = 120;
const DESCRIPTION_MAX = 155;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERSON_JOB_TITLE = 'Visual artist';

/* Scripts per page type (SPEC section 8). consent.js carries data-ga-id on its tag. */
const SCRIPTS_ALL = ['consent.js', 'analytics.js', 'nav.js'];
const SCRIPTS_BY_TYPE = { home: ['hero.js'], artwork: ['artwork.js'] };
const STYLESHEET = 'site.css';

/* Status texts (SPEC sections 1 and 6). */
const STATUS = {
  available: {
    text: 'Available — ask about this work',
    badge: '',
    ctaLabel: 'Ask about this work',
    ctaSubject: 'Inquiry: ',
    descriptionSuffix: ' Ask the artist about this work.',
  },
  'private-collection': {
    text: 'In a private collection',
    badge: 'Private collection',
    ctaLabel: 'Contact the artist',
    ctaSubject: 'Question about: ',
    descriptionSuffix: ' Contact the artist about similar works.',
  },
};
const CARD_TYPES = ['wide', 'standard'];
/* The artwork fields of data.json (CLAUDE.md "Data"); any other field fails the build, so a typo or an unused
   field cannot sit in the data unnoticed. */
const ARTWORK_FIELDS = new Set(['slug', 'title', 'year', 'medium', 'surface', 'width_cm', 'height_cm', 'frame', 'description',
  'status', 'card', 'preview', 'preview_hover', 'preview_alt', 'preview_hover_alt', 'images', 'story_html', 'story_confirmed',
  'seo_title', 'seo_description', 'updated']);

/*
 * `sizes` attributes: the CSS width of each image box in the current design, per layout band of the
 * previous site (>=1201, 961-1200, 641-960, 481-640, <=480), as measured on the previous build.
 * Change them together with the layout in src/css/site.css.
 */
const SIZES = {
  hero: '100vw',
  avatar: '180px',
  portrait: '180px',
  photo: '(min-width: 641px) 374px, (min-width: 481px) 336px, 255px',
  story: '(min-width: 1201px) 760px, (min-width: 641px) 580px, calc(100vw - 40px)',
};
/*
 * Boxes that crop their image with object-fit: cover (site.css .card__media, .instagram__tile, .artwork__thumb):
 * the box width per band ([min-width or null, CSS width]) and the box ratio width / height. An image wider than
 * its box is drawn at the box height, so its `sizes` is the box width times (image ratio / box ratio); see
 * coverSizes(). The old site served the originals here, so a box-width `sizes` made wide images blurry.
 */
const COVER_BOXES = {
  card: { ratio: 1 / 0.97222, bands: [[1201, '360px'], [961, '300px'], [641, '280px'], [481, 'calc(50vw - 30px)'], [null, 'calc(100vw - 40px)']] },
  // the wide card keeps its full row on two-column layouts (site.css; the old half-width card was a defect)
  cardWide: { ratio: 1 / 0.32407, bands: [[1201, '1160px'], [961, '940px'], [641, '600px'], [null, 'calc(100vw - 40px)']] },
  mosaicBig: { ratio: 1, bands: [[1201, '570px'], [961, '460px'], [641, '600px'], [null, 'calc(100vw - 40px)']] },
  mosaicSmall: { ratio: 1, bands: [[1201, '275px'], [961, '220px'], [641, '295px'], [null, 'calc(50vw - 25px)']] },
  thumb: { ratio: 1, bands: [[641, '60px'], [null, '40px']] },
};
/* Square main image box of the artwork page (the old popup): box width per band; see artworkSizes(). */
const ARTWORK_BOX = [[1201, 560], [961, 460], [641, 580]];

/* Alt texts of the fixed site images (data.json site.images holds only their paths). */
const SITE_IMAGE_ALT = {
  hero_poster: 'Still from the video: a brush paints a landscape in oil on canvas',
  avatar: 'Illustrated avatar of Polina Shvedko',
  photo: 'Polina Shvedko in front of hydrangeas',
  portrait: 'Portrait of Polina Shvedko',
};

/* Icons in the contact section, in the order of the current site; JSON-LD sameAs keeps data.json order. */
const SOCIAL_ORDER = ['facebook', 'instagram', 'linkedin', 'etsy'];

/* Instagram mosaic: the first tiles of data.json socialmedia_images (one big, four small). */
const MOSAIC_TILES = 5;

/*
 * Styles for pages without JavaScript, rendered as <noscript><style> in <head> (they apply only when scripting
 * is off). Every page: the footer "Cookie settings" button needs consent.js, so its list item is hidden.
 */
const NOSCRIPT_BASE_CSS = '.site-footer__item--settings{display:none}';
/*
 * Artwork pages (SPEC section 7: "without JS all images remain reachable"): the hidden slides are shown one
 * below the other and the switcher controls, which need artwork.js, are hidden.
 */
const NOSCRIPT_GALLERY_CSS = '.artwork__main picture[hidden]{display:block}.artwork__prev,.artwork__next,.artwork__thumbs{display:none}';
/*
 * Home: nav.js never reveals the sticky nav (it starts hidden above the hero), and the video play button needs
 * hero.js. So the nav is shown from the start and the play button is hidden.
 */
const NOSCRIPT_HOME_CSS = '#site-nav{transform:none}.hero__play{display:none}';

/* Consent banner text (draft; the ADR asks the owner to approve it). */
const CONSENT_TEXT = 'With your consent, this website uses Google Analytics cookies to see how visitors use it. You can change your choice at any time under Cookie settings.';

/* Legal pages: generated only when data.json legal.<key>_html is set. Meta defaults when data.json pages.<key> is missing. */
const LEGAL = [
  {
    key: 'imprint',
    field: 'imprint_html',
    label: 'Imprint',
    title: 'Imprint | Polina Shvedko',
    description: 'Imprint (Impressum) of polina-shvedko.art, the website of the artist Polina Shvedko from Germany, with the legal details of the site owner.',
  },
  {
    key: 'privacy',
    field: 'privacy_html',
    label: 'Privacy policy',
    title: 'Privacy policy | Polina Shvedko',
    description: 'Privacy policy of polina-shvedko.art: what data this website processes, how Google Analytics is used only with your consent, and your rights.',
  },
];

/* Partials that are used inside a line: their trailing line break is removed when they are loaded. */
const INLINE_PARTIAL_RE = /^(picture|icon-.+)$/;

/* Paths a hub must not take (pages, assets and retired URLs). */
const RESERVED_PATHS = new Set(['about', 'contact', 'imprint', 'privacy', 'css', 'js', 'img', 'blog', 'partials', 'sitemap.xml', 'robots.txt', '404.html']);

/* ------------------------------------------------------------------------------------------------ */
/* small helpers                                                                                     */

class BuildError extends Error {}
function fail(message) {
  throw new BuildError(`build-site: ${message}`);
}

const cpLen = (s) => [...String(s)].length;

/** HTML escaping for Mustache {{ }} in text and double-quoted attributes (keeps "/" and "=" readable). */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Plain text: tags removed, the basic entities decoded, whitespace collapsed. */
function plainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Words a cut text must not end on ("…charm of a…"), and abbreviations whose dot the cut removes ("…of St…"). */
const DANGLING_WORDS = new Set(('a an the of in on at to into onto over under and or but nor as by with without for from '
  + 'than that this these those its their his her our your my is are was were be which who whose where when while').split(' '));
const ABBREVIATION_RE = /^(?:[A-Z]|St|Dr|Mr|Mrs|Ms|Mt|No)$/;
const SENTENCE_END_RE = /[.!?]["”’)]?(?=\s|$)/g;

/**
 * Cut a text at a word boundary so that it has at most `max` characters including the ellipsis. The cut never
 * ends on punctuation, an article, a preposition, a conjunction or an abbreviation.
 */
function cutAtWord(text, max, ellipsis = '…') {
  const chars = [...text];
  if (chars.length <= max) return text;
  const room = max - cpLen(ellipsis);
  let cut = chars.slice(0, room).join('');
  if (!/\s/.test(chars[room] || '')) {
    const space = cut.search(/\s\S*$/);
    if (space > 0) cut = cut.slice(0, space);
  }
  const trim = (s) => s.replace(/[\s,;:.!?…\-–—("“'‘]+$/u, '');
  cut = trim(cut);
  for (;;) {
    const m = /(\s)(\S+)$/.exec(cut);
    if (!m || cut.slice(0, m.index).split(/\s+/).length < 3) break;
    if (!DANGLING_WORDS.has(m[2].toLowerCase()) && !ABBREVIATION_RE.test(m[2])) break;
    cut = trim(cut.slice(0, m.index));
  }
  return `${cut}${ellipsis}`;
}

/**
 * Fit a text into `max` characters: as is when it fits; else at the last sentence end that keeps at least
 * `min` characters (no ellipsis); else cut at a word with "…". A dot after an initial or an abbreviation
 * ("P. Molina", "St. Albani") is not a sentence end.
 */
function fitText(text, min, max) {
  if (cpLen(text) <= max) return text;
  let best = -1;
  for (const m of text.matchAll(SENTENCE_END_RE)) {
    const end = m.index + m[0].length;
    const word = /(\S+)$/.exec(text.slice(0, m.index + 1));
    if (word && ABBREVIATION_RE.test(word[1].replace(/[.!?]$/, ''))) continue;
    const n = cpLen(text.slice(0, end));
    if (n > max) break;
    if (n >= min) best = end;
  }
  return best > 0 ? text.slice(0, best) : cutAtWord(text, max);
}

/** Visible running text: no line break inside a size ("190 × 45 cm") or after an initial ("P. Molina"). */
function keepTogether(text) {
  return String(text)
    .replace(/(\d|\bcm|\bmm)[ \t]+×[ \t]+(?=\d)/g, '$1\u00a0×\u00a0')
    .replace(/(\d)[ \t]+(cm|mm)\b/g, '$1\u00a0$2')
    .replace(/\b([A-Z]|St|Dr|Mr|Mrs|Ms|Mt)\.[ \t]+(?=[A-Z])/g, '$1.\u00a0');
}

/**
 * A first description paragraph that opens with the title (quoted or not) and goes on with a verb: the title
 * becomes "It". A credit after the title stays, as the artist wrote it: '"Cala Secreta" (Inspired by P. Molina)
 * reveals ...' -> 'Inspired by P. Molina, it reveals ...'. Other paragraphs come back unchanged.
 */
function withoutTitleEcho(title, text) {
  const esc = String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const credit = '(?:\\s*\\(((?:inspired by|after)\\b[^)]*)\\))?';
  const m = new RegExp(`^["“]?${esc}${credit}["”]?${credit}\\s+`, 'i').exec(text);
  const rest = m ? text.slice(m[0].length) : '';
  if (!m || !/^[a-z]/.test(rest)) return text;
  const by = (m[1] || m[2] || '').trim();
  return by ? `${by.charAt(0).toUpperCase()}${by.slice(1)}, it ${rest}` : `It ${rest}`;
}

/**
 * `sizes` of an image shown with object-fit: cover in a box of COVER_BOXES: each band width times
 * max(1, (image width / height) / box ratio), the width the browser really draws the image at.
 */
function coverSizes(box, width, height) {
  const { ratio, bands } = COVER_BOXES[box];
  const k = Number(Math.max(1, width / height / ratio).toFixed(3));
  const scale = (w) => {
    if (k === 1) return w;
    const px = /^(\d+(?:\.\d+)?)px$/.exec(w);
    if (px) return `${Math.round(Number(px[1]) * k)}px`;
    const calc = /^calc\((.*)\)$/.exec(w);
    return `calc((${calc ? calc[1] : w}) * ${k})`;
  };
  return bands.map(([min, w]) => (min ? `(min-width: ${min}px) ${scale(w)}` : scale(w))).join(', ');
}

/** CR is ignored, so a checkout with CRLF line endings gets the same ?v= hashes as CI. */
const sha8 = (buffer) => crypto.createHash('sha256').update(Buffer.from(buffer.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8')).digest('hex').slice(0, 8);

function readJson(file, what) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(`cannot read ${what} (${file}): ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return fail(`${what} (${file}) is not valid JSON: ${e.message}`);
  }
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const posix = (p) => p.split(path.sep).join('/');

/* ------------------------------------------------------------------------------------------------ */
/* inputs                                                                                            */

function loadTemplates(root) {
  const dir = path.join(root, 'src', 'templates');
  const read = (sub) => {
    const map = {};
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) fail(`missing template directory ${d}`);
    for (const name of fs.readdirSync(d).sort()) {
      if (!name.endsWith('.mustache')) continue;
      const key = name.slice(0, -'.mustache'.length);
      let text = fs.readFileSync(path.join(d, name), 'utf8').replace(/\r\n?/g, '\n');
      // Inline partials (used inside a line, e.g. a <picture> in a button) must not add a line break.
      if (sub === 'partials' && INLINE_PARTIAL_RE.test(key)) text = text.replace(/\s+$/, '');
      map[key] = text;
    }
    return map;
  };
  return { pages: read('pages'), partials: read('partials') };
}

/** Every {{> name}} in every template must name an existing partial (Mustache renders an unknown one as ''). */
function checkPartialRefs(templates) {
  const problems = [];
  const visit = (tokens, file) => {
    for (const token of tokens) {
      if (token[0] === '>' && !Object.prototype.hasOwnProperty.call(templates.partials, token[1])) problems.push(`${file}: {{> ${token[1]}}}`);
      if (Array.isArray(token[4])) visit(token[4], file);
    }
  };
  for (const [kind, map] of Object.entries(templates)) {
    for (const [name, text] of Object.entries(map)) {
      let tokens;
      try {
        tokens = Mustache.parse(text);
      } catch (e) {
        fail(`src/templates/${kind}/${name}.mustache does not parse: ${e.message}`);
      }
      visit(tokens, `src/templates/${kind}/${name}.mustache`);
    }
  }
  if (problems.length) fail(`unknown partial(s), no such file in src/templates/partials/:\n  ${problems.join('\n  ')}`);
}

/** Partials for Mustache.render: a lookup that throws on an unknown name instead of rendering nothing. */
function partialLookup(templates) {
  return (name) => {
    if (!Object.prototype.hasOwnProperty.call(templates.partials, name)) fail(`unknown partial "${name}" (src/templates/partials/${name}.mustache does not exist)`);
    return templates.partials[name];
  };
}

/** Content hashes of the stylesheet and scripts (computed from src/, so outDir may be empty). */
function loadAssets(root) {
  const cssFile = path.join(root, 'src', 'css', STYLESHEET);
  if (!fs.existsSync(cssFile)) fail(`missing stylesheet src/css/${STYLESHEET}`);
  const scripts = {};
  for (const name of [...SCRIPTS_ALL, ...Object.values(SCRIPTS_BY_TYPE).flat()]) {
    const file = path.join(root, 'src', 'js', name);
    if (!fs.existsSync(file)) fail(`missing script src/js/${name}`);
    scripts[name] = `/js/${name}?v=${sha8(fs.readFileSync(file))}`;
  }
  const fontDir = path.join(root, 'src', 'css', 'webfonts');
  const fonts = walk(fontDir)
    .filter((f) => f.toLowerCase().endsWith('.woff2'))
    .map((f) => ({ href: `/css/webfonts/${posix(path.relative(fontDir, f))}` }));
  return { css: `/css/${STYLESHEET}?v=${sha8(fs.readFileSync(cssFile))}`, scripts, fonts };
}

/* ------------------------------------------------------------------------------------------------ */
/* validation of data.json                                                                           */

function requireString(obj, key, where) {
  if (typeof obj[key] !== 'string' || !obj[key].trim()) fail(`${where}: "${key}" must be a non-empty string`);
}

function validateData(data) {
  if (!data || typeof data !== 'object') fail('data.json is empty');
  const site = data.site;
  if (!site) fail('data.json has no "site"');
  for (const k of ['url', 'name', 'lastmod', 'email', 'ga_measurement_id', 'youtube_id', 'seo_title', 'seo_description']) requireString(site, k, 'site');
  if (!/^https:\/\/[^/]+$/.test(site.url)) fail(`site.url "${site.url}" must be https://<host> without a trailing slash`);
  if (!DATE_RE.test(site.lastmod)) fail(`site.lastmod "${site.lastmod}" must be YYYY-MM-DD`);
  if (!site.images) fail('site.images is missing');
  for (const k of Object.keys(SITE_IMAGE_ALT).concat('og_default')) requireString(site.images, k, 'site.images');
  if (!Array.isArray(site.social) || !site.social.length) fail('site.social must list the social profiles');
  for (const s of site.social) {
    requireString(s, 'name', 'site.social[]');
    requireString(s, 'url', 'site.social[]');
  }
  if (!site.social.some((s) => s.name.toLowerCase() === 'instagram')) fail('site.social needs an Instagram entry (Instagram section)');
  for (const k of ['about', 'contact']) {
    if (!data.pages || !data.pages[k]) fail(`data.json pages.${k} is missing`);
    requireString(data.pages[k], 'seo_title', `pages.${k}`);
    requireString(data.pages[k], 'seo_description', `pages.${k}`);
  }
  if (!Array.isArray(data.hubs) || !data.hubs.length) fail('data.json has no hubs');
  const hubKeys = new Set();
  const hubPaths = new Set();
  const slugs = new Map();
  data.hubs.forEach((hub, i) => {
    const where = `hub #${i + 1}${hub && hub.key ? ` (${hub.key})` : ''}`;
    if (!hub || typeof hub !== 'object') fail(`unknown hub: ${where} is not an object`);
    for (const k of ['key', 'path', 'label', 'section_heading', 'h1', 'all_link', 'medium_label', 'artform', 'seo_title', 'seo_description']) {
      if (typeof hub[k] !== 'string' || !hub[k].trim()) fail(`unknown hub: ${where} has no "${k}"`);
    }
    if (!SLUG_RE.test(hub.key)) fail(`unknown hub: key "${hub.key}" must match ${SLUG_RE}`);
    if (!SLUG_RE.test(hub.path)) fail(`unknown hub: path "${hub.path}" must match ${SLUG_RE}`);
    if (RESERVED_PATHS.has(hub.path)) fail(`unknown hub: path "${hub.path}" is reserved`);
    if (hubKeys.has(hub.key)) fail(`unknown hub: duplicate hub key "${hub.key}"`);
    if (hubPaths.has(hub.path)) fail(`unknown hub: duplicate hub path "${hub.path}"`);
    hubKeys.add(hub.key);
    hubPaths.add(hub.path);
    if (!Array.isArray(hub.intro) || !hub.intro.length) fail(`${where}: "intro" must be a list of paragraphs`);
    if (!Array.isArray(hub.artworks) || !hub.artworks.length) fail(`${where}: no artworks`);
    hub.artworks.forEach((a, j) => {
      const aw = `${where} artwork #${j + 1}${a && a.slug ? ` (${a.slug})` : ''}`;
      if (!a || typeof a !== 'object') fail(`${aw} is not an object`);
      for (const k of ['slug', 'title', 'medium', 'surface', 'status', 'card', 'preview', 'preview_hover']) requireString(a, k, aw);
      if (!SLUG_RE.test(a.slug)) fail(`${aw}: slug "${a.slug}" must match ${SLUG_RE}`);
      if (slugs.has(a.slug)) fail(`duplicate slug "${a.slug}" (${slugs.get(a.slug)} and ${hub.path})`);
      slugs.set(a.slug, hub.path);
      if (!Number.isInteger(a.year)) fail(`${aw}: year must be an integer`);
      for (const k of ['width_cm', 'height_cm']) if (typeof a[k] !== 'number' || !(a[k] > 0)) fail(`${aw}: ${k} must be a positive number`);
      if (!STATUS[a.status]) fail(`${aw}: unknown status "${a.status}" (allowed: ${Object.keys(STATUS).join(', ')})`);
      if (!CARD_TYPES.includes(a.card)) fail(`${aw}: unknown card "${a.card}" (allowed: ${CARD_TYPES.join(', ')})`);
      if (a.frame !== null && a.frame !== undefined && (typeof a.frame !== 'string' || !a.frame.trim())) fail(`${aw}: frame must be null or a non-empty string`);
      if (!Array.isArray(a.description) || !a.description.length || a.description.some((d) => typeof d !== 'string' || !d.trim())) fail(`${aw}: description must be a list of non-empty paragraphs`);
      if (!Array.isArray(a.images) || !a.images.length) fail(`${aw}: no images`);
      a.images.forEach((im, n) => {
        requireString(im, 'src', `${aw} images[${n}]`);
        requireString(im, 'alt', `${aw} images[${n}]`);
      });
      if (a.updated !== undefined && a.updated !== null && !DATE_RE.test(a.updated)) fail(`${aw}: updated "${a.updated}" must be YYYY-MM-DD`);
      for (const k of ['preview_alt', 'preview_hover_alt']) {
        if (a[k] !== undefined && a[k] !== null && (typeof a[k] !== 'string' || !a[k].trim())) fail(`${aw}: ${k} must be null or a non-empty string`);
      }
      const unknown = Object.keys(a).filter((k) => !ARTWORK_FIELDS.has(k));
      if (unknown.length) fail(`${aw}: unknown field(s) ${unknown.join(', ')} (the build reads only: ${[...ARTWORK_FIELDS].join(', ')})`);
    });
  });
  if (!Array.isArray(data.socialmedia_images)) fail('data.json socialmedia_images must be a list');
  data.socialmedia_images.forEach((im, n) => {
    requireString(im, 'src', `socialmedia_images[${n}]`);
    requireString(im, 'alt', `socialmedia_images[${n}]`);
  });
}

/* ------------------------------------------------------------------------------------------------ */
/* JSON-LD                                                                                           */

/** JSON for a <script type="application/ld+json"> element: "</" and "<!--" escaped so the element cannot end early. */
function serializeJsonLd(obj) {
  return JSON.stringify(obj).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\u0021--');
}

function validateJsonLd(obj, where, siteUrl) {
  const problems = [];
  const isAbs = (u) => typeof u === 'string' && u.startsWith(`${siteUrl}/`);
  const types = (n) => (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]);
  const visit = (node, trail) => {
    if (Array.isArray(node)) { node.forEach((v, i) => visit(v, `${trail}[${i}]`)); return; }
    if (!node || typeof node !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(node, 'offers')) problems.push(`${trail}: "offers" is not allowed (no shop)`);
    if (node['@type'] !== undefined) {
      const t = types(node);
      if (t.includes('Offer') || t.includes('AggregateOffer')) problems.push(`${trail}: Offer nodes are not allowed`);
      const need = (k, ok = (v) => v !== undefined && v !== null && v !== '') => { if (!ok(node[k])) problems.push(`${trail} (${t.join(',')}): "${k}" missing or invalid`); };
      if (t.includes('WebSite')) { need('url', isAbs); need('name'); }
      if (t.includes('Person')) { need('name'); if (node.url !== undefined) need('url', isAbs); }
      if (t.includes('CollectionPage')) {
        need('name'); need('url', isAbs); need('description'); need('isPartOf');
        need('mainEntity', (m) => m && Array.isArray(m.itemListElement) && m.itemListElement.length > 0);
      }
      if (t.includes('ListItem')) { need('position', Number.isInteger); need('name'); }
      if (t.includes('VisualArtwork')) {
        need('@id', isAbs); need('name'); need('url', isAbs);
        need('image', (v) => Array.isArray(v) && v.length > 0 && v.every(isAbs));
        need('description', (v) => typeof v === 'string' && v.trim() && !/[<>]/.test(v));
        need('creator', (v) => v && v['@id'] && v.name);
        need('dateCreated', (v) => typeof v === 'string' && /^\d{4}$/.test(v));
        for (const k of ['artMedium', 'artform', 'artworkSurface']) need(k);
        // QuantitativeValue in centimetres (UN/CEFACT CMT): since schema.org 30.0 Distance is a text data type, so the
        // object form {"@type": "Distance", "name": "42 cm"} is reported as an unknown "name" field.
        for (const k of ['width', 'height']) need(k, (v) => v && v['@type'] === 'QuantitativeValue' && typeof v.value === 'number' && v.value > 0 && v.unitCode === 'CMT' && v.unitText === 'cm');
      }
      if (t.includes('BreadcrumbList')) {
        need('itemListElement', (items) => Array.isArray(items) && items.length > 0
          && items.every((it, i) => it && it['@type'] === 'ListItem' && it.position === i + 1 && it.name && isAbs(it.item)));
      }
      if (t.includes('AboutPage') || t.includes('ContactPage') || t.includes('WebPage')) { need('url', isAbs); need('name'); }
    }
    for (const [k, v] of Object.entries(node)) visit(v, `${trail}.${k}`);
  };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) problems.push('top level must be an object');
  else {
    if (obj['@context'] !== 'https://schema.org') problems.push('"@context" must be "https://schema.org"');
    if (!obj['@type']) problems.push('"@type" missing');
    visit(obj, '$');
  }
  let roundTrip = null;
  try {
    roundTrip = JSON.parse(serializeJsonLd(obj));
  } catch (e) {
    problems.push(`does not serialise to valid JSON: ${e.message}`);
  }
  if (roundTrip && JSON.stringify(roundTrip) !== JSON.stringify(obj)) problems.push('does not survive a JSON round trip');
  if (problems.length) fail(`invalid JSON-LD on ${where}:\n  ${problems.join('\n  ')}`);
}

/* ------------------------------------------------------------------------------------------------ */
/* the build                                                                                         */

function createContext(root, data, manifest, assets, templates) {
  const site = data.site;
  const SITE = site.url;
  const PERSON_ID = `${SITE}/#person`;
  const WEBSITE_ID = `${SITE}/#website`;
  const year = site.lastmod.slice(0, 4);
  const legalPages = LEGAL.filter((l) => data.legal && typeof data.legal[l.field] === 'string' && data.legal[l.field].trim());

  const normRef = (src) => String(src).replace(/^\/+/, '');
  function entry(src, where) {
    const m = manifest[normRef(src)];
    if (!m || !Array.isArray(m.webp) || !Array.isArray(m.jpg) || !m.webp.length || !m.jpg.length || !m.width || !m.height) {
      fail(`no manifest entry for ${src} (${where}); run "npm run image" to update src/img/manifest.json`);
    }
    return m;
  }
  /** The JPEG variant for og:image and JSON-LD: 1200 px, or the largest when the original is narrower. */
  function shareVariant(src, where) {
    const m = entry(src, where);
    const v = m.jpg.find((x) => x.w === 1200) || m.jpg[m.jpg.length - 1];
    return { url: `${SITE}${v.src}`, width: v.w, height: v.h };
  }
  /** View model of the picture partial (every key set, so Mustache never falls back to an outer context). */
  function picture(src, opts) {
    const where = opts.where || src;
    const m = entry(src, where);
    if (!opts.alt || !String(opts.alt).trim()) fail(`empty alt text for ${src} (${where})`);
    const fallback = m.jpg.find((x) => x.w === 1200) || m.jpg[m.jpg.length - 1];
    return {
      class: opts.cls || '',
      hidden: Boolean(opts.hidden),
      aria_hidden: Boolean(opts.ariaHidden),
      data_index: opts.index === undefined ? '' : String(opts.index),
      webp_srcset: m.webp.map((v) => `${v.src} ${v.w}w`).join(', '),
      jpg_srcset: m.jpg.map((v) => `${v.src} ${v.w}w`).join(', '),
      sizes: opts.sizes,
      src: fallback.src,
      width: m.width,
      height: m.height,
      alt: opts.alt,
      lazy: opts.lazy !== false,
      high: Boolean(opts.high),
      low: Boolean(opts.low),
    };
  }
  const renderPicture = (vm) => Mustache.render(templates.partials.picture, vm, partialLookup(templates), { escape: escapeHtml });
  /** `sizes` of an image in one of COVER_BOXES, from its manifest size. */
  const coverSizesOf = (box, src, where) => {
    const m = entry(src, where);
    return coverSizes(box, m.width, m.height);
  };

  const hubUrl = (hub) => `/${hub.path}/`;
  const artworkUrl = (hub, a) => `/${hub.path}/${a.slug}/`;
  const sizeText = (a) => `${a.width_cm} × ${a.height_cm} cm`;
  const mailto = (subject) => `mailto:${site.email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;

  /**
   * Alt text for a card image: data.json preview_alt / preview_hover_alt when set (a crop can show something else
   * than the photo it was cut from, e.g. the painting without the frame), else the artwork image with the same
   * file, or the one whose file the preview was cut from, else the main image's alt.
   */
  function cardAlt(a, src, override) {
    if (typeof override === 'string' && override.trim()) return override;
    const stem = (p) => p.replace(/\.[^./]+$/, '').replace(/_preview$/i, '').toLowerCase();
    const exact = a.images.find((im) => im.src === src);
    if (exact) return exact.alt;
    const crop = a.images.find((im) => stem(im.src) === stem(src));
    return crop ? crop.alt : a.images[0].alt;
  }

  /**
   * Card view. The link is named by the title (and the badge) through aria-labelledby: without it, screen readers
   * read the image alt, the title and MORE, so every title twice.
   */
  function card(hub, a, { h2 = false } = {}) {
    const wide = a.card === 'wide';
    const box = wide ? 'cardWide' : 'card';
    const badge = STATUS[a.status].badge;
    const titleId = `card-${a.slug}`;
    const badgeId = `card-${a.slug}-badge`;
    return {
      href: artworkUrl(hub, a),
      wide,
      title: keepTogether(a.title),
      title_id: titleId,
      badge_id: badgeId,
      labelledby: badge ? `${titleId} ${badgeId}` : titleId,
      h2,
      badge,
      image: picture(a.preview, { alt: cardAlt(a, a.preview, a.preview_alt), sizes: coverSizesOf(box, a.preview, `${a.slug} preview`), cls: 'card__img', where: `${a.slug} preview` }),
      hover: picture(a.preview_hover, { alt: cardAlt(a, a.preview_hover, a.preview_hover_alt), sizes: coverSizesOf(box, a.preview_hover, `${a.slug} preview_hover`), cls: 'card__img card__img--hover', ariaHidden: true, where: `${a.slug} preview_hover` }),
    };
  }

  /** `sizes` of an artwork main image: the square box width times the image's width/height ratio (max 1). */
  function artworkSizes(width, height) {
    const r = Math.min(1, width / height);
    const px = (w) => `${Math.max(1, Math.round(w * r))}px`;
    const vw = (pad) => (r >= 0.999 ? `calc(100vw - ${pad}px)` : `calc((100vw - ${pad}px) * ${Number(r.toFixed(3))})`);
    return [...ARTWORK_BOX.map(([min, w]) => `(min-width: ${min}px) ${px(w)}`), `(min-width: 481px) ${vw(100)}`, vw(40)].join(', ');
  }

  // ---------------------------------------------------------------- titles and descriptions
  const suffix = ` | ${site.name}`;
  function artworkTitle(hub, a) {
    if (a.seo_title) return a.seo_title;
    const candidates = [
      `${a.title} — ${hub.medium_label}, ${a.year}${suffix}`,
      `${a.title} — ${hub.medium_label}${suffix}`,
      `${a.title}${suffix}`,
    ];
    for (const c of candidates) if (cpLen(c) <= TITLE_MAX) return c;
    return `${cutAtWord(a.title, TITLE_MAX - cpLen(suffix))}${suffix}`;
  }
  /**
   * Meta description: the facts, then the first description paragraph. When that paragraph opens with the title
   * again ('"Cala Secreta: ..." (Inspired by P. Molina) reveals a cove'), the title becomes "It" and the credit
   * stays ('Inspired by P. Molina, it reveals a cove'), so the characters go to the description. Fitted to 155
   * characters: at a sentence end when one keeps 120.
   */
  function artworkDescription(a) {
    if (a.seo_description) return a.seo_description;
    const first = withoutTitleEcho(a.title, plainText(a.description[0]));
    const text = plainText(`${a.title}, ${a.medium.toLowerCase()} by ${site.name} (${a.year}), ${sizeText(a)}. ${first}`);
    let d = fitText(text, DESCRIPTION_MIN, DESCRIPTION_MAX);
    if (cpLen(d) < DESCRIPTION_MIN) d = fitText(`${d}${STATUS[a.status].descriptionSuffix}`, DESCRIPTION_MIN, DESCRIPTION_MAX);
    return d;
  }

  // ---------------------------------------------------------------- JSON-LD objects
  const person = () => ({
    '@type': 'Person',
    '@id': PERSON_ID,
    name: site.name,
    jobTitle: PERSON_JOB_TITLE,
    url: `${SITE}/`,
    image: shareVariant(site.images.portrait, 'Person.image').url,
    address: { '@type': 'PostalAddress', addressCountry: 'DE' },
    sameAs: site.social.map((s) => s.url),
  });
  const websiteRef = () => ({ '@type': 'WebSite', '@id': WEBSITE_ID, url: `${SITE}/`, name: site.name });
  const breadcrumbLd = (trail) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.label, item: `${SITE}${t.href}` })),
  });

  // ---------------------------------------------------------------- shared view parts
  const navItems = [
    ...data.hubs.map((h) => ({ href: hubUrl(h), label: h.label })),
    { href: '/about/', label: 'About' },
    { href: '/contact/', label: 'Contact' },
  ];
  const footerItems = [...navItems, ...legalPages.map((l) => ({ href: `/${l.key}/`, label: l.label }))];
  const privacy = legalPages.find((l) => l.key === 'privacy');
  const instagram = site.social.find((s) => s.name.toLowerCase() === 'instagram');

  function socialLinks() {
    const rank = (s) => {
      const i = SOCIAL_ORDER.indexOf(s.name.toLowerCase());
      return i === -1 ? SOCIAL_ORDER.length : i;
    };
    return site.social
      .map((s, i) => ({ s, i }))
      .sort((x, y) => rank(x.s) - rank(y.s) || x.i - y.i)
      .map(({ s }) => {
        const key = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const icon = templates.partials[`icon-${key}`];
        if (!icon) fail(`no icon partial src/templates/partials/icon-${key}.mustache for the social link "${s.name}"`);
        return { key, name: s.name, label: `${site.name} on ${s.name}`, url: s.url, icon: icon.trim() };
      });
  }

  function intro({ lazy, moreLink }) {
    return {
      avatar: picture(site.images.avatar, { alt: SITE_IMAGE_ALT.avatar, sizes: SIZES.avatar, cls: 'intro__avatar', lazy, where: 'site.images.avatar' }),
      more_link: Boolean(moreLink),
    };
  }
  function aboutMe({ heading }) {
    return {
      heading: Boolean(heading),
      photo: picture(site.images.photo, { alt: SITE_IMAGE_ALT.photo, sizes: SIZES.photo, cls: 'about-me__photo', where: 'site.images.photo' }),
    };
  }
  function contact({ heading, lazy }) {
    return {
      heading: Boolean(heading),
      portrait: picture(site.images.portrait, { alt: SITE_IMAGE_ALT.portrait, sizes: SIZES.portrait, cls: 'contact__portrait', lazy, where: 'site.images.portrait' }),
      social: socialLinks(),
    };
  }

  /** The view every page template gets (head, nav, footer, consent). */
  function layout({ type, href, title, description, og, noindex = false, jsonld = [], breadcrumb = null }) {
    const scripts = [...SCRIPTS_ALL, ...(SCRIPTS_BY_TYPE[type] || [])].map((name) => ({
      src: assets.scripts[name],
      ga_id: name === 'consent.js' ? site.ga_measurement_id : '',
    }));
    const current = (h) => !noindex && h === href;
    return {
      page: {
        type,
        href,
        title,
        description: description || '',
        noindex,
        // indexable pages allow large image previews in Search and Discover (an image-first site)
        robots: noindex ? 'noindex' : 'max-image-preview:large',
        noscript_css: NOSCRIPT_BASE_CSS,
        canonical: noindex ? '' : `${SITE}${href}`,
        og: og ? {
          title,
          description,
          url: `${SITE}${href}`,
          image: og.url,
          image_width: og.width,
          image_height: og.height,
          image_alt: og.alt,
        } : false,
      },
      site: {
        name: site.name,
        email: site.email,
        mailto: mailto(''),
        youtube_id: site.youtube_id,
      },
      assets: { css: assets.css, fonts: assets.fonts, scripts },
      jsonld: jsonld.map((obj) => ({ json: serializeJsonLd(obj) })),
      nav: {
        state_class: type === 'home' ? 'site-nav--hidden' : 'site-nav--visible',
        // "Oil paintings": phones show the first word only (site.css .site-nav__more; screen readers get the full name)
        items: navItems.map((n) => {
          const [first, ...more] = n.label.split(' ');
          return { ...n, first, more: more.length ? ` ${more.join(' ')}` : '', current: current(n.href) };
        }),
      },
      footer: {
        year,
        owner: site.name.toUpperCase(),
        items: footerItems.map((n) => ({ ...n, current: current(n.href) })),
      },
      consent: { text: CONSENT_TEXT, privacy_href: privacy ? `/${privacy.key}/` : '' },
      breadcrumb: breadcrumb ? breadcrumb.map((b, i) => ({ label: keepTogether(b.label), href: i === breadcrumb.length - 1 ? '' : b.href, first: i === 0 })) : [],
    };
  }

  const ogFor = (src, alt, where) => ({ ...shareVariant(src, where), alt });
  /** Alt text of an image path used by an artwork (for og:image:alt of the default share image). */
  const imageAlt = (src, fallback) => {
    for (const hub of data.hubs) for (const a of hub.artworks) for (const im of a.images) if (im.src === src) return im.alt;
    return fallback;
  };
  const pages = [];
  const add = (p) => { pages.push(p); };

  // ---------------------------------------------------------------- home
  {
    const view = layout({
      type: 'home',
      href: '/',
      title: site.seo_title,
      description: site.seo_description,
      og: ogFor(site.images.og_default, imageAlt(site.images.og_default, `Painting by ${site.name}`), 'site.images.og_default'),
      jsonld: [
        { '@context': 'https://schema.org', '@type': 'WebSite', '@id': WEBSITE_ID, url: `${SITE}/`, name: site.name, inLanguage: 'en', publisher: { '@id': PERSON_ID } },
        { '@context': 'https://schema.org', ...person() },
      ],
    });
    view.page.noscript_css += NOSCRIPT_HOME_CSS;
    view.hero = {
      poster: picture(site.images.hero_poster, { alt: SITE_IMAGE_ALT.hero_poster, sizes: SIZES.hero, cls: 'hero__poster', lazy: false, high: true, where: 'site.images.hero_poster' }),
      cta_href: `#gallery-${data.hubs[0].key}`,
    };
    view.intro = intro({ lazy: true, moreLink: true });
    view.galleries = data.hubs.map((hub) => ({
      key: hub.key,
      heading: hub.section_heading,
      href: hubUrl(hub),
      all_link: hub.all_link,
      cards: hub.artworks.map((a) => card(hub, a)),
    }));
    view.about_me = aboutMe({ heading: true });
    const tiles = data.socialmedia_images.slice(0, MOSAIC_TILES);
    view.instagram = {
      url: instagram.url,
      tiles: tiles.map((im, i) => ({
        big: i === 0,
        image: picture(im.src, { alt: im.alt, sizes: coverSizesOf(i === 0 ? 'mosaicBig' : 'mosaicSmall', im.src, `socialmedia_images[${i}]`), cls: 'instagram__img', where: `socialmedia_images[${i}]` }),
      })),
    };
    view.contact = contact({ heading: true, lazy: true });
    add({ type: 'home', file: 'index.html', href: '/', template: 'home', view, indexable: true });
  }

  // ---------------------------------------------------------------- hubs and artworks
  for (const hub of data.hubs) {
    const url = `${SITE}${hubUrl(hub)}`;
    const trail = [{ label: 'Home', href: '/' }, { label: hub.label, href: hubUrl(hub) }];
    const view = layout({
      type: 'hub',
      href: hubUrl(hub),
      title: hub.seo_title,
      description: hub.seo_description,
      og: ogFor(hub.artworks[0].images[0].src, hub.artworks[0].images[0].alt, `${hub.key} og:image`),
      breadcrumb: trail,
      jsonld: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          '@id': `${url}#collection`,
          name: hub.h1,
          url,
          description: hub.seo_description,
          inLanguage: 'en',
          isPartOf: websiteRef(),
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: hub.artworks.length,
            itemListElement: hub.artworks.map((a, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              url: `${SITE}${artworkUrl(hub, a)}`,
              name: a.title,
              image: shareVariant(a.images[0].src, `${a.slug} images[0]`).url,
            })),
          },
        },
        breadcrumbLd(trail),
      ],
    });
    view.hub = {
      key: hub.key,
      h1: hub.h1,
      intro: hub.intro.map((t) => keepTogether(plainText(t))),
      cards: hub.artworks.map((a) => card(hub, a, { h2: true })),
    };
    add({ type: 'hub', file: `${hub.path}/index.html`, href: hubUrl(hub), template: 'hub', view, indexable: true });

    hub.artworks.forEach((a, i) => {
      const href = artworkUrl(hub, a);
      const pageUrl = `${SITE}${href}`;
      const st = STATUS[a.status];
      const atrail = [...trail, { label: a.title, href }];
      const multiple = a.images.length > 1;
      const slides = a.images.map((im, n) => {
        const m = entry(im.src, `${a.slug} images[${n}]`);
        return picture(im.src, {
          alt: im.alt,
          sizes: artworkSizes(m.width, m.height),
          cls: 'artwork__image',
          index: n,
          hidden: n > 0,
          lazy: n > 0,
          high: n === 0,
          where: `${a.slug} images[${n}]`,
        });
      });
      const thumbs = multiple ? a.images.map((im, n) => ({
        index: String(n),
        number: n + 1,
        count: a.images.length,
        current: n === 0 ? 'true' : 'false',
        // small, low-priority files: the 160/320 px variants (scripts/images.js ROLE_WIDTHS.thumb), not the main image's
        image: picture(im.src, { alt: im.alt, sizes: coverSizesOf('thumb', im.src, `${a.slug} thumbnail ${n + 1}`), cls: 'artwork__thumb-img', low: true, where: `${a.slug} thumbnail ${n + 1}` }),
      })) : [];
      // every value is visible running text: a size in any of them ("Framed (wood and glass), 50 × 40 cm") keeps together
      const facts = [
        { key: 'medium', label: 'Medium', value: a.medium },
        { key: 'size', label: 'Size', value: sizeText(a) },
        ...(a.frame ? [{ key: 'frame', label: 'Frame', value: a.frame }] : []),
        { key: 'year', label: 'Year', value: String(a.year) },
      ].map((f) => ({ ...f, value: keepTogether(f.value) }));
      let story = false;
      if (a.story_confirmed === true && typeof a.story_html === 'string' && a.story_html.trim()) {
        story = { html: storyHtml(a) };
      }
      const prev = i > 0 ? hub.artworks[i - 1] : null;
      const next = i < hub.artworks.length - 1 ? hub.artworks[i + 1] : null;
      const view2 = layout({
        type: 'artwork',
        href,
        title: artworkTitle(hub, a),
        description: artworkDescription(a),
        og: ogFor(a.images[0].src, a.images[0].alt, `${a.slug} images[0]`),
        breadcrumb: atrail,
        jsonld: [
          {
            '@context': 'https://schema.org',
            '@type': 'VisualArtwork',
            '@id': `${pageUrl}#artwork`,
            name: a.title,
            url: pageUrl,
            image: a.images.map((im, n) => shareVariant(im.src, `${a.slug} images[${n}]`).url),
            description: a.description.map(plainText).join(' '),
            creator: { '@id': PERSON_ID, '@type': 'Person', name: site.name },
            dateCreated: String(a.year),
            artMedium: a.medium,
            artform: hub.artform,
            artworkSurface: a.surface,
            width: { '@type': 'QuantitativeValue', value: a.width_cm, unitCode: 'CMT', unitText: 'cm' },
            height: { '@type': 'QuantitativeValue', value: a.height_cm, unitCode: 'CMT', unitText: 'cm' },
          },
          breadcrumbLd(atrail),
        ],
      });
      if (multiple) view2.page.noscript_css += NOSCRIPT_GALLERY_CSS;
      view2.hub = { key: hub.key, path: hub.path, label: hub.label, all_link: hub.all_link, pager_label: `More ${hub.label.toLowerCase()}` };
      view2.artwork = {
        slug: a.slug,
        title: keepTogether(a.title), // h1 and the dialog label ("St. Albani ...")
        status: a.status,
        status_text: st.text,
        description: a.description.map((t) => keepTogether(plainText(t))),
        facts,
        multiple,
        slides,
        thumbs,
        cta_href: mailto(`${st.ctaSubject}${a.title}`),
        cta_label: st.ctaLabel,
        story,
        prev: prev ? { href: artworkUrl(hub, prev), title: keepTogether(prev.title) } : false,
        next: next ? { href: artworkUrl(hub, next), title: keepTogether(next.title) } : false,
      };
      add({ type: 'artwork', file: `${hub.path}/${a.slug}/index.html`, href, template: 'artwork', view: view2, indexable: true, artwork: a });
    });
  }

  /** Story HTML (only rendered when story_confirmed): headings one level down (below the "Story" h2), <img> -> manifest <picture>. */
  function storyHtml(a) {
    let html = a.story_html.replace(/<(\/?)h([1-5])(?=[\s>])/gi, (m, slash, level) => `<${slash}h${Number(level) + 1}`);
    html = html.replace(/<img\b[^>]*>/gi, (tag) => {
      const attr = (name) => {
        const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
        return m ? plainText(m[2] !== undefined ? m[2] : m[3]) : '';
      };
      const src = attr('src');
      if (!src) fail(`${a.slug}: <img> without src in story_html`);
      return renderPicture(picture(src, { alt: attr('alt'), sizes: SIZES.story, cls: 'artwork__story-image', where: `${a.slug} story_html` })).trim();
    });
    return html;
  }

  // ---------------------------------------------------------------- about, contact, legal, 404
  {
    const trail = [{ label: 'Home', href: '/' }, { label: 'About', href: '/about/' }];
    const view = layout({
      type: 'about',
      href: '/about/',
      title: data.pages.about.seo_title,
      description: data.pages.about.seo_description,
      og: ogFor(site.images.photo, SITE_IMAGE_ALT.photo, 'site.images.photo'),
      breadcrumb: trail,
      jsonld: [
        {
          '@context': 'https://schema.org',
          '@type': 'AboutPage',
          url: `${SITE}/about/`,
          name: 'About Polina Shvedko',
          description: data.pages.about.seo_description,
          inLanguage: 'en',
          isPartOf: websiteRef(),
          mainEntity: person(),
        },
        breadcrumbLd(trail),
      ],
    });
    view.intro = intro({ lazy: false, moreLink: false });
    view.about_me = aboutMe({ heading: false });
    add({ type: 'about', file: 'about/index.html', href: '/about/', template: 'about', view, indexable: true });
  }
  {
    const trail = [{ label: 'Home', href: '/' }, { label: 'Contact', href: '/contact/' }];
    const view = layout({
      type: 'contact',
      href: '/contact/',
      title: data.pages.contact.seo_title,
      description: data.pages.contact.seo_description,
      og: ogFor(site.images.portrait, SITE_IMAGE_ALT.portrait, 'site.images.portrait'),
      breadcrumb: trail,
      jsonld: [
        {
          '@context': 'https://schema.org',
          '@type': 'ContactPage',
          url: `${SITE}/contact/`,
          name: 'Contact',
          description: data.pages.contact.seo_description,
          inLanguage: 'en',
          isPartOf: websiteRef(),
          mainEntity: { '@id': PERSON_ID },
        },
        breadcrumbLd(trail),
      ],
    });
    view.contact = contact({ heading: false, lazy: false });
    add({ type: 'contact', file: 'contact/index.html', href: '/contact/', template: 'contact', view, indexable: true });
  }
  for (const l of legalPages) {
    const meta = (data.pages && data.pages[l.key]) || {};
    const href = `/${l.key}/`;
    const trail = [{ label: 'Home', href: '/' }, { label: l.label, href }];
    const view = layout({
      type: l.key,
      href,
      title: meta.seo_title || l.title,
      description: meta.seo_description || l.description,
      og: ogFor(site.images.og_default, imageAlt(site.images.og_default, `Painting by ${site.name}`), 'site.images.og_default'),
      breadcrumb: trail,
      jsonld: [
        { '@context': 'https://schema.org', '@type': 'WebPage', url: `${SITE}${href}`, name: l.label, inLanguage: 'en', isPartOf: websiteRef() },
        breadcrumbLd(trail),
      ],
    });
    view.legal = { title: l.label, html: data.legal[l.field] };
    add({ type: l.key, file: `${l.key}/index.html`, href, template: 'legal', view, indexable: true });
  }
  {
    const view = layout({ type: '404', href: '/404.html', title: `Page not found${suffix}`, noindex: true });
    view.links = [{ href: '/', label: 'Home' }, ...navItems];
    add({ type: '404', file: '404.html', href: '/404.html', template: '404', view, indexable: false });
  }

  return { pages, legalPages };
}

/** Check the meta texts of every page: titles <= 60 and unique, descriptions 120-155 on indexable pages. */
function validateMeta(pages) {
  const problems = [];
  const titles = new Map();
  for (const p of pages) {
    const t = p.view.page.title;
    const d = p.view.page.description;
    if (!t || !t.trim()) problems.push(`${p.file}: empty <title>`);
    else if (cpLen(t) > TITLE_MAX) problems.push(`${p.file}: <title> has ${cpLen(t)} characters (max ${TITLE_MAX}): "${t}"`);
    if (titles.has(t)) problems.push(`${p.file}: <title> "${t}" is also used by ${titles.get(t)}`);
    else titles.set(t, p.file);
    if (p.indexable) {
      const n = cpLen(d);
      if (n < DESCRIPTION_MIN || n > DESCRIPTION_MAX) problems.push(`${p.file}: meta description has ${n} characters (${DESCRIPTION_MIN}-${DESCRIPTION_MAX}): "${d}"`);
      if (/[<>]/.test(d)) problems.push(`${p.file}: meta description contains HTML`);
    }
  }
  if (problems.length) fail(`meta text problems:\n  ${problems.join('\n  ')}`);
}

function sitemapXml(pages, data) {
  const xmlEscape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const urls = pages.filter((p) => p.indexable).map((p) => {
    const lastmod = (p.artwork && p.artwork.updated) || data.site.lastmod;
    return `  <url>\n    <loc>${xmlEscape(`${data.site.url}${p.href}`)}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** Write a file only when its content changes (keeps mtimes stable for watchers). Returns true when written. */
function writeIfChanged(file, content) {
  const buffer = Buffer.from(content, 'utf8');
  try {
    if (fs.readFileSync(file).equals(buffer)) return false;
  } catch {
    /* new file */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return true;
}

/**
 * Build every page and sitemap.xml.
 * @param {{ root?: string, outDir?: string, log?: (line: string) => void }} [options]
 *   root: repository root (default: the folder above scripts/); outDir: output directory
 *   (default: $APP_DIR or app, relative to root).
 * @returns {Promise<{ outDir: string, pages: number, written: number, files: string[] }>}
 */
async function build({ root = DEFAULT_ROOT, outDir, log = () => {} } = {}) {
  const rootDir = path.resolve(root);
  const out = path.resolve(rootDir, outDir || process.env.APP_DIR || 'app');
  const data = readJson(path.join(rootDir, 'data.json'), 'data.json');
  const manifest = readJson(path.join(rootDir, 'src', 'img', 'manifest.json'), 'src/img/manifest.json');
  validateData(data);
  const templates = loadTemplates(rootDir);
  for (const name of ['home', 'hub', 'artwork', 'about', 'contact', '404', 'legal']) {
    if (!templates.pages[name]) fail(`missing template src/templates/pages/${name}.mustache`);
  }
  for (const name of ['picture']) {
    if (!templates.partials[name]) fail(`missing partial src/templates/partials/${name}.mustache`);
  }
  checkPartialRefs(templates);
  const assets = loadAssets(rootDir);
  const { pages } = createContext(rootDir, data, manifest, assets, templates);
  validateMeta(pages);

  const rendered = [];
  for (const p of pages) {
    for (const block of p.view.jsonld) validateJsonLd(JSON.parse(block.json), p.file, data.site.url);
    let html;
    try {
      html = Mustache.render(templates.pages[p.template], p.view, partialLookup(templates), { escape: escapeHtml });
    } catch (e) {
      fail(`rendering ${p.file} with pages/${p.template}.mustache failed: ${e.message}`);
    }
    rendered.push({ file: p.file, content: html });
  }
  rendered.push({ file: 'sitemap.xml', content: sitemapXml(pages, data) });

  let written = 0;
  for (const r of rendered) if (writeIfChanged(path.join(out, ...r.file.split('/')), r.content)) written++;
  matchOwner(rootDir, [out]); // run as root (dev container): the output keeps the owner of the repository
  log(`build-site: ${pages.length} pages + sitemap.xml (${pages.filter((p) => p.indexable).length} URLs) -> ${out} (${written} file(s) changed)`);
  return { outDir: out, pages: pages.length, written, files: rendered.map((r) => r.file) };
}

module.exports = {
  build, cutAtWord, fitText, keepTogether, withoutTitleEcho, coverSizes, escapeHtml, plainText, serializeJsonLd, validateJsonLd,
  SIZES, COVER_BOXES, STATUS, ARTWORK_FIELDS, BuildError,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  let outDir;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') outDir = args[++i];
    else if (args[i].startsWith('--out=')) outDir = args[i].slice(6);
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('usage: node scripts/build-site.js [--out <dir>]   (default: $APP_DIR or app)');
      process.exit(0);
    } else {
      console.error(`unknown argument: ${args[i]}`);
      process.exit(2);
    }
  }
  build({ outDir: outDir ? path.resolve(outDir) : undefined, log: console.log }).catch((e) => {
    console.error(e && e.message ? e.message : e);
    process.exitCode = 1;
  });
}
