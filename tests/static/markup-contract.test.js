'use strict';
// SPEC sections 1, 7 and 8: page content and the markup contract (class names, IDs, data attributes) that
// the JavaScript and the browser tests rely on. Exact texts come from data.json and SPEC section 1.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { qsa, qs, attr, hasAttr, classes, text, rawText, normSpace, closest, describe: desc } = require('../lib/html');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');

const data = S.loadData();
const site = data.site || {};
const pages = S.sitePages(data);
const hubs = data.hubs || [];
const hubPaths = hubs.map((h) => `/${h.path}/`);
const NAV_TARGETS = [...hubPaths, '/about/', '/contact/'];
const MAIL_LOCATIONS = ['hero', 'intro', 'artwork', 'contact', 'footer'];
const STATUS_TEXT = { available: 'Available — ask about this work', 'private-collection': 'In a private collection' };
const CTA = {
  available: { subject: 'Inquiry: ', label: 'Ask about this work' },
  'private-collection': { subject: 'Question about: ', label: 'Contact the artist' },
};
const year = String(site.lastmod || '').slice(0, 4);

const t = (el) => normSpace(text(el));
const linkPath = (el, from) => {
  const r = S.resolveLocal(attr(el, 'href'), from, data);
  return r.path ? r.path + (r.hash ? `#${r.hash}` : '') : null;
};

function forPages(list, fn) {
  const problems = [];
  const missing = [];
  for (const page of list) {
    const loaded = S.loadAppHtml(page.file);
    if (!loaded) { missing.push(page.file); continue; }
    for (const p of fn(page, loaded.doc) || []) problems.push(`${page.file}: ${p}`);
  }
  if (missing.length) problems.unshift(`${missing.length} of ${list.length} expected page(s) do not exist, e.g. ${missing.slice(0, 3).join(', ')} (see "1. pages exist")`);
  return problems;
}

function scriptSrcs(doc) {
  return qsa(doc, 'script[src]').map((s) => ({ el: s, src: attr(s, 'src'), path: (attr(s, 'src') || '').split('?')[0] }));
}

/** Check one card element against its artwork. */
function cardProblems(card, hub, artwork) {
  const out = [];
  const where = `card "${artwork.title}"`;
  const links = qsa(card, 'a');
  if (links.length !== 1) out.push(`${where}: ${links.length} links inside the card (exactly one a.card__link)`);
  const link = qs(card, 'a.card__link');
  if (!link) out.push(`${where}: no a.card__link`);
  else if (linkPath(link, '/') !== S.artworkPath(hub, artwork)) out.push(`${where}: link goes to ${attr(link, 'href')}, expected ${S.artworkPath(hub, artwork)}`);
  const media = qs(card, '.card__media');
  if (!media) out.push(`${where}: no .card__media`);
  else {
    const pics = qsa(media, 'picture');
    const isImg = (p, cls) => classes(p).includes(cls) || !!qs(p, `img.${cls}`);
    if (pics.length !== 2 || !pics.some((p) => isImg(p, 'card__img')) || !pics.some((p) => isImg(p, 'card__img--hover'))) {
      out.push(`${where}: .card__media needs two <picture>s, .card__img and .card__img--hover (found ${pics.length})`);
    }
  }
  const wide = classes(card).includes('card--wide');
  if (wide !== (artwork.card === 'wide')) out.push(`${where}: card--wide is ${wide ? 'set' : 'missing'} but data card is "${artwork.card}"`);
  const badge = qs(card, '.card__badge');
  if (artwork.status === 'private-collection') {
    if (!badge || t(badge).toLowerCase() !== 'private collection') out.push(`${where}: needs .card__badge "Private collection" (found ${badge ? `"${t(badge)}"` : 'none'})`);
  } else if (badge) out.push(`${where}: available works have no badge (found "${t(badge)}")`);
  const title = qs(card, '.card__title');
  if (!title || !['h2', 'h3'].includes(title.tag)) out.push(`${where}: needs an h3.card__title (h2 on hub pages)`);
  else if (t(title) !== artwork.title) out.push(`${where}: .card__title is "${t(title)}"`);
  const more = qs(card, 'span.card__more');
  if (!more || t(more).toUpperCase() !== 'MORE') out.push(`${where}: needs span.card__more with the text MORE`);
  return out;
}

/** Cards in a container must be exactly the hub's artworks, in data.json order. */
function gridProblems(container, hub) {
  const out = [];
  const cards = qsa(container, 'article.card');
  const got = cards.map((c) => linkPath(qs(c, 'a.card__link') || c, '/'));
  const want = hub.artworks.map((a) => S.artworkPath(hub, a));
  if (got.join('|') !== want.join('|')) {
    out.push(`cards for ${hub.path} are [${got.slice(0, 4).join(', ')}${got.length > 4 ? ', ...' : ''}] (${got.length}), expected all ${want.length} artworks in data.json order`);
  }
  cards.forEach((card, i) => { if (hub.artworks[i]) out.push(...cardProblems(card, hub, hub.artworks[i])); });
  return out;
}

function breadcrumbProblems(doc, trail) {
  const nav = qs(doc, 'nav.breadcrumb');
  if (!nav) return ['no nav.breadcrumb'];
  const out = [];
  if (attr(nav, 'aria-label') !== 'Breadcrumb') out.push('nav.breadcrumb needs aria-label="Breadcrumb"');
  const links = qsa(nav, 'a').map((a) => linkPath(a, '/'));
  for (const [label, href] of trail) {
    if (href && !links.includes(href)) out.push(`breadcrumb has no link to ${href}`);
    if (label && !t(nav).includes(label)) out.push(`breadcrumb text lacks "${label}"`);
  }
  return out;
}

describe('markup contract: every page (SPEC 1, 7, 8)', () => {
  test('nav#site-nav.site-nav[aria-label="Site navigation"] with .site-nav__logo -> / and .site-nav__links -> hubs, /about/, /contact/', () => {
    expectNone(forPages(pages, (page, doc) => {
      const out = [];
      const navs = qsa(doc, '#site-nav');
      if (navs.length !== 1) return [`${navs.length} #site-nav elements`];
      const nav = navs[0];
      if (nav.tag !== 'nav' || !classes(nav).includes('site-nav')) out.push('#site-nav must be <nav class="site-nav">');
      if (attr(nav, 'aria-label') !== 'Site navigation') out.push('#site-nav needs aria-label="Site navigation"');
      const logo = qs(nav, '.site-nav__logo');
      if (!logo || logo.tag !== 'a' || linkPath(logo, page.path) !== '/') out.push('.site-nav__logo must be a link to /');
      const list = qs(nav, '.site-nav__links');
      const targets = list ? qsa(list, 'a').map((a) => linkPath(a, page.path)) : [];
      for (const want of NAV_TARGETS) if (!targets.includes(want)) out.push(`.site-nav__links has no link to ${want}`);
      const cls = classes(nav);
      if (page.type === 'home') {
        if (!cls.includes('site-nav--hidden') || cls.includes('site-nav--visible')) out.push('home: nav must start with class site-nav--hidden (nav.js shows it after the hero)');
      } else if (!cls.includes('site-nav--visible')) out.push('nav needs class site-nav--visible on pages other than home');
      return out;
    }), 'site navigation problems');
  });

  test('the nav link of the current page has aria-current="page" (hubs, about, contact) and no other nav link has it', () => {
    expectNone(forPages(pages, (page, doc) => {
      const nav = qs(doc, '#site-nav');
      if (!nav) return ['no #site-nav'];
      const out = [];
      const current = qsa(nav, 'a[aria-current="page"]').map((a) => linkPath(a, page.path));
      const own = NAV_TARGETS.includes(page.path) ? page.path : null;
      if (own && !current.includes(own)) out.push(`nav link to ${own} needs aria-current="page"`);
      for (const c of current) if (c !== page.path && !(page.type === 'home' && c === '/')) out.push(`nav link to ${c} has aria-current="page" but this page is ${page.path}`);
      return out;
    }), 'aria-current problems');
  });

  test('consent banner div#cookie-consent[role=region][aria-label="Cookie consent"][hidden] with #cookie-accept, #cookie-decline; footer button#cookie-settings', () => {
    expectNone(forPages(pages, (page, doc) => {
      const out = [];
      const banners = qsa(doc, '#cookie-consent');
      if (banners.length !== 1) return [`${banners.length} #cookie-consent elements`];
      const b = banners[0];
      if (attr(b, 'role') !== 'region' && b.tag !== 'section') out.push('#cookie-consent needs role="region"');
      if (attr(b, 'aria-label') !== 'Cookie consent') out.push('#cookie-consent needs aria-label="Cookie consent"');
      if (!hasAttr(b, 'hidden')) out.push('#cookie-consent must be hidden in the HTML (consent.js shows it)');
      if (/continuing to browse/i.test(t(b))) out.push('banner text "By continuing to browse" is not valid consent');
      for (const id of ['cookie-accept', 'cookie-decline']) {
        const btn = qs(b, `#${id}`);
        if (!btn || btn.tag !== 'button' || attr(btn, 'type') !== 'button') out.push(`#cookie-consent needs <button type="button" id="${id}">`);
      }
      const settings = qs(doc, 'footer #cookie-settings');
      if (!settings || settings.tag !== 'button') out.push('footer needs <button id="cookie-settings">');
      return out;
    }), 'consent banner problems');
  });

  test('scripts: consent.js (defer, data-ga-id), analytics.js and nav.js on every page; hero.js only on home; artwork.js only on artwork pages; all deferred; no third-party script, style, preload or preconnect', () => {
    expectNone(forPages(pages, (page, doc) => {
      const out = [];
      const scripts = scriptSrcs(doc);
      const has = (p) => scripts.find((s) => s.path === p);
      for (const p of ['/js/consent.js', '/js/analytics.js', '/js/nav.js']) if (!has(p)) out.push(`no <script src="${p}?v=...">`);
      const consent = has('/js/consent.js');
      if (consent && attr(consent.el, 'data-ga-id') !== site.ga_measurement_id) out.push(`consent.js script tag needs data-ga-id="${site.ga_measurement_id}"`);
      if (page.type === 'home' && !has('/js/hero.js')) out.push('home needs /js/hero.js');
      if (page.type !== 'home' && has('/js/hero.js')) out.push('hero.js is only for the home page');
      if (page.type === 'artwork' && !has('/js/artwork.js')) out.push('artwork pages need /js/artwork.js');
      if (page.type !== 'artwork' && has('/js/artwork.js')) out.push('artwork.js is only for artwork pages');
      for (const s of scripts) {
        if (!hasAttr(s.el, 'defer') && attr(s.el, 'type') !== 'module') out.push(`${desc(s.el)} is not deferred`);
        if (/^https?:|^\/\//.test(s.src)) out.push(`${desc(s.el)} loads a third-party script`);
      }
      for (const l of qsa(doc, 'link[href]')) {
        const rel = (attr(l, 'rel') || '').toLowerCase();
        if (!/\b(preconnect|dns-prefetch|preload|prefetch|modulepreload|prerender|stylesheet)\b/.test(rel)) continue;
        const r = S.resolveLocal(attr(l, 'href'), page.path, data);
        if (r.external && r.host) out.push(`${desc(l)} contacts ${r.host} before consent`);
      }
      return out;
    }), 'script problems');
  });

  test('styles and fonts: /css/site.css linked, a WOFF2 font preloaded with crossorigin, CSS/JS URLs carry ?v=<8 hex> (same file, same hash)', () => {
    const hashes = new Map();
    const problems = forPages(pages, (page, doc) => {
      const out = [];
      const sheets = qsa(doc, 'link[rel~="stylesheet"]');
      if (!sheets.some((l) => (attr(l, 'href') || '').split('?')[0] === '/css/site.css')) out.push('no <link rel="stylesheet" href="/css/site.css?v=...">');
      const fonts = qsa(doc, 'link[rel~="preload"][as="font"]');
      if (!fonts.length) out.push('no font preload <link rel="preload" as="font" type="font/woff2" crossorigin>');
      for (const f of fonts) {
        if (!/\.woff2$/i.test((attr(f, 'href') || '').split('?')[0]) || attr(f, 'type') !== 'font/woff2') out.push(`${desc(f)} must preload a font/woff2 file`);
        if (!hasAttr(f, 'crossorigin')) out.push(`${desc(f)} needs crossorigin (otherwise the preload is not used)`);
      }
      const assets = [...sheets.map((l) => attr(l, 'href')), ...scriptSrcs(doc).map((s) => s.src)].filter((u) => u && !/^https?:|^\/\//.test(u));
      for (const u of assets) {
        const [p, q = ''] = u.split('?');
        const m = /^v=([0-9a-f]{8})$/.exec(q);
        if (!p.startsWith('/')) out.push(`${u} is not root-relative`);
        if (!m) { out.push(`${u} has no ?v=<8 hex> content hash`); continue; }
        if (hashes.has(p) && hashes.get(p).hash !== m[1]) out.push(`${p} has ?v=${m[1]} here but ?v=${hashes.get(p).hash} in ${hashes.get(p).file}`);
        else hashes.set(p, { hash: m[1], file: page.file });
      }
      return out;
    });
    expectNone(problems, 'style/font/hash problems');
  });

  test(`footer: "© ${year} POLINA SHVEDKO", links to hubs, /about/, /contact/; no imprint/privacy links while legal texts are null`, () => {
    const legal = data.legal || {};
    expectNone(forPages(pages, (page, doc) => {
      const out = [];
      const footer = qsa(doc, 'footer').pop();
      if (!footer) return ['no <footer>'];
      if (!new RegExp(`©\\s*${year}\\s+polina shvedko`, 'i').test(t(footer))) out.push(`footer text lacks "© ${year} POLINA SHVEDKO" (year from site.lastmod)`);
      const links = qsa(footer, 'a').map((a) => linkPath(a, page.path));
      for (const want of NAV_TARGETS) if (!links.includes(want)) out.push(`footer has no link to ${want}`);
      const all = qsa(doc, 'a[href]').map((a) => linkPath(a, page.path));
      if (!legal.imprint_html && all.includes('/imprint/')) out.push('links to /imprint/ although legal.imprint_html is null');
      if (!legal.privacy_html && all.includes('/privacy/')) out.push('links to /privacy/ although legal.privacy_html is null');
      return out;
    }), 'footer problems');
  });

  test(`every mailto: link goes to ${site.email} and carries data-track="contact" and data-location (${MAIL_LOCATIONS.join('|')})`, () => {
    expectNone(forPages(pages, (page, doc) => {
      const out = [];
      for (const a of qsa(doc, 'a[href^="mailto:"]')) {
        const href = attr(a, 'href');
        const address = decodeURIComponent(href.slice(7).split('?')[0]);
        if (address !== site.email) out.push(`${desc(a)} mails ${address}, expected ${site.email}`);
        if (attr(a, 'data-track') !== 'contact') out.push(`${desc(a)} needs data-track="contact"`);
        if (!MAIL_LOCATIONS.includes(attr(a, 'data-location'))) out.push(`${desc(a)} has data-location=${JSON.stringify(attr(a, 'data-location'))}`);
      }
      return out;
    }), 'mailto link problems');
  });
});

describe('markup contract: home page', () => {
  const home = pages.filter((p) => p.type === 'home');

  test('hero: header.hero#top, h1.hero__title "Polina Shvedko Art" + span.hero__tagline, a.hero__email, a.hero__cta -> #gallery-oil, poster <picture> and button.hero__play, no iframe', () => {
    expectNone(forPages(home, (page, doc) => {
      const out = [];
      const hero = qs(doc, 'header.hero');
      if (!hero || attr(hero, 'id') !== 'top') return ['no <header class="hero" id="top">'];
      const h1 = qs(hero, 'h1.hero__title');
      if (!h1) out.push('no h1.hero__title in the hero');
      else {
        if (!t(h1).startsWith('Polina Shvedko Art')) out.push(`h1 text is "${t(h1)}", expected "Polina Shvedko Art" + tagline`);
        const tag = qs(h1, 'span.hero__tagline');
        if (!tag || t(tag) !== 'Oil paintings, pastels & watercolours') out.push(`span.hero__tagline inside the h1 must read "Oil paintings, pastels & watercolours" (found ${tag ? `"${t(tag)}"` : 'none'})`);
      }
      const email = qs(hero, 'a.hero__email');
      if (!email || attr(email, 'data-location') !== 'hero' || !String(attr(email, 'href')).startsWith(`mailto:${site.email}`)) out.push('a.hero__email must be a mailto link with data-location="hero"');
      const cta = qs(hero, 'a.hero__cta');
      if (!cta || attr(cta, 'href') !== '#gallery-oil') out.push('a.hero__cta must link to #gallery-oil');
      else if (t(cta).toLowerCase() !== 'explore artworks') out.push(`a.hero__cta text is "${t(cta)}", expected "Explore Artworks"`);
      const media = qs(hero, '.hero__media');
      if (!media || !qs(media, 'picture')) out.push('.hero__media with the poster <picture> missing');
      const play = media && qs(media, 'button.hero__play');
      if (!play) out.push('button.hero__play missing in .hero__media');
      else {
        if (attr(play, 'data-youtube-id') !== site.youtube_id) out.push(`button.hero__play needs data-youtube-id="${site.youtube_id}"`);
        if (attr(play, 'type') !== 'button') out.push('button.hero__play needs type="button"');
        if (!(attr(play, 'aria-label') || '').trim() && !t(play)) out.push('button.hero__play needs an accessible name (aria-label)');
      }
      if (qsa(doc, 'iframe').length) out.push('the home page HTML must not contain an iframe (YouTube loads only after the click)');
      if (qs(doc, 'video')) out.push('no <video> background (the hero is a poster + YouTube facade)');
      return out;
    }), 'hero problems');
  });

  test('gallery sections section.gallery#gallery-<key> > h2.gallery__heading, .gallery__grid with all cards in data order, a.gallery__all -> hub', () => {
    expectNone(forPages(home, (page, doc) => {
      const out = [];
      for (const hub of hubs) {
        const sec = qs(doc, `#gallery-${hub.key}`);
        if (!sec || sec.tag !== 'section' || !classes(sec).includes('gallery')) { out.push(`no <section class="gallery" id="gallery-${hub.key}">`); continue; }
        const h2 = qs(sec, 'h2.gallery__heading');
        if (!h2 || t(h2) !== hub.section_heading) out.push(`#gallery-${hub.key}: h2.gallery__heading should read "${hub.section_heading}" (found ${h2 ? `"${t(h2)}"` : 'none'})`);
        const grid = qs(sec, '.gallery__grid');
        if (!grid) out.push(`#gallery-${hub.key}: no .gallery__grid`);
        else out.push(...gridProblems(grid, hub).map((p) => `#gallery-${hub.key}: ${p}`));
        const all = qs(sec, 'a.gallery__all');
        if (!all || linkPath(all, '/') !== `/${hub.path}/` || t(all) !== hub.all_link) out.push(`#gallery-${hub.key}: needs a.gallery__all "${hub.all_link}" -> /${hub.path}/`);
      }
      return out;
    }), 'home gallery problems');
  });

  test('home: intro has a "More about me" link to /about/; no gallery filter', () => {
    expectNone(forPages(home, (page, doc) => {
      const out = [];
      const more = qsa(doc, 'a').filter((a) => linkPath(a, '/') === '/about/' && /more about me/i.test(t(a)) && !closest(a, '#site-nav') && !closest(a, 'footer'));
      if (!more.length) out.push('no "More about me" link to /about/ in the page content');
      const filter = qsa(doc, '*').filter((el) => classes(el).some((c) => c.startsWith('gallery-filter')) || attr(el, 'data-filter') !== null);
      if (filter.length) out.push(`gallery filter markup is still present: ${desc(filter[0])}`);
      return out;
    }), 'home content problems');
  });
});

describe('markup contract: hub pages', () => {
  test('hub: breadcrumb Home > label, h1 from data.json, intro paragraphs, all cards of the hub in data order', () => {
    expectNone(forPages(pages.filter((p) => p.type === 'hub'), (page, doc) => {
      const out = [...breadcrumbProblems(doc, [['Home', '/'], [page.hub.label, null]])];
      const h1 = qs(doc, 'h1');
      if (!h1 || t(h1) !== page.hub.h1) out.push(`h1 is ${h1 ? `"${t(h1)}"` : 'missing'}, expected "${page.hub.h1}"`);
      const paragraphs = qsa(doc, 'p').map(t);
      (page.hub.intro || []).forEach((para, i) => {
        if (!paragraphs.includes(normSpace(para))) out.push(`intro paragraph ${i + 1} is not on the page as a <p>: "${para.slice(0, 50)}..."`);
      });
      const main = qs(doc, 'main') || doc;
      out.push(...gridProblems(main, page.hub));
      return out;
    }), 'hub page problems');
  });
});

describe('markup contract: artwork pages', () => {
  const artworkPages = pages.filter((p) => p.type === 'artwork');

  test('artwork: main.artwork, breadcrumb Home > hub > title, gallery with one <picture> per image (+ thumbnails and prev/next buttons when more than one)', () => {
    expectNone(forPages(artworkPages, (page, doc) => {
      const a = page.artwork;
      const out = [];
      const main = qs(doc, 'main.artwork');
      if (!main) return ['no main.artwork'];
      out.push(...breadcrumbProblems(main, [['Home', '/'], [page.hub.label, `/${page.hub.path}/`], [a.title, null]]));
      const gallery = qs(main, '.artwork__gallery');
      const mainBox = gallery && qs(gallery, '.artwork__main');
      if (!mainBox) return [...out, 'no .artwork__gallery > .artwork__main'];
      const pics = qsa(mainBox, 'picture');
      if (pics.length !== a.images.length) out.push(`.artwork__main has ${pics.length} <picture>s, data has ${a.images.length} images`);
      const imgs = pics.map((p) => qs(p, 'img'));
      a.images.forEach((im, i) => {
        if (imgs[i] && attr(imgs[i], 'alt') !== im.alt) out.push(`image ${i + 1} alt is ${JSON.stringify(attr(imgs[i], 'alt'))}, expected ${JSON.stringify(im.alt)}`);
      });
      if (imgs[0] && attr(imgs[0], 'loading') === 'lazy') out.push('the first (main) image must not be lazy-loaded');
      imgs.slice(1).forEach((img, i) => { if (img && attr(img, 'loading') !== 'lazy') out.push(`image ${i + 2} needs loading="lazy"`); });
      const thumbs = qsa(gallery, 'button.artwork__thumb');
      if (a.images.length > 1) {
        if (thumbs.length !== a.images.length) out.push(`${thumbs.length} button.artwork__thumb, expected ${a.images.length}`);
        thumbs.forEach((b, i) => {
          if (attr(b, 'data-index') !== String(i)) out.push(`thumbnail ${i + 1} needs data-index="${i}"`);
          if (attr(b, 'type') !== 'button') out.push(`thumbnail ${i + 1} needs type="button"`);
        });
        if (thumbs[0] && attr(thumbs[0], 'aria-current') !== 'true') out.push('the first thumbnail needs aria-current="true"');
        if (!qs(gallery, 'button.artwork__prev') || !qs(gallery, 'button.artwork__next')) out.push('button.artwork__prev and button.artwork__next missing');
      } else if (thumbs.length) out.push('a single image needs no thumbnails');
      return out;
    }), 'artwork gallery markup problems');
  });

  test('artwork info: h1.artwork__title, dl.artwork__facts (Medium, Size "<w> × <h> cm", Frame when set, Year), p.artwork__status, description paragraphs', () => {
    expectNone(forPages(artworkPages, (page, doc) => {
      const a = page.artwork;
      const out = [];
      const info = qs(doc, '.artwork__info');
      if (!info) return ['no .artwork__info'];
      const h1 = qs(info, 'h1.artwork__title');
      if (!h1 || t(h1) !== a.title) out.push(`h1.artwork__title is ${h1 ? `"${t(h1)}"` : 'missing'}, expected "${a.title}"`);
      const dl = qs(info, 'dl.artwork__facts');
      if (!dl) out.push('no dl.artwork__facts');
      else {
        const facts = new Map();
        let label = null;
        for (const el of qsa(dl, 'dt, dd')) {
          if (el.tag === 'dt') label = t(el).replace(/:$/, '').toLowerCase();
          else if (label) { facts.set(label, t(el)); label = null; }
        }
        const want = [['medium', a.medium], ['size', S.sizeText(a)], ['year', String(a.year)]];
        if (a.frame) want.push(['frame', a.frame]);
        for (const [k, v] of want) if (facts.get(k) !== v) out.push(`facts ${k}: ${facts.has(k) ? `"${facts.get(k)}"` : 'missing'}, expected "${v}"`);
        if (!a.frame && facts.has('frame')) out.push('facts show a Frame although data frame is null');
      }
      const status = qs(info, 'p.artwork__status');
      if (!status || t(status) !== STATUS_TEXT[a.status]) out.push(`p.artwork__status is ${status ? `"${t(status)}"` : 'missing'}, expected "${STATUS_TEXT[a.status]}"`);
      const descBox = qs(info, '.artwork__description');
      if (!descBox) out.push('no .artwork__description');
      else {
        const paras = qsa(descBox, 'p').map(t);
        a.description.forEach((d, i) => { if (!paras.includes(normSpace(d))) out.push(`description paragraph ${i + 1} missing as <p>: "${d.slice(0, 50)}"`); });
      }
      return out;
    }), 'artwork info problems');
  });

  test('artwork CTA: a.artwork__cta mailto with subject "Inquiry: <title>" / "Question about: <title>", label, data-track, data-location=artwork, data-artwork-slug', () => {
    expectNone(forPages(artworkPages, (page, doc) => {
      const a = page.artwork;
      const want = CTA[a.status];
      const ctas = qsa(doc, 'a.artwork__cta');
      if (ctas.length !== 1) return [`${ctas.length} a.artwork__cta (expected 1)`];
      const cta = ctas[0];
      const out = [];
      const href = attr(cta, 'href') || '';
      if (!href.startsWith(`mailto:${site.email}?`)) out.push(`href "${href}" must be mailto:${site.email}?subject=...`);
      else {
        let subject = null;
        try { subject = decodeURIComponent((href.split('?')[1].split('&').find((x) => x.startsWith('subject=')) || '').slice(8)); } catch { subject = null; }
        if (subject !== `${want.subject}${a.title}`) out.push(`subject is ${JSON.stringify(subject)}, expected "${want.subject}${a.title}"`);
      }
      if (t(cta) !== want.label) out.push(`label is "${t(cta)}", expected "${want.label}"`);
      if (attr(cta, 'data-track') !== 'contact') out.push('needs data-track="contact"');
      if (attr(cta, 'data-location') !== 'artwork') out.push('needs data-location="artwork"');
      if (attr(cta, 'data-artwork-slug') !== a.slug) out.push(`needs data-artwork-slug="${a.slug}"`);
      return out;
    }), 'artwork CTA problems');
  });

  test('artwork: nav.artwork__pager holds the rel=prev/next links, a.artwork__back -> hub; Story section only when story_confirmed', () => {
    expectNone(forPages(artworkPages, (page, doc) => {
      const a = page.artwork;
      const out = [];
      const pager = qs(doc, 'nav.artwork__pager');
      if (!pager) out.push('no nav.artwork__pager');
      else {
        if (!(attr(pager, 'aria-label') || '').trim()) out.push('nav.artwork__pager needs an aria-label (unique landmark name)');
        if (page.prev && !qs(pager, 'a[rel~="prev"]')) out.push('pager has no a[rel=prev]');
        if (page.next && !qs(pager, 'a[rel~="next"]')) out.push('pager has no a[rel=next]');
      }
      const back = qs(doc, 'a.artwork__back');
      if (!back || linkPath(back, page.path) !== `/${page.hub.path}/`) out.push(`a.artwork__back must link to /${page.hub.path}/`);
      const storyHeading = qsa(doc, 'h2, h3').find((h) => /^story$/i.test(t(h)));
      const storyText = a.story_html ? normSpace(a.story_html.replace(/<[^>]+>/g, ' ')).slice(0, 60) : null;
      const pageText = t(qs(doc, 'body') || doc);
      if (a.story_confirmed) {
        if (!storyHeading) out.push('story_confirmed is true but there is no "Story" heading');
        if (storyText && !pageText.includes(storyText.slice(0, 40))) out.push('story_confirmed is true but the story text is missing');
      } else {
        if (storyHeading) out.push('a "Story" section is shown although story_confirmed is false');
        if (storyText && pageText.includes(storyText.slice(0, 40))) out.push('the unconfirmed story text is on the page');
      }
      return out;
    }), 'artwork navigation/story problems');
  });
});

describe('markup contract: about, contact and 404', () => {
  test('about: breadcrumb, h1 "About Polina Shvedko", link to /contact/', () => {
    expectNone(forPages(pages.filter((p) => p.type === 'about'), (page, doc) => {
      const out = [...breadcrumbProblems(doc, [['Home', '/']])];
      const h1 = qs(doc, 'h1');
      if (!h1 || t(h1) !== 'About Polina Shvedko') out.push(`h1 is ${h1 ? `"${t(h1)}"` : 'missing'}, expected "About Polina Shvedko"`);
      const main = qs(doc, 'main');
      if (!main || !qsa(main, 'a').some((a) => linkPath(a, page.path) === '/contact/')) out.push('no link to /contact/ in <main>');
      return out;
    }), 'about page problems');
  });

  test('contact: breadcrumb, h1 "Contact", mailto link (data-location=contact), links to Instagram, Facebook, LinkedIn and Etsy', () => {
    const social = (site.social || []).map((s) => s.url);
    expectNone(forPages(pages.filter((p) => p.type === 'contact'), (page, doc) => {
      const out = [...breadcrumbProblems(doc, [['Home', '/']])];
      const h1 = qs(doc, 'h1');
      if (!h1 || t(h1) !== 'Contact') out.push(`h1 is ${h1 ? `"${t(h1)}"` : 'missing'}, expected "Contact"`);
      if (!qsa(doc, 'a[href^="mailto:"]').some((a) => attr(a, 'data-location') === 'contact')) out.push('no mailto link with data-location="contact"');
      const hrefs = qsa(doc, 'a[href]').map((a) => attr(a, 'href'));
      for (const url of social) if (!hrefs.includes(url)) out.push(`no link to ${url}`);
      return out;
    }), 'contact page problems');
  });

  test('404: h1 "Page not found", links to / and to every hub', () => {
    expectNone(forPages(pages.filter((p) => p.type === '404'), (page, doc) => {
      const out = [];
      const h1 = qs(doc, 'h1');
      if (!h1 || t(h1) !== 'Page not found') out.push(`h1 is ${h1 ? `"${t(h1)}"` : 'missing'}, expected "Page not found"`);
      const main = qs(doc, 'main') || doc;
      const links = qsa(main, 'a').map((a) => linkPath(a, '/'));
      for (const want of ['/', ...hubPaths]) if (!links.includes(want)) out.push(`no link to ${want} in the page content`);
      return out;
    }), '404 page problems');
  });
});

test('markup contract helper sanity: data.json provides the texts the contract needs', () => {
  assert.ok(site.email && site.youtube_id && site.ga_measurement_id && year.length === 4, 'site.email, site.youtube_id, site.ga_measurement_id and site.lastmod are required');
});

describe('markup contract: reading and focus order, link names, no-JS, full-screen view, typography', () => {
  const firstElement = (el) => (el.children || []).find((c) => c.type === 'element');

  test('every page: <body> starts with a.skip-link to #main, then the consent banner, then the nav; #main holds the h1', () => {
    expectNone(forPages(pages, (page, doc) => {
      const out = [];
      const body = qs(doc, 'body');
      const first = body && firstElement(body);
      if (!first || first.tag !== 'a' || !classes(first).includes('skip-link') || attr(first, 'href') !== '#main') out.push(`the first element in <body> is ${first ? desc(first) : 'missing'}, expected <a class="skip-link" href="#main">`);
      const banner = qs(doc, '#cookie-consent');
      const nav = qs(doc, '#site-nav');
      if (banner && nav && banner.start > nav.start) out.push('#cookie-consent comes after #site-nav (keyboard and screen-reader users meet the choice last)');
      const main = qs(doc, '#main');
      if (!main || main.tag !== 'main') out.push('no <main id="main"> (skip link target)');
      else if (!qs(main, 'h1')) out.push('the h1 is outside <main id="main">');
      return out;
    }), 'document start problems');
  });

  test('home hero: the e-mail link and Explore Artworks come before the play button in the source (Tab order follows the reading order)', () => {
    expectNone(forPages(pages.filter((p) => p.type === 'home'), (page, doc) => {
      const cta = qs(doc, 'a.hero__cta');
      const email = qs(doc, 'a.hero__email');
      const play = qs(doc, 'button.hero__play');
      if (!cta || !email || !play) return ['hero links or play button missing'];
      return play.start < cta.start || play.start < email.start ? ['button.hero__play comes before the hero links'] : [];
    }), 'hero order problems');
  });

  test('cards: a.card__link is named by its title (and the badge) through aria-labelledby; span.card__more is aria-hidden', () => {
    expectNone(forPages(pages.filter((p) => p.type === 'home' || p.type === 'hub'), (page, doc) => {
      const out = [];
      const ids = new Map(qsa(doc, '[id]').map((el) => [attr(el, 'id'), el]));
      for (const card of qsa(doc, 'article.card')) {
        const link = qs(card, 'a.card__link');
        const title = qs(card, '.card__title');
        const badge = qs(card, '.card__badge');
        if (!link || !title) continue; // reported by the card contract test
        const refs = (attr(link, 'aria-labelledby') || '').split(/\s+/).filter(Boolean);
        const want = [attr(title, 'id'), ...(badge ? [attr(badge, 'id')] : [])];
        if (want.some((id) => !id) || refs.join(' ') !== want.join(' ')) out.push(`card "${t(title)}": aria-labelledby="${refs.join(' ')}", expected the ids of the title${badge ? ' and the badge' : ''}`);
        for (const id of refs) if (!ids.has(id) || closest(ids.get(id), 'article.card') !== card) out.push(`card "${t(title)}": aria-labelledby refers to ${id}, which is not in the card`);
        const more = qs(card, 'span.card__more');
        if (more && attr(more, 'aria-hidden') !== 'true') out.push(`card "${t(title)}": span.card__more needs aria-hidden="true"`);
      }
      const all = qsa(doc, '[id]').map((el) => attr(el, 'id'));
      const dup = all.filter((id, i) => all.indexOf(id) !== i);
      if (dup.length) out.push(`duplicate ids: ${[...new Set(dup)].join(', ')}`);
      return out;
    }), 'card link name problems');
  });

  test('card images use data.json preview_alt / preview_hover_alt when set (a crop can show something else than its source photo)', () => {
    const withAlt = S.allArtworks(data).filter(({ artwork }) => artwork.preview_alt || artwork.preview_hover_alt);
    assert.ok(withAlt.length > 0, 'no artwork sets preview_alt (Hortensien does)');
    expectNone(forPages(pages.filter((p) => p.type === 'home' || p.type === 'hub'), (page, doc) => {
      const out = [];
      for (const { hub, artwork } of withAlt) {
        const link = qsa(doc, 'a.card__link').find((a) => linkPath(a, '/') === S.artworkPath(hub, artwork));
        if (!link) continue;
        const main = qs(link, 'picture.card__img:not(.card__img--hover) img');
        const hover = qs(link, 'picture.card__img--hover img');
        if (artwork.preview_alt && attr(main, 'alt') !== artwork.preview_alt) out.push(`${artwork.slug}: card image alt ${JSON.stringify(attr(main, 'alt'))}, expected preview_alt`);
        if (artwork.preview_hover_alt && attr(hover, 'alt') !== artwork.preview_hover_alt) out.push(`${artwork.slug}: hover image alt ${JSON.stringify(attr(hover, 'alt'))}, expected preview_hover_alt`);
      }
      return out;
    }), 'card image alt problems');
  });

  test('every page: without JavaScript the Cookie settings item is hidden (a noscript style; consent.js would handle the button)', () => {
    expectNone(forPages(pages, (page, doc) => {
      const css = qsa(doc, 'noscript style').map((s) => rawText(s)).join('');
      const settings = qs(doc, '#cookie-settings');
      const item = settings && closest(settings, 'li');
      if (!item || !classes(item).includes('site-footer__item--settings')) return ['#cookie-settings is not inside li.site-footer__item--settings'];
      return /\.site-footer__item--settings\s*\{\s*display\s*:\s*none/.test(css) ? [] : ['no <noscript><style> that hides .site-footer__item--settings'];
    }), 'no-JS problems');
  });

  test('artwork pages: button.artwork__zoom (hidden in the HTML, shown by artwork.js) over the main image and dialog#artwork-zoom with a close button (+ previous/next when there is more than one image)', () => {
    expectNone(forPages(pages.filter((p) => p.type === 'artwork'), (page, doc) => {
      const out = [];
      const zoom = qs(doc, '.artwork__stage > button.artwork__zoom');
      if (!zoom) out.push('no .artwork__stage > button.artwork__zoom');
      else {
        if (!hasAttr(zoom, 'hidden')) out.push('button.artwork__zoom must carry hidden (artwork.js shows it; without JS it would do nothing)');
        if (attr(zoom, 'type') !== 'button' || !(attr(zoom, 'aria-label') || '').trim()) out.push('button.artwork__zoom needs type="button" and an aria-label');
        if (attr(zoom, 'aria-controls') !== 'artwork-zoom') out.push('button.artwork__zoom needs aria-controls="artwork-zoom"');
      }
      const dialog = qs(doc, 'dialog#artwork-zoom');
      if (!dialog) return [...out, 'no dialog#artwork-zoom'];
      if (hasAttr(dialog, 'open')) out.push('dialog#artwork-zoom must be closed in the HTML');
      if (!(attr(dialog, 'aria-label') || '').trim()) out.push('dialog#artwork-zoom needs an aria-label');
      if (!qs(dialog, '.zoom__stage') || !qs(dialog, 'button.zoom__close[aria-label]')) out.push('dialog#artwork-zoom needs .zoom__stage and button.zoom__close');
      const arrows = qsa(dialog, 'button.zoom__prev, button.zoom__next').length;
      if (page.artwork.images.length > 1 ? arrows !== 2 : arrows !== 0) out.push(`${arrows} previous/next buttons in the dialog for ${page.artwork.images.length} image(s)`);
      return out;
    }), 'full-screen view markup problems');
  });

  test('visible sizes and initials never break across lines: no plain space inside "<w> × <h> cm" or after an initial ("P. Molina", "St. Albani"), in any visible text of any page', () => {
    // Every text node in <body> (facts such as "Framed (wood and glass), 50 × 40 cm", titles in cards, h1,
    // breadcrumb and pager, descriptions, hub intros), not a list of known places: a new field that shows a size
    // without keepTogether() fails here.
    const PLAIN = /\d ×|× \d|\d (?:cm|mm)\b|\b(?:[A-Z]|St)\. (?=[A-Z])/;
    const HIDDEN = new Set(['script', 'style', 'template', 'noscript']);
    expectNone(forPages(pages, (page, doc) => {
      const out = [];
      const visit = (node) => {
        if (node.type === 'text') {
          const m = PLAIN.exec(node.text);
          if (m) out.push(`${desc(node.parent, false)}: "${m[0]}" has a breaking space (use U+00A0; build-site.js keepTogether())`);
        } else if (node.type === 'element' && !HIDDEN.has(node.tag)) {
          node.children.forEach(visit);
        }
      };
      const body = qs(doc, 'body');
      if (!body) return ['no <body>'];
      visit(body);
      return out;
    }), 'breaking spaces in sizes or initials');
  });
});
