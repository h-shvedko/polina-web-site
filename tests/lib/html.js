'use strict';
// Small, lenient HTML parser for the static tests (no dependencies).
// It never throws on bad markup (the old Tilda pages must parse too); html-validate does the strict checks.
//
//   const doc = parseHtml(source);
//   qsa(doc, 'a[href^="mailto:"]')   -> elements in document order
//   qs(doc, 'h1.hero__title')        -> first match or null
//   attr(el, 'href')                 -> decoded attribute value or null
//   text(el)                         -> decoded text content (script/style/template content excluded)
//   lineOf(el)                       -> 1-based source line, for messages
//
// Selector support: type, *, #id, .class, [attr], [attr=v], [attr~=v], [attr^=v], [attr$=v], [attr*=v],
// [attr|=v] (optional " i" flag), :not(<compound>), descendant (space) and child (>) combinators, groups (a, b).

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param',
  'source', 'track', 'wbr', 'keygen', 'command', 'basefont', 'bgsound', 'frame']);
// Content is not markup (scripting-enabled parsing). noscript is parsed as markup on purpose so that
// fallback <img>/<link> elements are checked too.
const RAW_TEXT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const RCDATA = new Set(['textarea', 'title']);
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'search']);
const PHRASING = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn', 'em', 'i',
  'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var',
  'wbr', 'img', 'picture', 'source', 'svg', 'math', 'input', 'select', 'textarea', 'output', 'meter',
  'progress', 'del', 'ins', 'font', 'big', 'tt', 'strike', 'nobr']);
const TEXT_EXCLUDED = new Set(['script', 'style', 'template']);

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®',
  trade: '™', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»',
  lsaquo: '‹', rsaquo: '›', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  sbquo: '‚', bdquo: '„', middot: '·', bull: '•', times: '×', divide: '÷',
  euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°', plusmn: '±',
  sect: '§', para: '¶', shy: '­', iexcl: '¡', iquest: '¿', auml: 'ä',
  ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à',
  acirc: 'â', aring: 'å', aelig: 'æ', ccedil: 'ç', iacute: 'í', igrave: 'ì',
  icirc: 'î', iuml: 'ï', ntilde: 'ñ', oacute: 'ó', ograve: 'ò', ocirc: 'ô',
  otilde: 'õ', oslash: 'ø', uacute: 'ú', ugrave: 'ù', ucirc: 'û', yacute: 'ý',
  Eacute: 'É', Egrave: 'È', Aacute: 'Á', Agrave: 'À', Ccedil: 'Ç',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', minus: '−',
  thinsp: ' ', ensp: ' ', emsp: ' ', zwnj: '‌', zwj: '‍', lrm: '‎',
  rlm: '‏', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³',
  prime: '′', Prime: '″', hearts: '♥', check: '✓', star: '☆', starf: '★',
  verbar: '|', sol: '/', colon: ':', comma: ',', period: '.', excl: '!', quest: '?', num: '#',
  lpar: '(', rpar: ')', lsqb: '[', rsqb: ']', lowbar: '_', equals: '=', plus: '+', ast: '*', percnt: '%',
  dollar: '$', commat: '@', grave: '`', Tab: '\t', NewLine: '\n',
};

/** Decode HTML character references (&amp; &#39; &#x2F; &mdash; ...). Unknown named references stay as they are. */
function decodeEntities(str) {
  if (!str || str.indexOf('&') === -1) return str;
  return str.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (m, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, ref) ? NAMED_ENTITIES[ref] : m;
  });
}

function lineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function makeLineOf(starts) {
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

const NAME_CHAR = /[^\s/>"'=<]/;

/**
 * Parse HTML into a light tree.
 * Element: { type: 'element', tag, attrs: Map<name, decodedValue>, attrList: [{ name, value, raw }], children, parent, start }
 * Text: { type: 'text', text (decoded), raw, parent, start }; Comment: { type: 'comment', text, parent, start }
 */
function parseHtml(src) {
  const doc = { type: 'document', tag: '#document', children: [], parent: null, start: 0, source: src };
  const starts = lineStarts(src);
  doc.lineOf = makeLineOf(starts);
  const stack = [doc];
  const current = () => stack[stack.length - 1];
  const len = src.length;
  let i = 0;

  const pushText = (raw, start, decode = true) => {
    if (!raw) return;
    const node = { type: 'text', raw, text: decode ? decodeEntities(raw) : raw, parent: current(), start };
    current().children.push(node);
  };
  const popTo = (index) => { stack.length = index; };
  const findOpen = (tag, boundaries) => {
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag;
      if (t === tag) return k;
      if (boundaries && boundaries.has(t)) return -1;
    }
    return -1;
  };
  const closePIfOpen = () => {
    for (let k = stack.length - 1; k > 0; k--) {
      const t = stack[k].tag;
      if (t === 'p') { popTo(k); return; }
      if (!PHRASING.has(t)) return;
    }
  };
  const LIST_BOUNDARY = new Set(['ul', 'ol', 'menu']);
  const DL_BOUNDARY = new Set(['dl']);
  const TABLE_BOUNDARY = new Set(['table']);

  const openElement = (tag, attrList, selfClosing, start) => {
    if (CLOSES_P.has(tag)) closePIfOpen();
    if (tag === 'li') { const k = findOpen('li', LIST_BOUNDARY); if (k > 0) popTo(k); }
    if (tag === 'dt' || tag === 'dd') {
      const k = Math.max(findOpen('dt', DL_BOUNDARY), findOpen('dd', DL_BOUNDARY));
      if (k > 0) popTo(k);
    }
    if (tag === 'option' && current().tag === 'option') stack.pop();
    if (tag === 'td' || tag === 'th') {
      const k = Math.max(findOpen('td', TABLE_BOUNDARY), findOpen('th', TABLE_BOUNDARY));
      if (k > 0) popTo(k);
    }
    if (tag === 'tr') { const k = findOpen('tr', TABLE_BOUNDARY); if (k > 0) popTo(k); }
    if (tag === 'body') { const k = findOpen('head'); if (k > 0) popTo(k); }
    const attrs = new Map();
    for (const a of attrList) if (!attrs.has(a.name)) attrs.set(a.name, a.value);
    const el = { type: 'element', tag, attrs, attrList, children: [], parent: current(), start, selfClosing };
    current().children.push(el);
    if (!VOID.has(tag) && !selfClosing) stack.push(el);
    return el;
  };

  while (i < len) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { pushText(src.slice(i), i); break; }
    if (lt > i) pushText(src.slice(i, lt), i);
    i = lt;
    // Comment
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const stop = end === -1 ? len : end + 3;
      current().children.push({ type: 'comment', text: src.slice(i + 4, end === -1 ? len : end), parent: current(), start: i });
      i = stop;
      continue;
    }
    // Doctype, CDATA, processing instruction: skip to '>'
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      if (src.startsWith('<![CDATA[', i)) {
        const end = src.indexOf(']]>', i);
        pushText(src.slice(i + 9, end === -1 ? len : end), i, false);
        i = end === -1 ? len : end + 3;
        continue;
      }
      const end = src.indexOf('>', i);
      const decl = src.slice(i, end === -1 ? len : end + 1);
      if (/^<!doctype/i.test(decl)) doc.doctype = decl;
      i = end === -1 ? len : end + 1;
      continue;
    }
    // End tag
    if (src[i + 1] === '/') {
      const m = /^<\/([A-Za-z][^\s/>]*)[^>]*>?/.exec(src.slice(i, i + 256));
      if (!m) { pushText('<', i); i += 1; continue; }
      const tag = m[1].toLowerCase();
      i += m[0].length;
      if (VOID.has(tag)) continue;
      if (tag === 'p' && findOpen('p') === -1) continue;
      const k = findOpen(tag);
      if (k > 0) popTo(k);
      continue;
    }
    // Start tag
    if (!/[A-Za-z]/.test(src[i + 1] || '')) { pushText('<', i); i += 1; continue; }
    const tagStart = i;
    let j = i + 1;
    while (j < len && NAME_CHAR.test(src[j])) j++;
    const tag = src.slice(i + 1, j).toLowerCase();
    const attrList = [];
    let selfClosing = false;
    for (;;) {
      while (j < len && /\s/.test(src[j])) j++;
      if (j >= len) break;
      if (src[j] === '>') { j++; break; }
      if (src[j] === '/') {
        if (src[j + 1] === '>') { selfClosing = true; j += 2; break; }
        j++;
        continue;
      }
      const nameStart = j;
      while (j < len && !/[\s/>=]/.test(src[j])) j++;
      if (j === nameStart) { j++; continue; }
      const name = src.slice(nameStart, j).toLowerCase();
      let k = j;
      while (k < len && /\s/.test(src[k])) k++;
      let raw = null;
      if (src[k] === '=') {
        k++;
        while (k < len && /\s/.test(src[k])) k++;
        const q = src[k];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, k + 1);
          raw = src.slice(k + 1, end === -1 ? len : end);
          j = end === -1 ? len : end + 1;
        } else {
          const vs = k;
          while (k < len && !/[\s>]/.test(src[k])) k++;
          raw = src.slice(vs, k);
          j = k;
        }
      }
      attrList.push({ name, raw, value: raw === null ? '' : decodeEntities(raw) });
    }
    i = j;
    const el = openElement(tag, attrList, selfClosing && !VOID.has(tag), tagStart);
    if ((RAW_TEXT.has(tag) || RCDATA.has(tag)) && !selfClosing) {
      const closeRe = new RegExp(`</${tag}[\\s/>]`, 'ig');
      closeRe.lastIndex = i;
      const m = closeRe.exec(src);
      const end = m ? m.index : len;
      const content = src.slice(i, end);
      if (content) {
        el.children.push({ type: 'text', raw: content, text: RCDATA.has(tag) ? decodeEntities(content) : content, parent: el, start: i });
      }
      const gt = m ? src.indexOf('>', m.index) : -1;
      i = gt === -1 ? len : gt + 1;
      const k = findOpen(tag);
      if (k > 0) popTo(k);
    }
  }
  return doc;
}

// ---------------------------------------------------------------------------------------------------
// Selectors

function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of str) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseCompound(s, pos) {
  const c = { tag: null, id: null, classes: [], attrs: [], nots: [] };
  let i = pos;
  const ident = () => {
    const m = /^[A-Za-z0-9_\- -￿]+/.exec(s.slice(i));
    if (!m) throw new Error(`Bad selector near "${s.slice(i)}" in "${s}"`);
    i += m[0].length;
    return m[0];
  };
  if (s[i] === '*') { i++; c.tag = '*'; } else if (/[A-Za-z]/.test(s[i] || '')) c.tag = ident().toLowerCase();
  for (;;) {
    const ch = s[i];
    if (ch === '#') { i++; c.id = ident(); continue; }
    if (ch === '.') { i++; c.classes.push(ident()); continue; }
    if (ch === '[') {
      const end = (() => { let q = null; for (let k = i + 1; k < s.length; k++) { const x = s[k]; if (q) { if (x === q) q = null; continue; } if (x === '"' || x === "'") q = x; else if (x === ']') return k; } return -1; })();
      if (end === -1) throw new Error(`Unclosed [ in selector "${s}"`);
      const body = s.slice(i + 1, end).trim();
      const m = /^([^\s~|^$*=\]]+)\s*(?:([~|^$*]?=)\s*("([^"]*)"|'([^']*)'|[^\s\]]+))?\s*(i)?$/.exec(body);
      if (!m) throw new Error(`Bad attribute selector [${body}]`);
      const value = m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : m[3];
      c.attrs.push({ name: m[1].toLowerCase(), op: m[2] || null, value: value === undefined ? null : value, ci: !!m[6] });
      i = end + 1;
      continue;
    }
    if (s.startsWith(':not(', i)) {
      let depth = 0;
      let k = i + 4;
      for (; k < s.length; k++) { if (s[k] === '(') depth++; else if (s[k] === ')') { depth--; if (depth === 0) break; } }
      const inner = s.slice(i + 5, k);
      c.nots.push(splitTopLevel(inner, ',').map((part) => parseCompound(part, 0).compound));
      i = k + 1;
      continue;
    }
    break;
  }
  if (i === pos) throw new Error(`Bad selector near "${s.slice(pos)}" in "${s}"`);
  return { compound: c, next: i };
}

function parseComplex(s) {
  const parts = [];
  let i = 0;
  let combinator = null;
  while (i < s.length) {
    let ws = false;
    while (i < s.length && /\s/.test(s[i])) { i++; ws = true; }
    if (i >= s.length) break;
    if (s[i] === '>') { combinator = '>'; i++; while (i < s.length && /\s/.test(s[i])) i++; } else if (ws && parts.length) combinator = ' ';
    const { compound, next } = parseCompound(s, i);
    parts.push({ compound, combinator: parts.length ? (combinator || ' ') : null });
    combinator = null;
    i = next;
  }
  return parts;
}

const selectorCache = new Map();
function compileSelector(sel) {
  let compiled = selectorCache.get(sel);
  if (!compiled) {
    compiled = splitTopLevel(sel, ',').map(parseComplex);
    selectorCache.set(sel, compiled);
  }
  return compiled;
}

function matchAttr(el, a) {
  if (!el.attrs.has(a.name)) return false;
  if (a.op === null) return true;
  let v = el.attrs.get(a.name);
  let want = a.value;
  if (a.ci) { v = v.toLowerCase(); want = want.toLowerCase(); }
  switch (a.op) {
    case '=': return v === want;
    case '~=': return v.split(/\s+/).includes(want);
    case '^=': return want !== '' && v.startsWith(want);
    case '$=': return want !== '' && v.endsWith(want);
    case '*=': return want !== '' && v.includes(want);
    case '|=': return v === want || v.startsWith(`${want}-`);
    default: return false;
  }
}

function matchCompound(el, c) {
  if (!el || el.type !== 'element') return false;
  if (c.tag && c.tag !== '*' && el.tag !== c.tag) return false;
  if (c.id !== null && el.attrs.get('id') !== c.id) return false;
  if (c.classes.length) {
    const cls = classes(el);
    for (const k of c.classes) if (!cls.includes(k)) return false;
  }
  for (const a of c.attrs) if (!matchAttr(el, a)) return false;
  for (const group of c.nots) if (group.some((g) => matchCompound(el, g))) return false;
  return true;
}

function parentElement(el) {
  const p = el.parent;
  return p && p.type === 'element' ? p : null;
}

function matchFrom(el, parts, idx) {
  if (idx === 0) return true;
  const prev = parts[idx - 1].compound;
  if (parts[idx].combinator === '>') {
    const p = parentElement(el);
    return !!p && matchCompound(p, prev) && matchFrom(p, parts, idx - 1);
  }
  for (let p = parentElement(el); p; p = parentElement(p)) {
    if (matchCompound(p, prev) && matchFrom(p, parts, idx - 1)) return true;
  }
  return false;
}

function matches(el, sel) {
  if (!el || el.type !== 'element') return false;
  return compileSelector(sel).some((parts) => matchCompound(el, parts[parts.length - 1].compound) && matchFrom(el, parts, parts.length - 1));
}

function* walkElements(node) {
  for (const child of node.children || []) {
    if (child.type !== 'element') continue;
    yield child;
    yield* walkElements(child);
  }
}

function qsa(root, sel) {
  const groups = compileSelector(sel);
  const out = [];
  for (const el of walkElements(root)) {
    if (groups.some((parts) => matchCompound(el, parts[parts.length - 1].compound) && matchFrom(el, parts, parts.length - 1))) out.push(el);
  }
  return out;
}

function qs(root, sel) {
  const groups = compileSelector(sel);
  for (const el of walkElements(root)) {
    if (groups.some((parts) => matchCompound(el, parts[parts.length - 1].compound) && matchFrom(el, parts, parts.length - 1))) return el;
  }
  return null;
}

function closest(el, sel) {
  for (let p = el; p && p.type === 'element'; p = p.parent) if (matches(p, sel)) return p;
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Node helpers

function attr(el, name) {
  if (!el || !el.attrs) return null;
  const v = el.attrs.get(name.toLowerCase());
  return v === undefined ? null : v;
}

function hasAttr(el, name) {
  return !!el && !!el.attrs && el.attrs.has(name.toLowerCase());
}

function classes(el) {
  const v = attr(el, 'class');
  return v ? v.split(/\s+/).filter(Boolean) : [];
}

/** Decoded text content; script, style and template content is skipped. */
function text(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text;
  if (node.type === 'element' && TEXT_EXCLUDED.has(node.tag)) return '';
  let out = '';
  for (const child of node.children || []) {
    if (child.type === 'text') out += child.text;
    else if (child.type === 'element') out += text(child);
  }
  return out;
}

/** Raw text inside a script/style element (not decoded). */
function rawText(el) {
  return (el.children || []).filter((c) => c.type === 'text').map((c) => c.raw).join('');
}

function normSpace(s) {
  return String(s || '').replace(/[\s ]+/g, ' ').trim();
}

function rootOf(node) {
  let n = node;
  while (n && n.parent) n = n.parent;
  return n;
}

function lineOf(node) {
  const root = rootOf(node);
  return root && root.lineOf ? root.lineOf(node.start || 0) : 0;
}

/** Short CSS-like description of an element for messages, e.g. a.card__link[href="/x/"] (line 120). */
function describe(el, withLine = true) {
  if (!el || el.type !== 'element') return String(el);
  let s = el.tag;
  const id = attr(el, 'id');
  if (id) s += `#${id}`;
  const cls = classes(el);
  if (cls.length) s += `.${cls.slice(0, 3).join('.')}`;
  for (const name of ['href', 'src', 'name', 'property', 'rel', 'type']) {
    const v = attr(el, name);
    if (v !== null && v !== '') { s += `[${name}="${v.length > 60 ? `${v.slice(0, 57)}...` : v}"]`; break; }
  }
  return withLine ? `${s} (line ${lineOf(el)})` : s;
}

module.exports = {
  parseHtml,
  decodeEntities,
  qsa,
  qs,
  matches,
  closest,
  attr,
  hasAttr,
  classes,
  text,
  rawText,
  normSpace,
  lineOf,
  describe,
  walkElements,
  VOID,
};
