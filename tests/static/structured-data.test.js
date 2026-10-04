'use strict';
// SPEC 12.9: JSON-LD structured data (contract in SPEC section 7).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { qsa, rawText } = require('../lib/html');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');
const { I18N } = require('../../scripts/build-site.js');

const data = S.loadData();
const SITE = S.siteUrl(data);
const HOME = `${SITE}/`;
const PERSON_ID = `${SITE}/#person`;
const pages = S.sitePages(data);
const indexable = pages.filter((p) => p.indexable);

/** Parse all JSON-LD blocks of a document: { blocks: [json], errors: [string] } */
function jsonLd(doc) {
  const blocks = [];
  const errors = [];
  qsa(doc, 'script[type="application/ld+json"]').forEach((s, i) => {
    const raw = rawText(s);
    try {
      blocks.push(JSON.parse(raw));
    } catch (e) {
      errors.push(`JSON-LD block #${i + 1} (line ${doc.lineOf(s.start)}) does not parse: ${e.message}`);
    }
  });
  return { blocks, errors };
}

function typesOf(node) {
  const t = node && node['@type'];
  return Array.isArray(t) ? t : t ? [t] : [];
}

/** Every object with an @type anywhere in the JSON-LD (nested ones included). */
function allTyped(blocks) {
  const out = [];
  const visit = (v) => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!v || typeof v !== 'object') return;
    if (typesOf(v).length) out.push(v);
    for (const val of Object.values(v)) visit(val);
  };
  blocks.forEach(visit);
  return out;
}

function findType(nodes, type) {
  return nodes.filter((n) => typesOf(n).includes(type));
}

function hasKeyDeep(v, key) {
  if (Array.isArray(v)) return v.some((x) => hasKeyDeep(x, key));
  if (!v || typeof v !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(v, key) || Object.values(v).some((x) => hasKeyDeep(x, key));
}

function asArray(v) {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

/** Check a BreadcrumbList against the expected [ [name, url], ... ] trail. */
function checkBreadcrumb(nodes, trail) {
  const lists = findType(nodes, 'BreadcrumbList');
  if (lists.length !== 1) return [`${lists.length} BreadcrumbList nodes (expected 1)`];
  const items = asArray(lists[0].itemListElement);
  const out = [];
  if (items.length !== trail.length) out.push(`BreadcrumbList has ${items.length} items, expected ${trail.length} (${trail.map((t) => t[0]).join(' > ')})`);
  items.forEach((it, i) => {
    if (!typesOf(it).includes('ListItem')) out.push(`breadcrumb item ${i + 1} is not a ListItem`);
    if (it.position !== i + 1) out.push(`breadcrumb item ${i + 1} has position ${JSON.stringify(it.position)}`);
    const want = trail[i];
    if (!want) return;
    const itemUrl = typeof it.item === 'string' ? it.item : it.item && (it.item['@id'] || it.item.url);
    const isLast = i === trail.length - 1;
    if (itemUrl !== want[1] && !(isLast && itemUrl === undefined)) out.push(`breadcrumb item ${i + 1} url ${JSON.stringify(itemUrl)}, expected ${want[1]}`);
    const name = it.name || (it.item && it.item.name);
    if (want[0] === null ? !name : name !== want[0]) out.push(`breadcrumb item ${i + 1} name ${JSON.stringify(name)}, expected ${want[0] === null ? 'a name' : JSON.stringify(want[0])}`);
  });
  return out;
}

function forPages(list, fn) {
  const problems = [];
  const missing = [];
  for (const page of list) {
    const loaded = S.loadAppHtml(page.file);
    if (!loaded) { missing.push(page.file); continue; }
    const { blocks, errors } = jsonLd(loaded.doc);
    const nodes = allTyped(blocks);
    for (const p of [...errors, ...fn(page, nodes, blocks)]) problems.push(`${page.file}: ${p}`);
  }
  if (missing.length) problems.unshift(`${missing.length} of ${list.length} expected page(s) do not exist, e.g. ${missing.slice(0, 3).join(', ')} (see "1. pages exist")`);
  return problems;
}

/* breadcrumb start of a page: "Home" -> / (German pages: "Startseite" -> /de/) */
function homeTrail(page = { lang: 'en' }) { return [[I18N[page.lang].t.home, `${SITE}${S.LANG_PREFIX[page.lang]}/`]]; }
const pre = (page) => S.LANG_PREFIX[page.lang];

describe('9. JSON-LD structured data', () => {
  test('every JSON-LD block on every HTML page parses as JSON', () => {
    const files = S.appHtmlFiles();
    assert.ok(files.length > 0, `no HTML files in ${S.APP_DIR}`);
    const problems = [];
    for (const f of files) {
      for (const e of jsonLd(S.loadAppHtml(f.rel).doc).errors) problems.push(`${f.rel}: ${e}`);
    }
    expectNone(problems, 'invalid JSON-LD');
  });

  test('no JSON-LD on any page contains "offers" or an Offer (no shop)', () => {
    const problems = [];
    for (const f of S.appHtmlFiles()) {
      const { blocks } = jsonLd(S.loadAppHtml(f.rel).doc);
      const nodes = allTyped(blocks);
      if (blocks.some((b) => hasKeyDeep(b, 'offers'))) problems.push(`${f.rel}: has "offers"`);
      if (findType(nodes, 'Offer').length || findType(nodes, 'AggregateOffer').length) problems.push(`${f.rel}: has an Offer node`);
    }
    expectNone(problems, 'shop structured data');
  });

  test(`home: WebSite and Person (@id ${PERSON_ID}, jobTitle "Visual artist" / "Bildende Künstlerin", country DE, sameAs Instagram, Facebook, LinkedIn, Etsy)`, () => {
    const social = ((data.site && data.site.social) || []).map((s) => s.url);
    expectNone(forPages(pages.filter((p) => p.type === 'home'), (page, nodes) => {
      const out = [];
      const sites = findType(nodes, 'WebSite');
      if (sites.length !== 1) out.push(`${sites.length} WebSite nodes (expected 1)`);
      else {
        if (sites[0].url !== HOME) out.push(`WebSite.url is ${JSON.stringify(sites[0].url)}, expected ${HOME}`);
        if (!sites[0].name) out.push('WebSite.name missing');
      }
      const persons = findType(nodes, 'Person').filter((p) => p.sameAs || p.jobTitle || p.name);
      const person = persons.find((p) => p['@id'] === PERSON_ID) || persons[0];
      if (!person) return [...out, 'no Person node'];
      if (person['@id'] !== PERSON_ID) out.push(`Person @id is ${JSON.stringify(person['@id'])}, expected ${PERSON_ID}`);
      if (person.name !== 'Polina Shvedko') out.push(`Person.name is ${JSON.stringify(person.name)}`);
      const job = I18N[page.lang].job_title;
      if (person.jobTitle !== job) out.push(`Person.jobTitle is ${JSON.stringify(person.jobTitle)}, expected "${job}"`);
      const site = sites[0];
      if (site && JSON.stringify(site.inLanguage) !== JSON.stringify(['en', 'de'])) out.push(`WebSite.inLanguage is ${JSON.stringify(site.inLanguage)}, expected ["en","de"]`);
      if (person.url !== HOME) out.push(`Person.url is ${JSON.stringify(person.url)}, expected ${HOME}`);
      const image = asArray(person.image)[0];
      const imageUrl = typeof image === 'string' ? image : image && image.url;
      if (!imageUrl || !String(imageUrl).startsWith(`${SITE}/`)) out.push(`Person.image ${JSON.stringify(person.image)} is not an absolute URL on the site`);
      const country = person.address && (person.address.addressCountry || (person.address.address && person.address.address.addressCountry));
      if (country !== 'DE') out.push(`Person.address.addressCountry is ${JSON.stringify(country)}, expected "DE"`);
      const sameAs = asArray(person.sameAs);
      for (const url of social) if (!sameAs.includes(url)) out.push(`Person.sameAs lacks ${url}`);
      return out;
    }), 'home structured data');
  });

  test('hubs: CollectionPage (url = canonical) with an ItemList of all its artworks in data.json order + BreadcrumbList Home > hub', () => {
    expectNone(forPages(indexable.filter((p) => p.type === 'hub'), (page, nodes) => {
      const out = [];
      const cps = findType(nodes, 'CollectionPage');
      if (cps.length !== 1) out.push(`${cps.length} CollectionPage nodes (expected 1)`);
      else {
        if (cps[0].url !== page.url) out.push(`CollectionPage.url is ${JSON.stringify(cps[0].url)}, expected ${page.url}`);
        if (!cps[0].name) out.push('CollectionPage.name missing');
        if (!cps[0].description) out.push('CollectionPage.description missing');
        if (!cps[0].isPartOf) out.push('CollectionPage.isPartOf (WebSite) missing');
      }
      const lists = findType(nodes, 'ItemList');
      if (lists.length !== 1) return [...out, `${lists.length} ItemList nodes (expected 1)`, ...checkBreadcrumb(nodes, [...homeTrail(page), [page.hub.label, page.url]])];
      const items = asArray(lists[0].itemListElement);
      const artworks = page.hub.artworks;
      if (items.length !== artworks.length) out.push(`ItemList has ${items.length} items, the hub has ${artworks.length} artworks`);
      items.forEach((it, i) => {
        const a = artworks[i];
        if (it.position !== i + 1) out.push(`ListItem ${i + 1} position ${JSON.stringify(it.position)}`);
        const url = it.url || (it.item && (it.item.url || it.item['@id']));
        if (a && url !== `${SITE}${S.artworkPath(page.hub, a, page.lang)}`) out.push(`ListItem ${i + 1} url ${JSON.stringify(url)}, expected ${SITE}${S.artworkPath(page.hub, a, page.lang)}`);
        const name = it.name || (it.item && it.item.name);
        if (a && name !== a.title) out.push(`ListItem ${i + 1} name ${JSON.stringify(name)}, expected ${JSON.stringify(a.title)}`);
        const image = it.image || (it.item && it.item.image);
        const imageUrl = typeof asArray(image)[0] === 'string' ? asArray(image)[0] : asArray(image)[0] && asArray(image)[0].url;
        if (!imageUrl || !String(imageUrl).startsWith(`${SITE}/`)) out.push(`ListItem ${i + 1} image ${JSON.stringify(image)} is not an absolute URL on the site`);
      });
      return [...out, ...checkBreadcrumb(nodes, [...homeTrail(page), [page.hub.label, page.url]])];
    }), 'hub structured data');
  });

  test('artworks: VisualArtwork (url = canonical, creator Person, dateCreated, artMedium, artform, artworkSurface, width/height QuantitativeValue in cm, no offers) + BreadcrumbList Home > hub > title', () => {
    expectNone(forPages(indexable.filter((p) => p.type === 'artwork'), (page, nodes) => {
      const a = page.artwork;
      const out = [];
      const arts = findType(nodes, 'VisualArtwork');
      if (arts.length !== 1) return [`${arts.length} VisualArtwork nodes (expected 1)`, ...checkBreadcrumb(nodes, [...homeTrail(page), [page.hub.label, `${SITE}${pre(page)}/${page.hub.path}/`], [a.title, page.url]])];
      const v = arts[0];
      // one artwork, two pages: the German page uses the @id of the English one
      const id = `${SITE}${S.artworkPath(page.hub, a)}#artwork`;
      if (v['@id'] !== id) out.push(`@id is ${JSON.stringify(v['@id'])}, expected ${id}`);
      if (v.inLanguage !== page.lang) out.push(`inLanguage is ${JSON.stringify(v.inLanguage)}, expected "${page.lang}"`);
      if (v.url !== page.url) out.push(`url is ${JSON.stringify(v.url)}, expected ${page.url}`);
      if (v.name !== a.title) out.push(`name is ${JSON.stringify(v.name)}, expected ${JSON.stringify(a.title)}`);
      if (typeof v.description !== 'string' || !v.description.trim() || /<[a-z/]/i.test(v.description)) out.push('description must be non-empty plain text');
      const images = asArray(v.image).map((im) => (typeof im === 'string' ? im : im && (im.url || im.contentUrl)));
      if (!images.length) out.push('image missing');
      for (const im of images) {
        if (!im || !String(im).startsWith(`${SITE}/`)) { out.push(`image ${JSON.stringify(im)} is not an absolute URL on the site`); continue; }
        const r = S.resolveLocal(im, page.path, data);
        if (!r.file || !S.appExists(r.file)) out.push(`image ${im} does not exist in app/`);
        else if (!/\.jpe?g$/i.test(r.file)) out.push(`image ${im} should be the 1200 px JPEG variant`);
      }
      const creator = asArray(v.creator)[0];
      if (!creator || creator['@id'] !== PERSON_ID || !typesOf(creator).includes('Person') || creator.name !== 'Polina Shvedko') {
        out.push(`creator is ${JSON.stringify(v.creator)}, expected {"@id":"${PERSON_ID}","@type":"Person","name":"Polina Shvedko"}`);
      }
      if (v.dateCreated !== String(a.year)) out.push(`dateCreated is ${JSON.stringify(v.dateCreated)}, expected "${a.year}"`);
      if (v.artMedium !== a.medium) out.push(`artMedium is ${JSON.stringify(v.artMedium)}, expected ${JSON.stringify(a.medium)}`);
      if (v.artform !== page.hub.artform) out.push(`artform is ${JSON.stringify(v.artform)}, expected ${JSON.stringify(page.hub.artform)}`);
      if (v.artworkSurface !== a.surface) out.push(`artworkSurface is ${JSON.stringify(v.artworkSurface)}, expected ${JSON.stringify(a.surface)}`);
      // schema.org 30.0 made Distance a text data type: {"@type": "Distance", "name": ...} is an unknown field
      // there, so the sizes are QuantitativeValue with the UN/CEFACT unit code for centimetres (CMT).
      for (const [key, value] of [['width', a.width_cm], ['height', a.height_cm]]) {
        const d = asArray(v[key])[0];
        if (!d || !typesOf(d).includes('QuantitativeValue')) out.push(`${key} is ${JSON.stringify(v[key])}, expected a QuantitativeValue`);
        else if (d.value !== value || d.unitCode !== 'CMT' || d.unitText !== 'cm' || 'name' in d) out.push(`${key} is ${JSON.stringify(d)}, expected {"@type":"QuantitativeValue","value":${value},"unitCode":"CMT","unitText":"cm"}`);
      }
      if (hasKeyDeep(v, 'offers')) out.push('VisualArtwork has offers');
      return [...out, ...checkBreadcrumb(nodes, [...homeTrail(page), [page.hub.label, `${SITE}${pre(page)}/${page.hub.path}/`], [a.title, page.url]])];
    }), 'artwork structured data');
  });

  test(`about: AboutPage with mainEntity -> Person ${PERSON_ID} + BreadcrumbList; contact: ContactPage + BreadcrumbList`, () => {
    expectNone(forPages(indexable.filter((p) => p.type === 'about' || p.type === 'contact'), (page, nodes) => {
      const out = [];
      const type = page.type === 'about' ? 'AboutPage' : 'ContactPage';
      const found = findType(nodes, type);
      if (found.length !== 1) out.push(`${found.length} ${type} nodes (expected 1)`);
      else {
        if (found[0].url !== page.url) out.push(`${type}.url is ${JSON.stringify(found[0].url)}, expected ${page.url}`);
        if (page.type === 'about') {
          const main = asArray(found[0].mainEntity)[0];
          if (!main || main['@id'] !== PERSON_ID) out.push(`AboutPage.mainEntity is ${JSON.stringify(found[0].mainEntity)}, expected a reference to ${PERSON_ID}`);
        }
      }
      if (found.length === 1 && found[0].inLanguage !== page.lang) out.push(`${type}.inLanguage is ${JSON.stringify(found[0].inLanguage)}, expected "${page.lang}"`);
      return [...out, ...checkBreadcrumb(nodes, [...homeTrail(page), [null, page.url]])];
    }), 'about/contact structured data');
  });
});
