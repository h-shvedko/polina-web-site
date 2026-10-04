#!/usr/bin/env node
'use strict';
/*
 * Image pipeline for polina-shvedko.art (ADR-0003 §7.5, implementation spec §5).
 *
 *   node scripts/images.js                 generate what is missing or out of date
 *   node scripts/images.js --force         regenerate every variant
 *   node scripts/images.js --check         verify only (no writes); exit 1 on problems
 *   node scripts/images.js --fetch-poster  download the YouTube thumbnail of site.youtube_id
 *                                          to src/<site.images.hero_poster>, then generate
 *   gulp img  /  npm run image             the gulp task calls run()
 *
 * Source of truth is src/img/. The pipeline processes exactly the images that data.json
 * references (every string that is a local "img/....(jpg|jpeg|png|webp|gif|tif|tiff|avif)"
 * path, plus <img src> inside HTML strings such as story_html; this covers images[].src,
 * preview, preview_hover, socialmedia_images[].src and site.images.*).
 *
 * For each referenced image it writes into <APP_DIR>/img/<same subdir>/:
 *   <stem>-<w>.webp and <stem>-<w>.jpg
 * <stem> is the source file name without extension, lowercased, every run of characters
 * outside [a-z0-9_-] replaced by "-". Widths are 600, 900, 1200 and 1920 (the SPEC's 600/1200/
 * 1920 plus a 900 step: phones at DPR 1.75-2.4 draw a full-width image at 650-1050 px and took
 * the 1200 px file, twice the bytes), each clamped to the original width (never upscaled),
 * duplicates removed:
 *   original >= 1920 -> 600, 900, 1200, 1920     original 1529 -> 600, 900, 1200, 1529
 *   original 921     -> 600, 900, 921            original 480  -> 480
 * plus the ROLE_WIDTHS of how data.json uses the image (imageRoles()): the photos of an
 * artwork with more than one image are also gallery thumbnails (40-60 px boxes) and get 160
 * and 320; the card images of a "wide" card are drawn up to about 1620 CSS px wide
 * (object-fit: cover; 3240 px at DPR 2) and get 2560 and 3200.
 * Every variant is auto-oriented (EXIF), converted to sRGB (embedded ICC profiles such as
 * Adobe RGB are applied), flattened on white, and stripped of all metadata. WebP quality 75
 * ("photo" preset), JPEG mozjpeg quality 75 progressive (see SETTINGS).
 *
 * It writes src/img/manifest.json (committed; CI does not run sharp), keys sorted:
 *   { "img/gallery/picture32_1.jpg": { "width": 3773, "height": 876, "digest": "0123456789abcdef",
 *       "webp": [ { "w": 600, "h": 139, "src": "/img/gallery/picture32_1-600.webp", "bytes": 1234 }, ... ],
 *       "jpg":  [ ... same widths ... ] } }
 * width/height are the original's after orientation; w/h are the variant's real pixel size.
 * digest = first 16 hex digits of SHA-256(encoder settings + source bytes); it tells this script
 * whether the variants still match the source (consumers can ignore it).
 *
 * Files in COPY_AS_IS are copied byte for byte (icons). Every other file in <APP_DIR>/img/
 * that is not a manifest variant is deleted, so originals never reach the server.
 *
 * Incremental: when the manifest digest of an image still matches (same source bytes, same
 * settings), an existing output with the recorded byte size is reused whatever its mtime, so a
 * fresh clone or a branch switch does not regenerate anything. A changed source or changed
 * settings regenerate that image even when its outputs are newer. For a manifest entry without
 * a digest (or no entry), the SPEC rule applies: an output newer than its source is reused.
 * The output is deterministic: the same sources and settings give byte-identical files and manifest.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { matchOwner } = require('./file-owner');

/*
 * Encoder settings (SPEC section 5: WebP ~75, mozjpeg ~75 progressive). Changing them changes
 * every manifest digest, so the next run regenerates every variant.
 * WebP is what every current browser shows: quality 75 with libwebp's "photo" preset (weaker
 * deblocking keeps paper grain and brush texture; about 3% larger than the default preset) and
 * sharp RGB->YUV conversion for clean colour edges. JPEG is the <picture> fallback and the file
 * that og:image, JSON-LD and image search use; quality 75 (quality 70 measured 12.6% smaller at
 * 1200 px but 0.86 dB lower mean PSNR, and the total with 75 is not large: about 64 MiB).
 */
const SETTINGS = Object.freeze({
  version: 1, // bump when the processing code changes in a way the values below do not show
  // Not part of the digest (see settingsFingerprint): a width adds or removes whole files. Consecutive widths
  // differ by at most 1.6x, so the file a browser picks is never far larger than the size it draws.
  widths: Object.freeze([600, 900, 1200, 1920]),
  webp: Object.freeze({ quality: 75, effort: 6, smartSubsample: true, preset: 'photo' }),
  jpeg: Object.freeze({ quality: 75, mozjpeg: true, progressive: true }),
  background: '#ffffff',
  fastShrinkOnLoad: false, // full-quality downscale: no moire on canvas texture
});

/*
 * Extra widths by role (imageRoles), on top of SETTINGS.widths and clamped the same way. Not part of
 * the digest either: a change here writes only the new variants.
 */
const ROLE_WIDTHS = Object.freeze({
  thumb: Object.freeze([160, 320]), // artwork page thumbnails: 40 px (phones) and 60 px boxes at DPR 1-3
  wide: Object.freeze([2560, 3200]), // card images of wide cards: 1160 px box, wider images drawn at ~1620 px
});

/* Copied byte for byte from src/ to <APP_DIR>/ (favicon and apple-touch icons). */
const COPY_AS_IS = Object.freeze([
  'img/avatar_152x147.png',
  'img/avatar_270x262.png',
  'img/favicon.ico',
]);

const FORMATS = Object.freeze([
  { key: 'webp', ext: 'webp' },
  { key: 'jpg', ext: 'jpg' },
]);

// Spaces are allowed inside a path ("img/IMG_2993 (1).jpg" -> img/img_2993-1-<w>.*); other whitespace is not.
const IMAGE_PATH_RE = /^\/?(img\/[^\t\n\r\f\v"'<>?#\\]+\.(?:jpe?g|png|webp|gif|tiff?|avif))$/i;
const IMG_SRC_RE = /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi;
const TMP_RE = /^\..+\.\d+\.tmp$/;
const TMP_GRACE_MS = 10 * 60 * 1000; // a concurrent run may still be writing younger temp files
const POOL_SIZE = 4; // matches the default libuv thread pool that sharp jobs run on

/* ---------- pure helpers (no sharp needed) ---------- */

/** Every local image path that data.json references, normalised to "img/...", sorted. */
function collectImageRefs(data) {
  const refs = new Set();
  const addIfImage = (value) => {
    const m = IMAGE_PATH_RE.exec(value);
    if (m) refs.add(m[1]);
    return Boolean(m);
  };
  const visit = (value) => {
    if (typeof value === 'string') {
      if (!addIfImage(value) && value.includes('<img')) {
        for (const tag of value.matchAll(IMG_SRC_RE)) addIfImage(tag[2]);
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit(data);
  for (const ref of refs) {
    if (ref.split('/').some((part) => part === '..' || part === '.' || part === '')) {
      throw new Error(`images: unsafe image path in data.json: ${ref}`);
    }
  }
  return [...refs].sort();
}

/** "img/gallery/Picture 1.JPG" -> "img/gallery/picture-1" (output path without width/extension). */
function outputStem(ref) {
  const ext = path.posix.extname(ref);
  const stem = path.posix
    .basename(ref, ext)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!stem) throw new Error(`images: cannot derive an output name from ${ref}`);
  return `${path.posix.dirname(ref)}/${stem}`;
}

/**
 * Target widths clamped to the original width, never upscaled, ascending, unique: SETTINGS.widths plus
 * the ROLE_WIDTHS of `roles` (an iterable of role names, see imageRoles).
 */
function variantWidths(originalWidth, roles = []) {
  const targets = [...SETTINGS.widths];
  for (const role of roles) targets.push(...(ROLE_WIDTHS[role] || []));
  const widths = new Set(targets.map((target) => Math.min(target, originalWidth)));
  return [...widths].sort((a, b) => a - b);
}

/**
 * Roles of the images data.json references, as a Map "img/..." -> Set of role names:
 *   thumb  every images[].src of an artwork with more than one image (gallery thumbnails)
 *   wide   preview and preview_hover of an artwork with card "wide"
 */
function imageRoles(data) {
  const roles = new Map();
  const add = (src, role) => {
    const m = typeof src === 'string' ? IMAGE_PATH_RE.exec(src) : null;
    if (!m) return;
    if (!roles.has(m[1])) roles.set(m[1], new Set());
    roles.get(m[1]).add(role);
  };
  for (const hub of (data && data.hubs) || []) {
    for (const a of hub.artworks || []) {
      const images = Array.isArray(a.images) ? a.images : [];
      if (images.length > 1) for (const im of images) add(im && im.src, 'thumb');
      if (a.card === 'wide') { add(a.preview, 'wide'); add(a.preview_hover, 'wide'); }
    }
  }
  return roles;
}

/** Path of one variant relative to the output root, e.g. "img/gallery/picture32_1-600.webp". */
function variantPath(ref, width, ext) {
  return `${outputStem(ref)}-${width}.${ext}`;
}

/* The encoder settings (not the widths: like ROLE_WIDTHS they add or remove whole variant files, which run() and
   verify() compare by width, so a new width writes only its own files). */
function settingsFingerprint() {
  const encoder = { ...SETTINGS };
  delete encoder.widths;
  return crypto.createHash('sha256').update(JSON.stringify(encoder)).digest('hex').slice(0, 16);
}

/** Manifest digest of one image: changes when the source bytes or the encoder settings change. */
function inputDigest(sourceBuffer) {
  return crypto.createHash('sha256').update(`${settingsFingerprint()}\n`).update(sourceBuffer).digest('hex').slice(0, 16);
}

function resolveDirs(root, appDir) {
  const rootDir = path.resolve(root);
  const appRoot = path.resolve(rootDir, appDir);
  const srcDir = path.join(rootDir, 'src');
  if (appRoot === rootDir || appRoot === path.parse(appRoot).root || isInside(appRoot, srcDir) || isInside(srcDir, appRoot)) {
    throw new Error(`images: refusing to use output directory ${appRoot}`);
  }
  return { rootDir, appRoot, srcDir, manifestFile: path.join(srcDir, 'img', 'manifest.json') };
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonIfExists(file) {
  try {
    return readJson(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function serializeManifest(manifest) {
  const sorted = {};
  for (const key of Object.keys(manifest).sort()) sorted[key] = manifest[key];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

async function statOrNull(file) {
  try {
    return await fsp.stat(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Exact-case existence check, so a case typo fails on every file system, not only on Linux. */
async function findSources(srcDir, refs) {
  const listings = new Map();
  const missing = [];
  for (const ref of refs) {
    const dir = path.join(srcDir, path.posix.dirname(ref));
    if (!listings.has(dir)) listings.set(dir, await fsp.readdir(dir).catch(() => []));
    const names = listings.get(dir);
    const name = path.posix.basename(ref);
    if (!names.includes(name)) {
      const near = names.find((n) => n.toLowerCase() === name.toLowerCase());
      missing.push(near ? `${ref} (src has "${near}"; the case differs)` : ref);
    }
  }
  return missing;
}

function checkStemCollisions(refs) {
  const byStem = new Map();
  for (const ref of refs) {
    const stem = outputStem(ref);
    if (byStem.has(stem)) {
      throw new Error(`images: ${byStem.get(stem)} and ${ref} would both be written as ${stem}-<w>.*; rename one source`);
    }
    byStem.set(stem, ref);
  }
}

async function mapPool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

async function writeAtomic(file, buffer) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await fsp.writeFile(tmp, buffer);
  await fsp.rename(tmp, file);
}

async function walkFiles(dir, base = '') {
  const out = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walkFiles(path.join(dir, entry.name), rel)));
    else out.push(rel); // files and symlinks (never followed)
  }
  return out;
}

async function removeEmptyDirs(dir, isRoot = true) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirs(path.join(dir, entry.name), false);
  }
  if (!isRoot && (await fsp.readdir(dir)).length === 0) await fsp.rmdir(dir);
}

function formatMB(bytes) {
  return `${(bytes / 1e6).toFixed(2)} MB (${(bytes / 1048576).toFixed(2)} MiB)`;
}

/* ---------- sharp work ---------- */

function loadSharp() {
  const sharp = require('sharp');
  sharp.cache(false); // never serve stale pixels for a changed file (gulp watch keeps the process alive)
  return sharp;
}

async function orientedSize(sharp, input) {
  const meta = await sharp(input).metadata();
  const swap = meta.orientation >= 5 && meta.orientation <= 8;
  return { width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height };
}

function encode(sharp, input, width, formatKey) {
  const pipeline = sharp(input)
    .autoOrient()
    .flatten({ background: SETTINGS.background })
    .resize({ width, withoutEnlargement: true, fastShrinkOnLoad: SETTINGS.fastShrinkOnLoad })
    .toColourspace('srgb');
  const encoded = formatKey === 'webp' ? pipeline.webp({ ...SETTINGS.webp }) : pipeline.jpeg({ ...SETTINGS.jpeg });
  return encoded.toBuffer({ resolveWithObject: true });
}

/* ---------- public API ---------- */

/**
 * Generate the variants, write src/img/manifest.json, copy the icons and delete every other
 * file in <appDir>/img. Resolves to a summary object; rejects (nothing deleted) on any error.
 */
async function run({
  root = process.cwd(),
  appDir = process.env.APP_DIR || 'app',
  force = false,
  log = console.log,
} = {}) {
  const started = Date.now();
  const { rootDir, appRoot, srcDir, manifestFile } = resolveDirs(root, appDir);
  const data = readJson(path.join(rootDir, 'data.json'));
  const refs = collectImageRefs(data);
  const roles = imageRoles(data);
  checkStemCollisions(refs);

  const missing = await findSources(srcDir, refs);
  if (missing.length) {
    throw new Error(`images: ${missing.length} referenced image(s) missing in src/:\n  ${missing.join('\n  ')}\nPut each original into src/ at the path data.json uses.`);
  }
  const missingCopies = [];
  for (const rel of COPY_AS_IS) if (!(await statOrNull(path.join(srcDir, rel)))) missingCopies.push(rel);
  if (missingCopies.length) throw new Error(`images: copy-as-is file(s) missing in src/: ${missingCopies.join(', ')}`);

  await fsp.mkdir(path.join(appRoot, 'img'), { recursive: true });
  const outImg = await fsp.realpath(path.join(appRoot, 'img'));
  if (isInside(outImg, srcDir) || isInside(srcDir, outImg)) {
    throw new Error(`images: ${path.join(appRoot, 'img')} resolves to ${outImg}, which overlaps src/; refusing to write there`);
  }

  const previousManifest = readJsonIfExists(manifestFile) || {};
  const sharp = loadSharp();
  const manifest = {};
  const failures = [];
  let generated = 0;
  let reused = 0;

  await mapPool(refs, POOL_SIZE, async (ref) => {
    try {
      const srcFile = path.join(srcDir, ref);
      const srcStat = await fsp.stat(srcFile);
      const input = await fsp.readFile(srcFile);
      const { width, height } = await orientedSize(sharp, input);
      if (!width || !height) throw new Error('could not read the image size');
      const digest = inputDigest(input);
      const previous = previousManifest[ref];
      // Same digest: source bytes and settings unchanged, so outputs with the recorded size are
      // current whatever their mtime. No digest recorded: the SPEC rule (output newer than source).
      const unchanged = !force && Boolean(previous) && previous.digest === digest;
      const legacy = !force && !(previous && previous.digest);
      const entry = { width, height, digest, webp: [], jpg: [] };
      const widths = variantWidths(width, roles.get(ref) || []);
      let made = 0;
      for (const w of widths) {
        for (const { key, ext } of FORMATS) {
          const rel = variantPath(ref, w, ext);
          const outFile = path.join(outImg, path.relative('img', rel));
          const outStat = await statOrNull(outFile);
          let variant = null;
          if (outStat && outStat.size > 0 && (unchanged || (legacy && outStat.mtimeMs > srcStat.mtimeMs))) {
            const known = previous && previous[key] && previous[key].find((v) => v.src === `/${rel}`);
            if (known && known.bytes === outStat.size && known.w === w && Number.isInteger(known.h)) {
              variant = { w, h: known.h, src: `/${rel}`, bytes: outStat.size };
            } else if (legacy) {
              try {
                const meta = await sharp(outFile).metadata();
                if (meta.width === w) variant = { w, h: meta.height, src: `/${rel}`, bytes: outStat.size };
              } catch {
                variant = null; // unreadable output: regenerate below
              }
            }
          }
          if (variant) {
            reused++;
          } else {
            const { data: buffer, info } = await encode(sharp, input, w, key);
            if (info.width !== w) throw new Error(`expected width ${w}, encoder gave ${info.width}`);
            await writeAtomic(outFile, buffer);
            variant = { w, h: info.height, src: `/${rel}`, bytes: buffer.length };
            generated++;
            made++;
          }
          entry[key].push(variant);
        }
      }
      manifest[ref] = entry;
      if (made) log(`  + ${ref} (${width}x${height}): ${made} variant(s) written, widths ${widths.join('/')}`);
    } catch (err) {
      failures.push(`${ref}: ${err.message}`);
    }
  });

  if (failures.length) {
    throw new Error(`images: ${failures.length} image(s) failed; nothing was deleted and the manifest was not written:\n  ${failures.sort().join('\n  ')}`);
  }

  // Manifest (only rewritten when it changes, so watchers do not loop).
  const manifestText = serializeManifest(manifest);
  // CR ignored: a checkout with CRLF line endings does not rewrite an unchanged manifest
  const oldManifestText = fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile, 'utf8').replace(/\r\n?/g, '\n') : null;
  const manifestChanged = manifestText !== oldManifestText;
  if (manifestChanged) await writeAtomic(manifestFile, manifestText);

  // Copy-as-is icons.
  let copied = 0;
  for (const rel of COPY_AS_IS) {
    const from = path.join(srcDir, rel);
    const to = path.join(outImg, path.relative('img', rel));
    const want = await fsp.readFile(from);
    const have = await fsp.readFile(to).catch(() => null);
    if (!have || !have.equals(want)) {
      await writeAtomic(to, want);
      copied++;
      log(`  = ${rel} copied as is`);
    }
  }

  // Delete everything else in <appDir>/img.
  const keep = new Set(COPY_AS_IS);
  for (const entry of Object.values(manifest)) {
    for (const { key } of FORMATS) for (const v of entry[key]) keep.add(v.src.slice(1));
  }
  let deleted = 0;
  let deletedBytes = 0;
  for (const relInImg of await walkFiles(outImg)) {
    const rel = `img/${relInImg}`;
    if (keep.has(rel)) continue;
    const file = path.join(outImg, relInImg);
    const st = await fsp.lstat(file);
    if (TMP_RE.test(path.basename(file)) && Date.now() - st.mtimeMs < TMP_GRACE_MS) continue;
    await fsp.unlink(file);
    deleted++;
    deletedBytes += st.isFile() ? st.size : 0;
  }
  await removeEmptyDirs(outImg);
  // Run as root (the dev container): what was written keeps the owner of the repository.
  matchOwner(rootDir, [outImg, manifestFile]);

  // Totals.
  let files = 0;
  let bytes = 0;
  for (const relInImg of await walkFiles(outImg)) {
    files++;
    bytes += (await fsp.lstat(path.join(outImg, relInImg))).size;
  }
  const variants = generated + reused;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (!generated && !deleted && !copied && !manifestChanged) {
    log(`images: everything is up to date (${refs.length} images, ${variants} variants); nothing written or deleted [${seconds}s]`);
  } else {
    log(`images: ${refs.length} images, ${variants} variants (${generated} written, ${reused} up to date), ${copied} icon(s) copied, ${deleted} stale file(s) deleted (${formatMB(deletedBytes)}), manifest ${manifestChanged ? 'updated' : 'unchanged'} [${seconds}s]`);
  }
  log(`images: ${path.relative(rootDir, path.join(appRoot, 'img')) || 'img'}: ${files} files, ${formatMB(bytes)}`);
  return { images: refs.length, variants, generated, reused, copied, deleted, deletedBytes, manifestChanged, files, bytes };
}

/**
 * Read-only consistency check (no sharp): data refs vs manifest, manifest digests vs the current
 * sources and settings, variant files and sizes, copy-as-is files, and files in <appDir>/img that
 * should not be there. Resolves to { problems: string[], images, variants }.
 */
async function verify({ root = process.cwd(), appDir = process.env.APP_DIR || 'app' } = {}) {
  const { rootDir, appRoot, srcDir, manifestFile } = resolveDirs(root, appDir);
  const problems = [];
  const data = readJson(path.join(rootDir, 'data.json'));
  const refs = collectImageRefs(data);
  const roles = imageRoles(data);
  const manifest = readJsonIfExists(manifestFile);
  if (!manifest) return { problems: [`missing ${path.relative(rootDir, manifestFile)}`], images: refs.length, variants: 0 };
  for (const ref of await findSources(srcDir, refs)) problems.push(`source missing in src/: ${ref}`);
  if (serializeManifest(manifest) !== fs.readFileSync(manifestFile, 'utf8').replace(/\r\n?/g, '\n')) problems.push('manifest keys are not sorted or not in the canonical format');
  const keep = new Set(COPY_AS_IS);
  let variants = 0;
  for (const ref of refs) if (!manifest[ref]) problems.push(`no manifest entry for ${ref}`);
  for (const [ref, entry] of Object.entries(manifest)) {
    if (!refs.includes(ref)) problems.push(`manifest entry not referenced by data.json: ${ref}`);
    if (!Number.isInteger(entry.width) || !Number.isInteger(entry.height) || entry.width <= 0 || entry.height <= 0) {
      problems.push(`${ref}: bad width/height`);
      continue;
    }
    const source = await fsp.readFile(path.join(srcDir, ref)).catch(() => null);
    if (source && entry.digest !== inputDigest(source)) {
      problems.push(`${ref}: ${entry.digest ? 'the source or the encoder settings changed after its variants were made' : 'no digest (written by an older images.js)'}; run npm run image`);
    }
    const expected = variantWidths(entry.width, roles.get(ref) || []);
    for (const { key, ext } of FORMATS) {
      const list = Array.isArray(entry[key]) ? entry[key] : [];
      const widths = list.map((v) => v.w);
      if (JSON.stringify(widths) !== JSON.stringify(expected)) problems.push(`${ref}: ${key} widths ${widths.join('/')} != ${expected.join('/')}`);
      for (const v of list) {
        variants++;
        const want = `/${variantPath(ref, v.w, ext)}`;
        if (v.src !== want) problems.push(`${ref}: ${key} src ${v.src} != ${want}`);
        keep.add(v.src.slice(1));
        const st = await statOrNull(path.join(appRoot, v.src.slice(1)));
        if (!st) problems.push(`missing variant file ${v.src}`);
        else if (st.size !== v.bytes) problems.push(`${v.src}: ${st.size} bytes on disk, manifest says ${v.bytes}`);
        const expectH = Math.round((entry.height * v.w) / entry.width);
        if (!Number.isInteger(v.h) || Math.abs(v.h - expectH) > 1) problems.push(`${v.src}: height ${v.h}, expected about ${expectH}`);
      }
    }
  }
  for (const rel of COPY_AS_IS) {
    const want = await fsp.readFile(path.join(srcDir, rel)).catch(() => null);
    const have = await fsp.readFile(path.join(appRoot, rel)).catch(() => null);
    if (!want) problems.push(`copy-as-is source missing: src/${rel}`);
    else if (!have || !have.equals(want)) problems.push(`copy-as-is file missing or different: ${rel}`);
  }
  for (const relInImg of await walkFiles(path.join(appRoot, 'img'))) {
    if (!keep.has(`img/${relInImg}`)) problems.push(`unexpected file in output: img/${relInImg}`);
  }
  return { problems, images: refs.length, variants };
}

/** Download the YouTube thumbnail (maxres, then sd, then hq) as the hero poster source. */
async function fetchHeroPoster({ root = process.cwd(), log = console.log } = {}) {
  const rootDir = path.resolve(root);
  const data = readJson(path.join(rootDir, 'data.json'));
  const id = data.site && data.site.youtube_id;
  const ref = data.site && data.site.images && data.site.images.hero_poster;
  if (!id || !ref) throw new Error('images: data.json needs site.youtube_id and site.images.hero_poster');
  const sharp = loadSharp();
  for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
    const url = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${name}.jpg`;
    const res = await fetch(url);
    if (!res.ok) {
      log(`  ${url}: HTTP ${res.status}`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    if (meta.format !== 'jpeg' || meta.width <= 120 || meta.height <= 90) {
      log(`  ${url}: ${meta.width}x${meta.height} placeholder, skipped`);
      continue;
    }
    const dest = path.join(rootDir, 'src', ref);
    await writeAtomic(dest, buffer);
    matchOwner(rootDir, [dest]);
    log(`images: hero poster ${url} (${meta.width}x${meta.height}, ${buffer.length} bytes) -> src/${ref}`);
    return { url, width: meta.width, height: meta.height, bytes: buffer.length, file: dest };
  }
  throw new Error(`images: no usable YouTube thumbnail for ${id}`);
}

module.exports = {
  run,
  verify,
  fetchHeroPoster,
  collectImageRefs,
  imageRoles,
  outputStem,
  variantWidths,
  variantPath,
  inputDigest,
  COPY_AS_IS,
  SETTINGS,
  ROLE_WIDTHS,
};

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const known = new Set(['--force', '--check', '--fetch-poster', '--help', '-h']);
  const unknown = [...args].filter((a) => !known.has(a));
  const root = path.resolve(__dirname, '..');
  (async () => {
    if (unknown.length || args.has('--help') || args.has('-h')) {
      console.log('usage: node scripts/images.js [--force] [--check] [--fetch-poster]   (APP_DIR selects the output root, default app)');
      if (unknown.length) process.exitCode = 2;
      return;
    }
    if (args.has('--check')) {
      const { problems, images, variants } = await verify({ root });
      if (problems.length) {
        console.error(`images --check: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
        process.exitCode = 1;
      } else {
        console.log(`images --check: OK (${images} images, ${variants} variants)`);
      }
      return;
    }
    if (args.has('--fetch-poster')) await fetchHeroPoster({ root });
    await run({ root, force: args.has('--force') });
  })().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  });
}
