'use strict';
// SPEC 12.12: data.json (data model of SPEC section 4) and the image manifest (SPEC section 5).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { expectNone, cpLen, findCyrillic, findForbidden, FORBIDDEN_PATTERNS, imageSize, isIsoDate } = require('../lib/checks');
const S = require('../lib/site');
const { ARTWORK_FIELDS } = require('../../scripts/build-site.js');
const IMAGES = require('../../scripts/images.js');

const data = S.loadData();
const VARIANT_WIDTHS = [600, 1200, 1920];
const COPY_AS_IS = ['img/favicon.ico', 'img/avatar_152x147.png', 'img/avatar_270x262.png'];
const HUBS = [
  { key: 'oil', path: 'oil-paintings', label: 'Oil paintings', all_link: 'All oil paintings' },
  { key: 'pastel', path: 'pastels', label: 'Pastels', all_link: 'All pastels' },
  { key: 'watercolour', path: 'watercolours', label: 'Watercolours', all_link: 'All watercolours', h1: 'Watercolour and ink paintings by Polina Shvedko' },
];

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

function manifestOrFail() {
  const manifest = S.loadManifest();
  assert.ok(manifest, `missing ${S.MANIFEST_FILE} (written by scripts/images.js, npm run image)`);
  return manifest;
}

describe('12. data.json and image manifest', () => {
  test('data.json has the SPEC section 4 top level: site, pages, hubs, socialmedia_images, legal', () => {
    const problems = [];
    for (const k of ['site', 'pages', 'hubs', 'socialmedia_images', 'legal']) if (!(k in data)) problems.push(`missing top-level key "${k}"`);
    const site = data.site || {};
    for (const k of ['url', 'name', 'lastmod', 'email', 'ga_measurement_id', 'youtube_id', 'seo_title', 'seo_description']) if (!isStr(site[k])) problems.push(`site.${k} missing`);
    if (site.url && site.url !== S.DEFAULT_SITE_URL) problems.push(`site.url is ${site.url}, expected ${S.DEFAULT_SITE_URL}`);
    if (site.lastmod && !isIsoDate(site.lastmod)) problems.push(`site.lastmod "${site.lastmod}" is not YYYY-MM-DD`);
    if (site.ga_measurement_id && !/^G-[A-Z0-9]+$/.test(site.ga_measurement_id)) problems.push(`site.ga_measurement_id "${site.ga_measurement_id}"`);
    const social = (site.social || []).map((s) => s.name);
    for (const n of ['Instagram', 'Facebook', 'LinkedIn', 'Etsy']) if (!social.includes(n)) problems.push(`site.social lacks ${n}`);
    for (const k of ['hero_poster', 'avatar', 'photo', 'portrait', 'og_default']) if (!isStr((site.images || {})[k])) problems.push(`site.images.${k} missing`);
    for (const k of ['about', 'contact']) if (!data.pages || !data.pages[k]) problems.push(`pages.${k} missing`);
    const legal = data.legal || {};
    for (const k of ['imprint_html', 'privacy_html']) if (!(k in legal) || (legal[k] !== null && typeof legal[k] !== 'string')) problems.push(`legal.${k} must be null or an HTML string`);
    expectNone(problems, 'data.json top-level problems');
  });

  test('hubs: oil-paintings, pastels, watercolours with labels, h1, all_link, medium_label, artform and a 100-200 word intro', () => {
    const problems = [];
    const hubs = data.hubs || [];
    if (hubs.length !== HUBS.length) problems.push(`${hubs.length} hubs, expected ${HUBS.length}`);
    HUBS.forEach((want, i) => {
      const hub = hubs[i];
      if (!hub) return;
      for (const k of ['key', 'path', 'label', 'all_link', 'h1']) if (want[k] && hub[k] !== want[k]) problems.push(`hubs[${i}].${k} is ${JSON.stringify(hub[k])}, expected ${JSON.stringify(want[k])}`);
      for (const k of ['section_heading', 'h1', 'medium_label', 'artform', 'seo_title', 'seo_description', 'intro_status']) if (!isStr(hub[k])) problems.push(`hubs[${i}].${k} missing`);
      if (!Array.isArray(hub.intro) || !hub.intro.length || !hub.intro.every(isStr)) problems.push(`hubs[${i}].intro must be a list of paragraphs`);
      else {
        const n = words(hub.intro.join(' '));
        if (n < 100 || n > 200) problems.push(`hubs[${i}].intro has ${n} words (100-200)`);
      }
      if (!Array.isArray(hub.artworks) || !hub.artworks.length) problems.push(`hubs[${i}].artworks is empty`);
    });
    expectNone(problems, 'hub problems');
  });

  test('meta texts in data.json: seo_title at most 60 characters, seo_description 120-155 characters', () => {
    const problems = [];
    const check = (where, obj) => {
      if (!obj) return;
      if (obj.seo_title != null && cpLen(obj.seo_title) > 60) problems.push(`${where}.seo_title has ${cpLen(obj.seo_title)} characters: "${obj.seo_title}"`);
      if (obj.seo_description != null) {
        const n = cpLen(obj.seo_description);
        if (n < 120 || n > 155) problems.push(`${where}.seo_description has ${n} characters: "${obj.seo_description}"`);
      }
    };
    check('site', data.site);
    for (const k of Object.keys(data.pages || {})) check(`pages.${k}`, data.pages[k]);
    (data.hubs || []).forEach((h, i) => check(`hubs[${i}]`, h));
    for (const { artwork } of S.allArtworks(data)) check(artwork.slug, artwork);
    expectNone(problems, 'meta text length problems');
  });

  test('slugs are unique site-wide and match ^[a-z0-9]+(-[a-z0-9]+)*$ (Cap d\'Antibes -> affectionate-farewell-cap-dantibes)', () => {
    const problems = [];
    const seen = new Map();
    for (const { hub, artwork } of S.allArtworks(data)) {
      if (!S.SLUG_RE.test(artwork.slug || '')) problems.push(`${hub.path}: slug ${JSON.stringify(artwork.slug)} (${artwork.title}) does not match the pattern`);
      if (seen.has(artwork.slug)) problems.push(`slug ${artwork.slug} is used twice (${seen.get(artwork.slug)} and ${hub.path})`);
      seen.set(artwork.slug, hub.path);
      if ((data.hubs || []).some((h) => h.path === artwork.slug)) problems.push(`slug ${artwork.slug} equals a hub path`);
    }
    const oil = (data.hubs || []).find((h) => h.key === 'oil');
    const cap = oil && oil.artworks.find((a) => a.title === "Affectionate Farewell, Cap d'Antibes, France");
    if (!cap || cap.slug !== 'affectionate-farewell-cap-dantibes') problems.push('"Affectionate Farewell, Cap d\'Antibes, France" must have the slug affectionate-farewell-cap-dantibes');
    expectNone(problems, 'slug problems');
  });

  test('every artwork has the SPEC section 4 fields with valid values (numeric sizes, allowed status and card)', () => {
    const problems = [];
    for (const { hub, artwork: a } of S.allArtworks(data)) {
      const p = (msg) => problems.push(`${hub.path}/${a.slug || '?'}: ${msg}`);
      for (const k of ['slug', 'title', 'medium', 'surface', 'preview', 'preview_hover']) if (!isStr(a[k])) p(`${k} missing`);
      if (!Number.isInteger(a.year) || a.year < 1900 || a.year > 2100) p(`year ${JSON.stringify(a.year)} is not a plausible integer year`);
      for (const k of ['width_cm', 'height_cm']) if (typeof a[k] !== 'number' || !Number.isFinite(a[k]) || a[k] <= 0) p(`${k} ${JSON.stringify(a[k])} is not a positive number`);
      if (a.frame !== null && !isStr(a.frame)) p(`frame must be a string or null, is ${JSON.stringify(a.frame)}`);
      if (!Array.isArray(a.description) || !a.description.length || !a.description.every(isStr)) p('description must be a non-empty list of text paragraphs');
      else if (a.description.some((d) => /<[a-z/!]/i.test(d))) p('description paragraphs must be plain text (no HTML)');
      if (!S.ALLOWED_STATUS.includes(a.status)) p(`status ${JSON.stringify(a.status)} not in ${S.ALLOWED_STATUS.join(' | ')}`);
      if (!S.ALLOWED_CARD.includes(a.card)) p(`card ${JSON.stringify(a.card)} not in ${S.ALLOWED_CARD.join(' | ')}`);
      if (!Array.isArray(a.images) || !a.images.length) p('images is empty');
      else a.images.forEach((im, i) => { if (!im || !isStr(im.src) || !isStr(im.alt)) p(`images[${i}] needs src and a non-empty alt`); });
      if (a.story_html !== null && typeof a.story_html !== 'string') p('story_html must be null or a string');
      if (typeof a.story_confirmed !== 'boolean') p('story_confirmed must be true or false');
      for (const k of ['seo_title', 'seo_description', 'preview_alt', 'preview_hover_alt']) if (a[k] !== null && a[k] !== undefined && !isStr(a[k])) p(`${k} must be a string or null`);
      // only fields the build reads (a documented field without effect, or a typo, would sit there unnoticed)
      const unknown = Object.keys(a).filter((k) => !ARTWORK_FIELDS.has(k));
      if (unknown.length) p(`unknown field(s) ${unknown.join(', ')}; scripts/build-site.js ARTWORK_FIELDS lists the data model`);
      if (a.updated !== undefined && !isIsoDate(a.updated)) p(`updated "${a.updated}" is not YYYY-MM-DD`);
    }
    (data.socialmedia_images || []).forEach((im, i) => { if (!im || !isStr(im.src) || !isStr(im.alt)) problems.push(`socialmedia_images[${i}] needs src and a non-empty alt`); });
    expectNone(problems, 'artwork data problems');
  });

  test('no removed field is left anywhere in data.json (lid, price, sold, col_class, preview1, detail_images, dimensions, blog_posts, ...)', () => {
    const problems = [];
    const visit = (v, where) => {
      if (Array.isArray(v)) { v.forEach((x, i) => visit(x, `${where}[${i}]`)); return; }
      if (!v || typeof v !== 'object') return;
      for (const [k, val] of Object.entries(v)) {
        if (S.REMOVED_FIELDS.includes(k)) problems.push(`${where}.${k}`);
        visit(val, `${where}.${k}`);
      }
    };
    visit(data, 'data');
    expectNone(problems, 'removed fields still present');
  });

  test('data.json has no Cyrillic characters and no shop/sales words (URLs ignored)', () => {
    const raw = fs.readFileSync(S.DATA_FILE, 'utf8');
    const problems = findCyrillic(raw).map((h) => `line ${h.line}: Cyrillic ${h.char} ${h.code} in: ${h.excerpt}`);
    const sales = FORBIDDEN_PATTERNS.filter((p) => !/retired/.test(p.label));
    for (const h of findForbidden(raw, { patterns: sales })) problems.push(`line ${h.line}: [${h.label}] "${h.match}" in: ${h.excerpt}`);
    expectNone(problems, 'forbidden text in data.json');
  });

  test('every image referenced by data.json exists in src/img/ (the source of truth)', () => {
    const problems = [];
    for (const { src, where } of S.dataImageRefs(data)) {
      if (!fs.existsSync(path.join(S.ROOT, 'src', ...src.split('/')))) problems.push(`${where}: src/${src} does not exist`);
    }
    expectNone(problems, 'images missing in src/img');
  });

  test('no source image that data.json references is ignored by git (a new photo must reach the repository with a plain git add)', (t) => {
    const files = [...new Set(S.dataImageRefs(data).map((r) => `src/${r.src}`))];
    const res = spawnSync('git', ['check-ignore', '--no-index', '--verbose', '--stdin'], { cwd: S.ROOT, input: files.join('\n'), encoding: 'utf8' });
    if (res.error || (res.status !== 0 && res.status !== 1)) {
      t.skip(`git check-ignore is not available here (${res.error ? res.error.code : (res.stderr || '').trim()})`);
      return;
    }
    expectNone(res.stdout.split('\n').filter(Boolean), 'referenced source images matched by an ignore rule (rule, then file)');
  });

  test('files that tools generate in the checkout are ignored by git (a plain "git add -A" cannot commit them)', (t) => {
    // Python bytecode of scripts/seo-report.py (written when /seo-report imports it), installed packages, and
    // screenshots that browser tools drop into the repository root.
    const generated = ['scripts/__pycache__/seo-report.cpython-314.pyc', 'scripts/seo-report.pyc', 'node_modules/gulp/package.json', 'screenshot.jpeg'];
    const res = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: S.ROOT, input: generated.join('\n'), encoding: 'utf8' });
    if (res.error || (res.status !== 0 && res.status !== 1)) {
      t.skip(`git check-ignore is not available here (${res.error ? res.error.code : (res.stderr || '').trim()})`);
      return;
    }
    const ignored = new Set(res.stdout.split('\n').filter(Boolean));
    expectNone(generated.filter((f) => !ignored.has(f)), 'generated files that .gitignore does not ignore');
  });

  test('every image path in data.json has a manifest entry whose WebP and JPEG variant files exist in app/', () => {
    const manifest = manifestOrFail();
    const problems = [];
    for (const { src, where } of S.dataImageRefs(data)) {
      const entry = manifest[src];
      if (!entry) { problems.push(`${where}: no manifest entry for "${src}"`); continue; }
      for (const kind of ['webp', 'jpg']) {
        const list = entry[kind] || [];
        if (!list.length) problems.push(`${src}: no ${kind} variants`);
        for (const v of list) {
          const r = S.resolveLocal(v.src, '/', data);
          if (!r.file || !S.appExists(r.file)) problems.push(`${src}: ${kind} variant ${v.src} does not exist in app/`);
        }
      }
    }
    expectNone(problems, 'manifest/variant problems');
  });

  test('every image has a variant at most 1.6x wider than the next smaller one from 600 px up (a phone at DPR 1.75-2 that draws an image 650 px wide must not get the 1200 px file)', () => {
    const manifest = manifestOrFail();
    const problems = [];
    for (const [src, entry] of Object.entries(manifest)) {
      const widths = [...new Set((entry.webp || []).map((v) => v.w))].sort((a, b) => a - b).filter((w) => w >= 600);
      for (let i = 1; i < widths.length; i++) {
        if (widths[i] / widths[i - 1] > 1.6 + 1e-9) problems.push(`${src}: ${widths[i - 1]} -> ${widths[i]} px (${(widths[i] / widths[i - 1]).toFixed(2)}x)`);
      }
    }
    expectNone(problems, 'gaps in the variant widths');
  });

  test('manifest entries follow SPEC section 5: sorted keys, sizes, widths 600/1200/1920 (never upscaled) plus the 900 px step and the role widths, bytes and pixel widths match the files', () => {
    const manifest = manifestOrFail();
    const problems = [];
    const keys = Object.keys(manifest);
    const sorted = [...keys].sort();
    if (keys.join('\n') !== sorted.join('\n')) problems.push('manifest keys are not sorted');
    const roles = IMAGES.imageRoles(data);
    for (const [src, entry] of Object.entries(manifest)) {
      const p = (msg) => problems.push(`${src}: ${msg}`);
      if (!Number.isInteger(entry.width) || !Number.isInteger(entry.height) || entry.width <= 0 || entry.height <= 0) { p(`width/height ${entry.width}x${entry.height}`); continue; }
      // SPEC 600/1200/1920 clamped to the original width, plus 900 (scripts/images.js SETTINGS.widths) and the
      // widths of the image's roles: 160/320 for gallery thumbnails, 2560/3200 for wide card images (ROLE_WIDTHS)
      const base = [...new Set(VARIANT_WIDTHS.map((w) => Math.min(w, entry.width)))];
      const expected = IMAGES.variantWidths(entry.width, roles.get(src) || []);
      const dir = path.posix.dirname(`/${src}`);
      for (const kind of ['webp', 'jpg']) {
        const list = entry[kind] || [];
        const widths = list.map((v) => v.w);
        if (widths.join(',') !== expected.join(',')) p(`${kind} widths [${widths.join(', ')}], expected [${expected.join(', ')}] for an original ${entry.width} px wide (roles: ${[...(roles.get(src) || [])].join(', ') || 'none'})`);
        if (!base.every((w) => widths.includes(w))) p(`${kind} lacks a SPEC width of [${base.join(', ')}]`);
        for (const v of list) {
          if (typeof v.src !== 'string' || !v.src.startsWith(`${dir}/`) || !v.src.endsWith(`-${v.w}.${kind}`) || v.src !== v.src.toLowerCase()) {
            p(`${kind} variant src "${v.src}" should be "${dir}/<lowercase base>-${v.w}.${kind}"`);
          }
          const r = S.resolveLocal(v.src, '/', data);
          if (!r.file || !S.appExists(r.file)) { p(`${v.src}: cannot check bytes and size, the file is missing in app/`); continue; }
          const bytes = fs.statSync(S.appFile(r.file)).size;
          if (v.bytes !== bytes) p(`${v.src}: manifest bytes ${v.bytes}, file has ${bytes}`);
          const size = imageSize(fs.readFileSync(S.appFile(r.file)));
          if (!size) p(`${v.src}: not a readable ${kind} file`);
          else {
            if (size.width !== v.w) p(`${v.src}: file is ${size.width} px wide, manifest says ${v.w}`);
            const h = Math.round((entry.height * v.w) / entry.width);
            if (Math.abs(size.height - h) > 1) p(`${v.src}: file height ${size.height}, expected about ${h} (orientation?)`);
            if (size.orientation && size.orientation !== 1) p(`${v.src}: EXIF orientation ${size.orientation} left in the file (auto-orient and strip metadata)`);
          }
        }
      }
    }
    expectNone(problems, 'manifest problems');
  });

  test('app/img/ holds only manifest variants and the copy-as-is icons (no originals)', () => {
    const manifest = manifestOrFail();
    const allowed = new Set(COPY_AS_IS);
    for (const entry of Object.values(manifest)) for (const kind of ['webp', 'jpg']) for (const v of entry[kind] || []) allowed.add(String(v.src).replace(/^\//, ''));
    const imgDir = path.join(S.APP_DIR, 'img');
    assert.ok(fs.existsSync(imgDir), `missing ${imgDir}`);
    const files = S.walkFiles(imgDir).map((f) => `img/${path.relative(imgDir, f).split(path.sep).join('/')}`);
    const extra = files.filter((f) => !allowed.has(f));
    const bytes = extra.reduce((sum, f) => sum + fs.statSync(path.join(S.APP_DIR, f)).size, 0);
    expectNone(extra, `files in app/img that are not in the manifest (${(bytes / 1048576).toFixed(1)} MB)`);
    const missingIcons = COPY_AS_IS.filter((f) => !files.includes(f));
    expectNone(missingIcons, 'copy-as-is icons missing in app/img');
  });
});
