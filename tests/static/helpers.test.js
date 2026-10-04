'use strict';
// Unit tests of the test helpers in tests/lib/ (they do not read APP_DIR). If one of these fails, the other
// test results cannot be trusted.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../lib/html');
const C = require('../lib/checks');
const S = require('../lib/site');

const labels = (s, opts) => C.findForbidden(s, opts).map((h) => h.label);

describe('helpers: forbidden words', () => {
  test('URLs are removed first: https://www.etsy.com/shop/PolinaShvedko is not a "shop" word', () => {
    assert.deepEqual(labels('<a href="https://www.etsy.com/shop/PolinaShvedko">Etsy</a>'), []);
    assert.deepEqual(labels('"sameAs": ["https://www.etsy.com/shop/PolinaShvedko", "https://www.instagram.com/polina_shvedko/"]'), []);
    assert.deepEqual(labels('{"url":"https:\\/\\/www.etsy.com\\/shop\\/PolinaShvedko"}'), [], 'JSON-escaped slashes');
    assert.deepEqual(labels('url(https://cdn.example.com/cart.png)'), []);
  });

  test('shop words outside URLs are found, also in capitals and plurals', () => {
    assert.deepEqual(labels('Visit my shop'), ['shop/shopping']);
    assert.deepEqual(labels('CONTINUE SHOPPING'), ['shop/shopping']);
    assert.deepEqual(labels('<span class="badge">SOLD</span>'), ['sold']);
    assert.deepEqual(labels('Prices on request'), ['price']);
    assert.deepEqual(labels('Add to cart'), ['cart']);
    assert.deepEqual(labels('Buy now'), ['buy']);
    assert.deepEqual(labels('Checkout'), ['checkout']);
    assert.deepEqual(labels('1 200 €'), ['€ (euro sign)']);
    assert.deepEqual(labels('1 200 &euro;'), ['€ (euro sign)']);
    assert.deepEqual(labels('Delivery across the EU. Commissions welcome.'), ['delivery across', 'commissions welcome']);
    assert.deepEqual(labels('{"@type": "Offer", "price": "1200"}'), ['price', 'schema.org Offer']);
  });

  test('words that only contain a forbidden word are not flagged (workshop, cartoon, priceless, bought, sole)', () => {
    assert.deepEqual(labels('A workshop with a cartoon; priceless; she bought a sole'), []);
  });

  test('Tilda references and retired events are found; https URLs with "tilda" are ignored', () => {
    assert.deepEqual(labels('<div class="t706__cartwin">'), ['t706 (Tilda cart)']);
    assert.deepEqual(labels('data-tilda-req="y"'), ['tilda', 'data-tilda']);
    assert.deepEqual(labels('TildaSans-Regular.woff2'), ['tilda']);
    assert.deepEqual(labels('<script src="https://static.tildacdn.com/js/x.js">'), []);
    assert.deepEqual(labels("trackEvent('cart_order')"), ['retired analytics event']);
  });

  test('sales words can be skipped (for font licence files); licence file names are recognised', () => {
    assert.deepEqual(labels('may be sold by itself', { skipSalesWords: true }), []);
    assert.ok(C.LICENSE_FILE_RE.test('css/webfonts/inter/OFL.txt'));
    assert.ok(C.LICENSE_FILE_RE.test('css/webfonts/x/LICENSE'));
    assert.ok(!C.LICENSE_FILE_RE.test('css/site.css'));
  });

  test('hits report line numbers', () => {
    const hits = C.findForbidden('ok\nok\nadd to cart\n');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 3);
  });
});

describe('helpers: Cyrillic, headings, URLs, XML, image sizes', () => {
  test('Cyrillic "х" (U+0445) in sizes is found, Latin x is not', () => {
    const hits = C.findCyrillic('Size 32 х 41cm\nSize 32 x 41cm');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].code, 'U+0445');
    assert.equal(hits[0].line, 1);
    assert.deepEqual(C.findCyrillic('Göttingen — café × 29.7'), []);
  });

  test('heading outline: first heading must be h1, no level skipped going down', () => {
    assert.deepEqual(C.headingProblems([1, 2, 3, 2, 3, 3, 2]), []);
    assert.deepEqual(C.headingProblems([1, 2, 3, 1]), []);
    assert.equal(C.headingProblems([1, 3]).length, 1);
    assert.equal(C.headingProblems([2, 3]).length, 1);
    assert.equal(C.headingProblems([1, 2, 4]).length, 1);
  });

  test('srcset and CSS url() parsing', () => {
    assert.deepEqual(C.parseSrcset('/a-600.webp 600w, /a-1200.webp 1200w,/a-1920.webp 1920w'), ['/a-600.webp', '/a-1200.webp', '/a-1920.webp']);
    assert.deepEqual(C.parseSrcset('/a.jpg'), ['/a.jpg']);
    assert.deepEqual(C.cssUrls('@font-face{src:url("/f.woff2") format("woff2"),url(f.woff)} .a{background:url(\'/b.png\')} .c{background:url(data:image/png;base64,xx)} @import "x.css";'),
      ['/f.woff2', 'f.woff', '/b.png', 'x.css']);
  });

  test('strict XML parser accepts a sitemap and rejects malformed XML', () => {
    const ok = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>https://polina-shvedko.art/a/?x=1&amp;y=2</loc><lastmod>2026-10-03</lastmod></url>\n</urlset>\n';
    const root = C.parseXml(ok);
    assert.equal(root.name, 'urlset');
    const loc = C.xmlChildren(C.xmlChildren(root, 'url')[0], 'loc')[0];
    assert.equal(C.xmlText(loc), 'https://polina-shvedko.art/a/?x=1&y=2');
    assert.throws(() => C.parseXml('<urlset><url></urlset>'), /does not match/);
    assert.throws(() => C.parseXml('<urlset><loc>a & b</loc></urlset>'), /&/);
    assert.throws(() => C.parseXml('<a></a><b></b>'), /root/);
    assert.throws(() => C.parseXml('<urlset><url>'), /not closed/);
    assert.throws(() => C.parseXml('<a x=1></a>'), /quoted/);
  });

  test('ISO date check', () => {
    assert.ok(C.isIsoDate('2026-10-03'));
    assert.ok(!C.isIsoDate('2026-02-30'));
    assert.ok(!C.isIsoDate('03.10.2026'));
  });

  test('image size reader: PNG, GIF, WebP (VP8, VP8L, VP8X) and JPEG with EXIF orientation', () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(0x0d0a1a0a, 4); png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
    assert.deepEqual(C.imageSize(png), { type: 'png', width: 640, height: 480 });

    const gif = Buffer.from('GIF89a\x20\x03\x58\x02\x00\x00', 'latin1');
    assert.deepEqual(C.imageSize(gif), { type: 'gif', width: 800, height: 600 });

    const webp = (chunk, fill) => { const b = Buffer.alloc(40); b.write('RIFF', 0, 'ascii'); b.write('WEBP', 8, 'ascii'); b.write(chunk, 12, 'ascii'); fill(b); return b; };
    assert.deepEqual(C.imageSize(webp('VP8 ', (b) => { b.writeUInt16LE(1200, 26); b.writeUInt16LE(800, 28); })), { type: 'webp', width: 1200, height: 800 });
    assert.deepEqual(C.imageSize(webp('VP8L', (b) => { b.writeUInt32LE((600 - 1) | ((400 - 1) << 14), 21); })), { type: 'webp', width: 600, height: 400 });
    assert.deepEqual(C.imageSize(webp('VP8X', (b) => { b.writeUIntLE(1920 - 1, 24, 3); b.writeUIntLE(1080 - 1, 27, 3); })), { type: 'webp', width: 1920, height: 1080 });

    // JPEG: SOI, APP1 Exif (big endian TIFF, IFD0 with orientation 6), SOF0 4000x3000
    const exif = Buffer.alloc(2 + 2 + 6 + 8 + 2 + 12 + 4);
    let o = 0;
    exif.writeUInt16BE(0xffe1, o); o += 2;
    exif.writeUInt16BE(exif.length - 2, o); o += 2;
    exif.write('Exif\u0000\u0000', o, 'latin1'); o += 6;
    exif.write('MM', o, 'ascii'); exif.writeUInt16BE(42, o + 2); exif.writeUInt32BE(8, o + 4); o += 8;
    exif.writeUInt16BE(1, o); o += 2;
    exif.writeUInt16BE(0x0112, o); exif.writeUInt16BE(3, o + 2); exif.writeUInt32BE(1, o + 4); exif.writeUInt16BE(6, o + 8); o += 12;
    const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xb8, 0x0f, 0xa0, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), exif, sof, Buffer.from([0xff, 0xd9])]);
    assert.deepEqual(C.imageSize(jpeg), { type: 'jpeg', width: 3000, height: 4000, orientation: 6 });
    const plain = Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
    assert.deepEqual(C.imageSize(plain), { type: 'jpeg', width: 4000, height: 3000, orientation: 1 });
    assert.equal(C.imageSize(Buffer.from('not an image at all')), null);
  });

  test('expectNone lists at most 20 offenders and the total', () => {
    const items = Array.from({ length: 25 }, (_, i) => `file-${i}.html`);
    assert.throws(() => C.expectNone(items, 'bad files'), (e) => {
      assert.match(e.message, /bad files \(25\)/);
      assert.match(e.message, /file-19\.html/);
      assert.doesNotMatch(e.message, /file-20\.html/);
      assert.match(e.message, /and 5 more/);
      return true;
    });
    assert.doesNotThrow(() => C.expectNone([], 'nothing'));
  });
});

describe('helpers: HTML parser and selectors', () => {
  const doc = H.parseHtml(`<!DOCTYPE html>
<html lang="en"><head><title>Pastel &amp; ink &mdash; Polina&#39;s &#x2F; work</title>
<script type="application/ld+json">{"a":"<b>"}</script>
<meta name="description" content="A &quot;quoted&quot; text">
</head><body>
<nav id="site-nav" class="site-nav site-nav--visible" aria-label="Site navigation"><ul class="site-nav__links"><li><a href="/about/">About</a><li><a href="/contact/" aria-current="page">Contact</a></ul></nav>
<p>First <a href="mailto:x@y.z?subject=Hi">mail</a> para<p>Second para
<div class="card card--wide"><a class="card__link" href="/oil-paintings/x/"><img src="/a.jpg" alt="A"></a></div>
<picture><source type="image/webp" srcset="/a.webp"><img src="/a.jpg" alt="B" width="10" height="5"></picture>
<noscript><img src="/fallback.jpg" alt="C"></noscript>
<svg><path d="M0 0"/></svg>
<dl><dt>Size</dt><dd>29.7 &times; 42 cm</dd></dl>
</body></html>`);

  test('entities are decoded in text and attributes; script content stays raw', () => {
    assert.equal(H.text(H.qs(doc, 'title')), "Pastel & ink — Polina's / work");
    assert.equal(H.attr(H.qs(doc, 'meta[name="description"]'), 'content'), 'A "quoted" text');
    assert.equal(H.rawText(H.qs(doc, 'script[type="application/ld+json"]')), '{"a":"<b>"}');
    assert.equal(H.normSpace(H.text(H.qs(doc, 'dd'))), '29.7 × 42 cm');
  });

  test('implied end tags (p, li) and void elements build the right tree', () => {
    const ps = H.qsa(doc, 'p');
    assert.equal(ps.length, 2);
    assert.equal(H.normSpace(H.text(ps[0])), 'First mail para');
    assert.equal(H.qsa(doc, 'ul.site-nav__links > li').length, 2);
    assert.equal(H.qsa(doc, 'div.card > a.card__link > img').length, 1, 'p is closed by div');
    assert.equal(H.qsa(doc, 'noscript img').length, 1, 'noscript content is parsed as markup');
  });

  test('selectors: attribute operators, :not(), child and descendant combinators, groups', () => {
    assert.equal(H.qsa(doc, 'a[href^="mailto:"]').length, 1);
    assert.equal(H.qsa(doc, 'a[href$="/x/"]').length, 1);
    assert.equal(H.qsa(doc, 'a[href*="paintings"]').length, 1);
    assert.equal(H.qsa(doc, '[class~="card--wide"]').length, 1);
    assert.equal(H.qsa(doc, 'nav#site-nav a[aria-current="page"]').length, 1);
    assert.equal(H.qsa(doc, 'nav a:not([aria-current])').length, 1);
    assert.equal(H.qsa(doc, 'picture > source[type="image/webp"]').length, 1);
    assert.equal(H.qsa(doc, 'body > picture').length, 1);
    assert.equal(H.qsa(doc, 'h1, title, dt').length, 2);
    assert.equal(H.qs(doc, '.missing'), null);
    const link = H.qs(doc, 'a.card__link');
    assert.equal(H.closest(link, '.card').tag, 'div');
    assert.ok(H.matches(link, 'div.card--wide a'));
    assert.match(H.describe(link), /^a\.card__link\[href="\/oil-paintings\/x\/"\] \(line \d+\)$/);
  });

  test('broken markup does not throw', () => {
    const bad = H.parseHtml('<div><p>unclosed <b>bold <a href=x>link</div></span><<< </p> <img src="a" alt=">" <!-- open');
    assert.ok(H.qsa(bad, 'div').length >= 1);
  });
});

describe('helpers: breaking spaces in visible text', () => {
  test('a plain space or line break inside a size or after an initial is found in visible text only; U+00A0 and &nbsp; pass', () => {
    const doc = H.parseHtml('<body><p>190&nbsp;×\n45&nbsp;cm by P.&nbsp;Molina</p><p>50&nbsp;&times;&nbsp;40&nbsp;cm, St.\u00a0Albani, a 4:1 ratio</p>'
      + '<script>var size = "50 × 40 cm";</script><noscript><p>5 cm</p></noscript><p title="P. Molina">ok</p></body>');
    const found = H.breakingSpaceProblems(H.qs(doc, 'body'));
    assert.equal(found.length, 1, found.join('\n'));
    assert.match(found[0], /^p: "×\\n4" has a breaking space/, 'the line break after the sign');
    for (const t of ['29.7 cm', 'Dr. Who', 'Mrs. Brown', '50 × 40', '× 2']) assert.ok(C.BREAKING_SPACE_RE.test(t), t);
    for (const t of ['29.7\u00a0cm', 'St.\u00a0Albani', 'EU.', 'cm 5', 'the 5th']) assert.ok(!C.BREAKING_SPACE_RE.test(t), t);
  });
});

describe('helpers: site model from data.json', () => {
  test('page list: home, hubs, every artwork, about, contact (36 indexable while legal texts are null) and 404', () => {
    const data = S.loadData();
    const pages = S.sitePages(data);
    const artworks = data.hubs.reduce((n, h) => n + h.artworks.length, 0);
    const legal = (data.legal.imprint_html ? 1 : 0) + (data.legal.privacy_html ? 1 : 0);
    assert.equal(pages.filter((p) => p.indexable).length, 1 + data.hubs.length + artworks + 2 + legal);
    const cap = pages.find((p) => p.key === 'artwork:affectionate-farewell-cap-dantibes');
    assert.equal(cap.file, 'oil-paintings/affectionate-farewell-cap-dantibes/index.html');
    assert.equal(cap.url, 'https://polina-shvedko.art/oil-paintings/affectionate-farewell-cap-dantibes/');
    assert.equal(cap.prev, null);
    assert.equal(cap.next.slug, data.hubs[0].artworks[1].slug);
    assert.equal(pages.find((p) => p.type === '404').indexable, false);
  });

  test('URL resolution: relative, root-relative, absolute same-site, query, fragment, external', () => {
    assert.deepEqual(S.resolveLocal('/css/site.css?v=1234abcd', '/oil-paintings/x/').file, 'css/site.css');
    assert.equal(S.resolveLocal('img/a.jpg', '/oil-paintings/x/').file, 'oil-paintings/x/img/a.jpg');
    assert.equal(S.resolveLocal('https://polina-shvedko.art/about/#me', '/').file, 'about/index.html');
    assert.equal(S.resolveLocal('https://polina-shvedko.art/about/#me', '/').hash, 'me');
    assert.equal(S.resolveLocal('#gallery-oil', '/').file, 'index.html');
    assert.equal(S.resolveLocal('/img/IMG%202993.jpg', '/').file, 'img/IMG 2993.jpg');
    assert.ok(S.resolveLocal('https://www.etsy.com/shop/PolinaShvedko', '/').external);
    assert.ok(S.resolveLocal('mailto:a@b.c', '/').external);
    assert.equal(S.urlPathForFile('oil-paintings/index.html'), '/oil-paintings/');
    assert.equal(S.urlPathForFile('index.html'), '/');
    assert.equal(S.urlPathForFile('404.html'), '/404.html');
  });

  test('expected artwork <title> follows the SPEC section 6 rule and fits 60 characters', () => {
    const hub = { medium_label: 'Pastel' };
    assert.equal(S.expectedArtworkTitle(hub, { title: 'Fishing Village', year: 2023 }), 'Fishing Village — Pastel, 2023 | Polina Shvedko');
    assert.equal(S.expectedArtworkTitle({ medium_label: 'Oil painting' }, { title: 'Turquoise Silence of the Verdon Gorge', year: 2023 }), 'Turquoise Silence of the Verdon Gorge | Polina Shvedko');
    assert.equal(S.expectedArtworkTitle(hub, { title: 'X', year: 2020, seo_title: 'Custom | Polina Shvedko' }), 'Custom | Polina Shvedko');
    for (const { hub: h, artwork } of S.allArtworks()) {
      const tt = S.expectedArtworkTitle(h, artwork);
      if (tt !== null) assert.ok(C.cpLen(tt) <= 60, `${tt} is longer than 60`);
    }
    assert.equal(S.sizeText({ width_cm: 29.7, height_cm: 42 }), '29.7 × 42 cm');
  });
});
