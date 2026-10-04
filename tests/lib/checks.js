'use strict';
// Pure check helpers shared by the static and browser tests (no dependencies, unit-tested in
// tests/static/helpers.test.js).

const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------------------------------
// Messages

/** Format offenders for an assertion message: the first `max` items, then "... and N more". */
function fmtList(items, max = 20) {
  const list = [...items];
  const shown = list.slice(0, max).map((s) => `  - ${s}`);
  if (list.length > max) shown.push(`  ... and ${list.length - max} more`);
  return shown.join('\n');
}

/** Fail with a readable message when `problems` is not empty. */
function expectNone(problems, header) {
  const list = [...problems];
  if (list.length === 0) return;
  throw new assert.AssertionError({
    message: `${header} (${list.length}):\n${fmtList(list)}`,
    actual: list.length,
    expected: 0,
    operator: 'expectNone',
  });
}

/** Length in Unicode code points (what search engines and humans count). */
function cpLen(str) {
  return [...String(str)].length;
}

// ---------------------------------------------------------------------------------------------------
// Forbidden content (SPEC 12.4) — Tilda, shop and blog leftovers

/** Remove absolute http(s) URLs (also JSON-escaped https:\/\/...) so e.g. https://www.etsy.com/shop/... is not a "shop" word. */
function stripUrls(textIn) {
  return String(textIn).replace(/\bhttps?:(?:\\?\/){2}[^\s"'<>()`]+/gi, ' ');
}

const FORBIDDEN_PATTERNS = [
  { label: 'tilda', re: /tilda/i },
  { label: 't706 (Tilda cart)', re: /t706/i },
  { label: 't754 (Tilda catalog)', re: /t754/i },
  { label: 't-store', re: /t-store/i },
  { label: 'data-tilda', re: /data-tilda/i },
  { label: 'price', re: /\bprices?\b/i },
  { label: 'cart', re: /\bcarts?\b/i },
  { label: '€ (euro sign)', re: /€|&euro;|&#0*8364;|&#x0*20ac;/i },
  { label: 'buy', re: /\bbuy(?:ing)?\b/i },
  { label: 'shop/shopping', re: /\bshop(?:s|ping)?\b/i },
  { label: 'checkout', re: /\bcheckout\b/i },
  { label: 'sold', re: /\bsold\b/i },
  { label: 'delivery across', re: /delivery\s+across/i },
  { label: 'commissions welcome', re: /commissions\s+welcome/i },
  { label: 'schema.org Offer', re: /"@type"\s*:\s*"(?:Aggregate)?Offer"/ },
  { label: 'retired analytics event', re: /\b(?:cart_order|purchase_inquiry|artwork_view|gallery_filter)\b/ },
];

/** Shop and sales words are not checked in third-party licence texts (the OFL says fonts may be "sold"). */
const LICENSE_FILE_RE = /(^|\/)(ofl|licen[cs]e|copying|notice)([._-][^/]*)?$/i;

/**
 * Find forbidden words in a text file's content (URLs removed first).
 * @returns {{label: string, match: string, line: number, excerpt: string}[]}
 */
function findForbidden(content, { patterns = FORBIDDEN_PATTERNS, skipSalesWords = false } = {}) {
  const stripped = stripUrls(content);
  const hits = [];
  const salesLabels = new Set(['price', 'cart', 'buy', 'shop/shopping', 'checkout', 'sold', 'delivery across', 'commissions welcome', '€ (euro sign)']);
  for (const p of patterns) {
    if (skipSalesWords && salesLabels.has(p.label)) continue;
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : `${p.re.flags}g`);
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const line = stripped.slice(0, m.index).split('\n').length;
      const from = Math.max(0, m.index - 40);
      const excerpt = stripped.slice(from, m.index + m[0].length + 40).replace(/\s+/g, ' ').trim();
      hits.push({ label: p.label, match: m[0], line, excerpt });
      if (m[0] === '') re.lastIndex++;
    }
  }
  return hits;
}

const CYRILLIC_RE = /[Ѐ-ӿ]/g;

/** Every Cyrillic character with its line number. */
function findCyrillic(content) {
  const out = [];
  const re = new RegExp(CYRILLIC_RE.source, 'g');
  let m;
  while ((m = re.exec(content)) !== null) {
    const line = content.slice(0, m.index).split('\n').length;
    out.push({ char: m[0], code: `U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`, line,
      excerpt: content.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, ' ').trim() });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Line breaks in visible text

/**
 * A breaking space where visible text must keep a no-break space (U+00A0, scripts/build-site.js keepTogether()):
 * inside a size ("190 × 45 cm", "29.7 cm") and after an initial or a short title ("P. Molina", "St. Albani",
 * "U.S. Data"). Any HTML white space counts: a line break in the source wraps like a space.
 */
const BREAKING_SPACE_RE = /\d[\t\n\f\r ]+×|×[\t\n\f\r ]+\d|\d[\t\n\f\r ]+(?:cm|mm)\b|\b(?:[A-Z]|St|Dr|Mr|Mrs|Ms|Mt)\.[\t\n\f\r ]+(?=[A-Z])/;

// ---------------------------------------------------------------------------------------------------
// Headings

/**
 * Problems in a heading outline (levels in document order): the first heading must be h1 and no level
 * may be skipped on the way down (h2 -> h4). Going up any number of levels is fine.
 */
function headingProblems(levels) {
  const problems = [];
  let prev = 0;
  levels.forEach((level, idx) => {
    if (level > prev + 1) {
      problems.push(prev === 0
        ? `heading #${idx + 1} is h${level}, but the first heading must be h1`
        : `heading #${idx + 1} jumps from h${prev} to h${level}`);
    }
    prev = level;
  });
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// URLs in markup and CSS

function parseSrcset(value) {
  if (!value) return [];
  return value.split(/,(?=\s*\S)/).map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
}

/** URLs from url(...) and @import in CSS (data: URIs and fragments skipped). */
function cssUrls(css) {
  const out = [];
  const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
  let m;
  while ((m = re.exec(css)) !== null) {
    const u = (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3] || '').trim();
    if (u && !/^data:/i.test(u) && !u.startsWith('#')) out.push(u);
  }
  const imp = /@import\s+(?:"([^"]+)"|'([^']+)')/gi;
  while ((m = imp.exec(css)) !== null) out.push(m[1] || m[2]);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// XML (sitemap) — strict well-formedness parser

/**
 * Parse XML; throws Error("line L: message") when the document is not well formed.
 * Returns the root element { name, attrs, children: [element|string] }.
 */
function parseXml(src) {
  let s = src;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  let i = 0;
  const lineAt = (pos) => s.slice(0, pos).split('\n').length;
  const fail = (msg, pos = i) => { throw new Error(`line ${lineAt(pos)}: ${msg}`); };
  const NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]*/;
  const checkRefs = (str, pos) => {
    const bad = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.exec(str);
    if (bad) fail('"&" is not part of a valid entity reference', pos + bad.index);
    return str.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, r) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[r]
      || String.fromCodePoint(r[1] === 'x' ? parseInt(r.slice(2), 16) : parseInt(r.slice(1), 10))));
  };
  if (s.startsWith('<?xml')) {
    const end = s.indexOf('?>');
    if (end === -1) fail('unterminated XML declaration');
    i = end + 2;
  }
  const stack = [];
  let root = null;
  while (i < s.length) {
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end === -1) fail('unterminated comment');
      i = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      if (!stack.length) fail('CDATA outside the root element');
      const end = s.indexOf(']]>', i);
      if (end === -1) fail('unterminated CDATA');
      stack[stack.length - 1].children.push(s.slice(i + 9, end));
      i = end + 3;
      continue;
    }
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i);
      if (end === -1) fail('unterminated processing instruction');
      i = end + 2;
      continue;
    }
    if (s.startsWith('<!', i)) fail('DOCTYPE/declaration is not expected in a sitemap');
    if (s.startsWith('</', i)) {
      const m = NAME.exec(s.slice(i + 2));
      if (!m) fail('bad end tag');
      const name = m[0];
      let j = i + 2 + name.length;
      while (/\s/.test(s[j] || '')) j++;
      if (s[j] !== '>') fail(`bad end tag </${name}`);
      const open = stack.pop();
      if (!open) fail(`end tag </${name}> without start tag`);
      if (open.name !== name) fail(`end tag </${name}> does not match <${open.name}>`);
      i = j + 1;
      continue;
    }
    if (s[i] === '<') {
      const m = NAME.exec(s.slice(i + 1));
      if (!m) fail('"<" must start a tag');
      if (!stack.length && root) fail('more than one root element');
      const el = { name: m[0], attrs: {}, children: [] };
      let j = i + 1 + m[0].length;
      for (;;) {
        const ws = /^\s*/.exec(s.slice(j))[0].length;
        j += ws;
        if (s.startsWith('/>', j)) { j += 2; el.selfClosed = true; break; }
        if (s[j] === '>') { j += 1; break; }
        if (!ws) fail(`attributes of <${el.name}> must be separated by whitespace`, j);
        const an = NAME.exec(s.slice(j));
        if (!an) fail(`bad attribute in <${el.name}>`, j);
        j += an[0].length;
        const eq = /^\s*=\s*/.exec(s.slice(j));
        if (!eq) fail(`attribute ${an[0]} has no value`, j);
        j += eq[0].length;
        const q = s[j];
        if (q !== '"' && q !== "'") fail(`attribute ${an[0]} value must be quoted`, j);
        const end = s.indexOf(q, j + 1);
        if (end === -1) fail('unterminated attribute value', j);
        const raw = s.slice(j + 1, end);
        if (raw.includes('<')) fail('"<" in attribute value', j);
        if (Object.prototype.hasOwnProperty.call(el.attrs, an[0])) fail(`duplicate attribute ${an[0]}`, j);
        el.attrs[an[0]] = checkRefs(raw, j + 1);
        j = end + 1;
      }
      if (stack.length) stack[stack.length - 1].children.push(el); else root = el;
      if (!el.selfClosed) stack.push(el);
      i = j;
      continue;
    }
    const next = s.indexOf('<', i);
    const chunk = s.slice(i, next === -1 ? s.length : next);
    if (!stack.length) {
      if (chunk.trim()) fail('text outside the root element');
    } else {
      stack[stack.length - 1].children.push(checkRefs(chunk, i));
    }
    i = next === -1 ? s.length : next;
  }
  if (stack.length) fail(`element <${stack[stack.length - 1].name}> is not closed`);
  if (!root) fail('no root element', 0);
  return root;
}

function xmlChildren(el, name) {
  return el.children.filter((c) => typeof c === 'object' && (name === undefined || c.name === name || c.name.endsWith(`:${name}`)));
}

function xmlText(el) {
  return el.children.map((c) => (typeof c === 'string' ? c : xmlText(c))).join('');
}

function isIsoDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

// ---------------------------------------------------------------------------------------------------
// Image dimensions (JPEG with EXIF orientation, PNG, GIF, WebP) — no dependencies

function exifOrientation(buf, tiff, end) {
  if (tiff + 8 > end) return null;
  const order = buf.toString('ascii', tiff, tiff + 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const r16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const r32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > end) return null;
  const n = r16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) break;
    if (r16(e) === 0x0112) return r16(e + 8);
  }
  return null;
}

function jpegSize(buf) {
  let i = 2;
  let orientation = 1;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) break;
    const segLen = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.toString('ascii', i + 4, i + 10) === 'Exif\u0000\u0000') {
      orientation = exifOrientation(buf, i + 10, Math.min(buf.length, i + 2 + segLen)) || orientation;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > buf.length) return null;
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      const swap = orientation >= 5 && orientation <= 8;
      return { type: 'jpeg', width: swap ? h : w, height: swap ? w : h, orientation };
    }
    i += 2 + segLen;
  }
  return null;
}

/** Display size of an image file buffer (EXIF orientation applied for JPEG), or null when unknown. */
function imageSize(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.length >= 24) {
    return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.toString('ascii', 0, 3) === 'GIF') return { type: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' && buf.length >= 30) {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { type: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { type: 'webp', width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { type: 'webp', width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) return jpegSize(buf);
  return null;
}

module.exports = {
  fmtList,
  expectNone,
  cpLen,
  stripUrls,
  FORBIDDEN_PATTERNS,
  LICENSE_FILE_RE,
  findForbidden,
  findCyrillic,
  CYRILLIC_RE,
  BREAKING_SPACE_RE,
  headingProblems,
  parseSrcset,
  cssUrls,
  parseXml,
  xmlChildren,
  xmlText,
  isIsoDate,
  imageSize,
};
