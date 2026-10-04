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

/* Status texts (SPEC sections 1 and 6), English; the German ones are in I18N.de.status. */
const STATUS = {
  available: {
    text: 'Available: ask about this work',
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
 * hero: the 16:9 poster covers (object-fit: cover) a hero at least as tall as the window, so in a window
 * narrower than 16:9 it is drawn at least 177.8vh wide (a 390x844 phone: about 1500 px, not 390).
 */
const SIZES = {
  hero: '(max-aspect-ratio: 16/9) 178vh, 100vw',
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

/* Legal pages: generated only when data.json legal.<key>_html (English) and data.de.json legal.<key>_html (German) are
   set. Meta per language; data.json pages.<key> / data.de.json pages.<key> may override them. */
const LEGAL = [
  {
    key: 'imprint',
    field: 'imprint_html',
    meta: {
      en: { title: 'Imprint | Polina Shvedko', description: 'Imprint (Impressum) of polina-shvedko.art, the website of the artist Polina Shvedko from Germany, with the legal details of the site owner.' },
      de: { title: 'Impressum | Polina Shvedko', description: 'Impressum von polina-shvedko.art, der Website der Künstlerin Polina Shvedko aus Deutschland, mit den Angaben zur Anbieterin nach § 5 DDG.' },
    },
  },
  {
    key: 'privacy',
    field: 'privacy_html',
    meta: {
      en: { title: 'Privacy policy | Polina Shvedko', description: 'Privacy policy of polina-shvedko.art: what data this website processes, how Google Analytics is used only with your consent, and your rights.' },
      de: { title: 'Datenschutzerklärung | Polina Shvedko', description: 'Datenschutzerklärung von polina-shvedko.art: welche Daten die Website verarbeitet, Google Analytics nur mit Einwilligung, YouTube und Ihre Rechte.' },
    },
  },
];

/*
 * Languages. English is served at the root, German below /de/ with the same paths (/de/oil-paintings/<slug>/), so
 * the language switch and hreflang map a page to its pair by adding or removing the /de prefix. German content
 * comes from data.de.json (keys mirror data.json: hubs by key, artworks by slug, Instagram alts by src); the
 * strings of the templates are `t` below. No long dashes (U+2013/U+2014) anywhere: a static test checks app/.
 */
const LANGS = ['en', 'de'];
const DE_PREFIX = '/de';
const I18N = {
  en: {
    locale: 'en_GB',
    name: 'English',
    status: STATUS,
    site_image_alt: SITE_IMAGE_ALT,
    consent_text: CONSENT_TEXT,
    legal: { imprint: 'Imprint', privacy: 'Privacy policy' },
    job_title: PERSON_JOB_TITLE,
    about_name: 'About Polina Shvedko',
    painting_by: (name) => `Painting by ${name}`,
    social_label: (name, network) => `${name} on ${network}`,
    pager_label: (label) => `More ${label.toLowerCase()}`,
    medium_by: (medium, name) => `${medium.toLowerCase()} by ${name}`,
    number: (n) => String(n),
    thumb_label: (n, count) => `Show image ${n} of ${count}`,
    zoom_dialog: (title) => `${title}: full-screen view`,
    t: {
      skip: 'Skip to content',
      nav_label: 'Site navigation',
      lang_label: 'Language',
      home: 'Home',
      about: 'About',
      contact: 'Contact',
      breadcrumb: 'Breadcrumb',
      footer: 'Footer',
      cookie_settings: 'Cookie settings',
      consent_label: 'Cookie consent',
      decline: 'Decline',
      accept: 'Accept',
      more: 'MORE',
      hero_tagline: 'Oil paintings, pastels & watercolours',
      explore: 'Explore Artworks',
      play: 'Play the video',
      pause: 'Pause the video',
      video_title: 'Polina Shvedko Art video',
      intro_heading: 'Artist from Germany',
      intro_text: "I'm a German artist specializing in pastels, oils, and inks. With a formal art education and a lifelong passion for drawing, I continue to explore new ways of expressing emotion and storytelling through color and texture.",
      more_about: 'More about me',
      about_heading: 'About me',
      about_name1: 'Hi! My name is Polina Shvedko.',
      about_name2: "I'm a freelance artist. Welcome to my art website!",
      about_descr: 'I love the sea! Water is my inspiration. Every day I am in search of new ideas, forms, new materials and techniques! When my paintings find a new home it makes me happy! Thank you for your support it give me more strength and motivation to do more !',
      instagram_follow: 'Follow me on',
      instagram_mosaic: 'More paintings by Polina Shvedko on Instagram',
      contact_heading: 'Contact me',
      email: 'E-mail:',
      about_h1: 'About Polina Shvedko',
      contact_me: 'Contact me',
      contact_h1: 'Contact',
      zoom: 'View the image full screen',
      prev_image: 'Previous image',
      next_image: 'Next image',
      close_zoom: 'Close the full-screen view',
      story: 'Story',
      previous: 'Previous',
      next: 'Next',
      medium: 'Medium',
      size: 'Size',
      frame: 'Frame',
      year: 'Year',
      not_found: 'Page not found',
      not_found_text: 'Sorry, this page does not exist. These pages may help:',
    },
  },
  de: {
    locale: 'de_DE',
    name: 'Deutsch',
    status: {
      available: {
        text: 'Verfügbar: Fragen Sie gern nach diesem Werk',
        badge: '',
        ctaLabel: 'Nach diesem Werk fragen',
        ctaSubject: 'Anfrage: ',
        descriptionSuffix: ' Fragen Sie die Künstlerin nach diesem Werk.',
      },
      'private-collection': {
        text: 'In Privatbesitz',
        badge: 'Privatbesitz',
        ctaLabel: 'Die Künstlerin kontaktieren',
        ctaSubject: 'Frage zu: ',
        descriptionSuffix: ' Fragen Sie die Künstlerin nach ähnlichen Werken.',
      },
    },
    site_image_alt: {
      hero_poster: 'Standbild aus dem Video: Ein Pinsel malt eine Landschaft in Öl auf Leinwand',
      avatar: 'Gezeichneter Avatar von Polina Shvedko',
      photo: 'Polina Shvedko vor Hortensien',
      portrait: 'Porträt von Polina Shvedko',
    },
    consent_text: 'Mit Ihrer Einwilligung verwendet diese Website Cookies von Google Analytics, um zu sehen, wie Besucher sie nutzen. Sie können Ihre Wahl jederzeit unter Cookie-Einstellungen ändern.',
    legal: { imprint: 'Impressum', privacy: 'Datenschutzerklärung' },
    job_title: 'Bildende Künstlerin',
    about_name: 'Über Polina Shvedko',
    painting_by: (name) => `Gemälde von ${name}`,
    social_label: (name, network) => `${name} auf ${network}`,
    pager_label: (label) => `Weitere ${label}`,
    medium_by: (medium, name) => `${medium} von ${name}`,
    number: (n) => String(n).replace('.', ','),
    thumb_label: (n, count) => `Bild ${n} von ${count} zeigen`,
    zoom_dialog: (title) => `${title}: Vollbildansicht`,
    t: {
      skip: 'Zum Inhalt springen',
      nav_label: 'Hauptnavigation',
      lang_label: 'Sprache',
      home: 'Startseite',
      about: 'Über mich',
      contact: 'Kontakt',
      breadcrumb: 'Brotkrümelnavigation',
      footer: 'Fußzeile',
      cookie_settings: 'Cookie-Einstellungen',
      consent_label: 'Cookie-Einwilligung',
      decline: 'Ablehnen',
      accept: 'Akzeptieren',
      more: 'MEHR',
      hero_tagline: 'Ölgemälde, Pastelle & Aquarelle',
      explore: 'Werke entdecken',
      play: 'Video abspielen',
      pause: 'Video anhalten',
      video_title: 'Video von Polina Shvedko Art',
      intro_heading: 'Künstlerin aus Deutschland',
      intro_text: 'Ich bin eine deutsche Künstlerin und arbeite vor allem mit Pastell, Öl und Tusche. Mit einer künstlerischen Ausbildung und einer lebenslangen Leidenschaft für das Zeichnen suche ich immer neue Wege, Gefühle und Geschichten durch Farbe und Textur auszudrücken.',
      more_about: 'Mehr über mich',
      about_heading: 'Über mich',
      about_name1: 'Hallo! Ich heiße Polina Shvedko.',
      about_name2: 'Ich bin freischaffende Künstlerin. Willkommen auf meiner Kunst-Website!',
      about_descr: 'Ich liebe das Meer! Wasser ist meine Inspiration. Jeden Tag suche ich nach neuen Ideen, Formen, Materialien und Techniken! Wenn meine Bilder ein neues Zuhause finden, macht mich das glücklich! Danke für Ihre Unterstützung, sie gibt mir Kraft und Motivation für noch mehr!',
      instagram_follow: 'Folgen Sie mir auf',
      instagram_mosaic: 'Weitere Bilder von Polina Shvedko auf Instagram',
      contact_heading: 'Kontakt',
      email: 'E-Mail:',
      about_h1: 'Über Polina Shvedko',
      contact_me: 'Kontakt aufnehmen',
      contact_h1: 'Kontakt',
      zoom: 'Bild im Vollbild ansehen',
      prev_image: 'Vorheriges Bild',
      next_image: 'Nächstes Bild',
      close_zoom: 'Vollbildansicht schließen',
      story: 'Geschichte',
      previous: 'Zurück',
      next: 'Weiter',
      medium: 'Technik',
      size: 'Größe',
      frame: 'Rahmen',
      year: 'Jahr',
      not_found: 'Seite nicht gefunden',
      not_found_text: 'Diese Seite gibt es leider nicht. Vielleicht helfen diese Seiten weiter:',
    },
  },
};

/* Partials that are used inside a line: their trailing line break is removed when they are loaded. */
const INLINE_PARTIAL_RE = /^(picture|icon-.+)$/;

/* Paths a hub must not take (pages, assets and retired URLs). */
const RESERVED_PATHS = new Set(['de', 'about', 'contact', 'imprint', 'privacy', 'css', 'js', 'img', 'blog', 'partials', 'sitemap.xml', 'robots.txt', '404.html']);

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
  + 'than that this these those its their his her our your my is are was were be which who whose where when while'
  // German (the /de/ pages): articles, prepositions, conjunctions
  + ' der die das den dem des ein eine einen einem einer eines und oder aber mit von vom zu zum zur im ins am an auf aus bei für über unter vor nach durch um sein seine ihr ihre sich wie wo').split(' '));
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

/*
 * keepTogether(): the gaps that must not break. A gap is any run of white space, also written as an HTML entity
 * (&nbsp;), and the sign of a size may be an entity too (&times;), so the same rules work for plain text and for
 * the text between the tags of HTML (keepTogetherHtml()). Only breaking white space in a gap becomes U+00A0.
 */
const GAP = '(?:[\\t\\n\\f\\r \\u00a0]|&nbsp;|&#0*160;|&#[xX]0*[aA]0;)+';
const TIMES = '(?:×|&times;|&#0*215;|&#[xX]0*[dD]7;)';
const KEEP_SIZE_RE = new RegExp(`(\\d|\\bcm|\\bmm)(${GAP})?(${TIMES})(${GAP})?(?=\\d)`, 'g');
const KEEP_UNIT_RE = new RegExp(`(\\d)(${GAP})(cm|mm)\\b`, 'g');
const KEEP_INITIAL_RE = new RegExp(`\\b([A-Z]|St|Dr|Mr|Mrs|Ms|Mt)\\.(${GAP})(?=[A-Z])`, 'g');
const noBreak = (gap) => (gap || '').replace(/[\t\n\f\r ]+/g, '\u00a0');

/** Visible running text: no line break inside a size ("190 × 45 cm") or after an initial ("P. Molina"). */
function keepTogether(text) {
  return String(text)
    .replace(KEEP_SIZE_RE, (m, before, gap1, times, gap2) => `${before}${noBreak(gap1)}${times}${noBreak(gap2)}`)
    .replace(KEEP_UNIT_RE, (m, digit, gap, unit) => `${digit}${noBreak(gap)}${unit}`)
    .replace(KEEP_INITIAL_RE, (m, initial, gap) => `${initial}.${noBreak(gap)}`);
}

/* Markup in HTML from data.json that keepTogetherHtml() leaves as written: comments, <script>/<style> with
   their content, tags (a ">" inside a quoted attribute value does not end a tag), doctype-like declarations. */
const HTML_MARKUP_RE = /<!--[\s\S]*?-->|<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>|<\/?[A-Za-z](?:"[^"]*"|'[^']*'|[^'">])*>|<[!?][^>]*>/gi;

/** keepTogether() for HTML (story_html, the legal texts): only the text between the tags changes. */
function keepTogetherHtml(html) {
  const src = String(html);
  let out = '';
  let last = 0;
  for (const m of src.matchAll(HTML_MARKUP_RE)) {
    out += keepTogether(src.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + keepTogether(src.slice(last));
}

/*
 * HTML pasted into data.json (story_html, the legal texts), often from a generator, in the markup style of the rest of
 * the site, so that html-validate and with it the CI check before the deploy accept it. What it shows stays the same:
 * void elements lose their self-closing slash (<br /> -> <br>), blanks at line ends go, inline style attributes go
 * (site.css styles the text), <a name="x"> becomes <a id="x"> (name is deprecated), and a link that opens a new
 * window gets rel="noopener". Comments and the text between the tags stay as written.
 */
const VOID_SLASH_RE = /<(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b((?:"[^"]*"|'[^']*'|[^'">])*?)\s*\/>/gi;
const START_TAG_RE = /^<([A-Za-z][A-Za-z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>$/;
/* one attribute with the white space before it: name, and optionally = and a quoted or unquoted value */
const ATTR_RE = /(\s+)([^\s"'>/=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

function normalizeStartTag(tag) {
  const m = START_TAG_RE.exec(tag);
  if (!m) return tag;
  const [, name, attrs] = m;
  const isLink = name.toLowerCase() === 'a';
  const items = [...attrs.matchAll(ATTR_RE)].map((a) => ({ ws: a[1], key: a[2], eq: a[3] || '', value: a[4] }));
  const tail = /\s*$/.exec(attrs)[0];
  const has = (key) => items.some((it) => it.key.toLowerCase() === key);
  const kept = [];
  for (const it of items) {
    const key = it.key.toLowerCase();
    if (key === 'style') continue;
    if (isLink && key === 'name') {
      if (!has('id')) kept.push({ ...it, key: 'id' });
      continue;
    }
    kept.push(it);
  }
  const blank = kept.some((it) => it.key.toLowerCase() === 'target' && /^(["']?)_blank\1$/i.test(it.value || ''));
  if (isLink && blank && !has('rel')) kept.push({ ws: ' ', key: 'rel', eq: '=', value: '"noopener"' });
  return `<${name}${kept.map((it) => `${it.ws}${it.key}${it.value !== undefined ? it.eq + it.value : ''}`).join('')}${tail}>`;
}

function normalizeHtml(html) {
  const src = String(html).replace(/[ \t]+(?=\r?\n|$)/g, '');
  let out = '';
  let last = 0;
  for (const m of src.matchAll(HTML_MARKUP_RE)) {
    out += src.slice(last, m.index);
    let tag = m[0];
    if (/^<[A-Za-z]/.test(tag) && !/^<(script|style)\b/i.test(tag)) tag = normalizeStartTag(tag.replace(VOID_SLASH_RE, '<$1$2>'));
    out += tag;
    last = m.index + m[0].length;
  }
  return out + src.slice(last);
}

/**
 * Headings of HTML from data.json moved by one step so that the highest one gets level `top` (the story: h3 below
 * its "Story" h2; a legal text: h2 below the page h1, so a text that starts with its own <h1>, as generated legal
 * texts do, gives no second h1), at most h6.
 */
function shiftHeadings(html, top) {
  const src = String(html);
  const levels = [...src.matchAll(/<h([1-6])(?=[\s>])/gi)].map((m) => Number(m[1]));
  if (!levels.length) return src;
  const step = top - Math.min(...levels);
  return src.replace(/<(\/?)h([1-6])(?=[\s>])/gi, (m, slash, level) => `<${slash}h${Math.min(6, Number(level) + step)}`);
}

/**
 * mailto: links to the site's address in HTML from data.json get the contact tracking of every other mailto link
 * (data-track="contact", data-location, data-artwork-slug on artwork pages), so they count as contact_click like
 * the links of the templates. A link that already has data-track, or another address (for example a data
 * protection authority in the privacy text), stays as written.
 */
function trackMailto(html, email, attrs) {
  return String(html).replace(/<a\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, (tag) => {
    const m = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    const href = m ? plainText(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : '';
    if (!/^mailto:/i.test(href) || /\sdata-track\s*=/i.test(tag)) return tag;
    let address = href.slice(7).split('?')[0];
    try { address = decodeURIComponent(address); } catch (e) { /* keep it as written */ }
    if (address.trim().toLowerCase() !== String(email).toLowerCase()) return tag;
    const extra = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('');
    return tag.replace(/\s*\/?>$/, (end) => `${extra}${end}`);
  });
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
/* German content (data.de.json)                                                                     */

const DE_SITE_FIELDS = ['seo_title', 'seo_description'];
const DE_HUB_FIELDS = ['label', 'section_heading', 'h1', 'all_link', 'medium_label', 'seo_title', 'seo_description'];

/**
 * data.json with the German texts of data.de.json in place of the English ones (a deep copy; data.json is not
 * changed). Everything that is not text (slugs, paths, sizes, images, order, status) stays as in data.json. Throws
 * when a text is missing, so a new artwork or hub cannot go online without its German page.
 */
function localizeData(data, de) {
  const out = JSON.parse(JSON.stringify(data));
  if (!de || typeof de !== 'object') fail('data.de.json is empty');
  const need = (obj, key, where) => {
    if (!obj || typeof obj[key] !== 'string' || !obj[key].trim()) fail(`data.de.json ${where}: "${key}" must be a non-empty string`);
    return obj[key];
  };
  const paragraphs = (list, n, where) => {
    if (!Array.isArray(list) || !list.length || list.some((t) => typeof t !== 'string' || !t.trim())) fail(`data.de.json ${where} must be a list of non-empty paragraphs`);
    if (n !== undefined && list.length !== n) fail(`data.de.json ${where} has ${list.length} paragraph(s), data.json ${n}`);
    return list;
  };
  for (const k of DE_SITE_FIELDS) out.site[k] = need(de.site, k, 'site');
  for (const k of ['about', 'contact']) {
    const pg = de.pages && de.pages[k];
    out.pages[k] = { seo_title: need(pg, 'seo_title', `pages.${k}`), seo_description: need(pg, 'seo_description', `pages.${k}`) };
  }
  for (const k of ['imprint', 'privacy']) if (de.pages && de.pages[k]) out.pages[k] = de.pages[k];
  for (const hub of out.hubs) {
    const h = de.hubs && de.hubs[hub.key];
    if (!h) fail(`data.de.json hubs.${hub.key} is missing`);
    for (const k of DE_HUB_FIELDS) hub[k] = need(h, k, `hubs.${hub.key}`);
    hub.intro = paragraphs(h.intro, undefined, `hubs.${hub.key}.intro`);
    for (const a of hub.artworks) {
      const g = de.artworks && de.artworks[a.slug];
      const where = `artworks.${a.slug}`;
      if (!g) fail(`data.de.json ${where} is missing`);
      a.title = need(g, 'title', where);
      a.medium = need(g, 'medium', where);
      if (a.frame) a.frame = need(g, 'frame', where);
      a.description = paragraphs(g.description, a.description.length, `${where}.description`);
      if (!Array.isArray(g.images_alt) || g.images_alt.length !== a.images.length) fail(`data.de.json ${where}.images_alt needs ${a.images.length} alt text(s)`);
      a.images = a.images.map((im, n) => ({ ...im, alt: need(g.images_alt, n, `${where}.images_alt`) }));
      for (const k of ['preview_alt', 'preview_hover_alt']) if (a[k]) a[k] = need(g, k, where);
      a.seo_title = a.seo_title ? need(g, 'seo_title', where) : (g.seo_title || null);
      a.seo_description = g.seo_description || null;
      if (a.story_confirmed === true) a.story_html = need(g, 'story_html', where);
      else a.story_html = g.story_html || null;
    }
  }
  out.socialmedia_images = out.socialmedia_images.map((im) => ({ ...im, alt: need(de.socialmedia_alt, im.src, 'socialmedia_alt') }));
  out.legal = { imprint_html: (de.legal && de.legal.imprint_html) || null, privacy_html: (de.legal && de.legal.privacy_html) || null };
  return out;
}

/** Legal pages that are built: a text in both languages (one language only stops the build, hreflang needs both). */
function legalKeysOf(data, dataDe) {
  const has = (d, l) => Boolean(d.legal && typeof d.legal[l.field] === 'string' && d.legal[l.field].trim());
  return LEGAL.filter((l) => {
    if (has(data, l) !== has(dataDe, l)) fail(`legal.${l.field} must be set in data.json and data.de.json, or in neither (the page needs both languages)`);
    return has(data, l);
  }).map((l) => l.key);
}

/* ------------------------------------------------------------------------------------------------ */
/* the build                                                                                         */

function createContext(root, data, manifest, assets, templates, lang = 'en', legalKeys = null) {
  const site = data.site;
  const L = I18N[lang];
  const T = L.t;
  const P = lang === 'en' ? '' : DE_PREFIX; // URL prefix of this language
  const STATUS = L.status; // eslint-disable-line no-shadow
  const SITE_IMAGE_ALT = L.site_image_alt; // eslint-disable-line no-shadow
  const SITE = site.url;
  const PERSON_ID = `${SITE}/#person`;
  const WEBSITE_ID = `${SITE}/#website`;
  const year = site.lastmod.slice(0, 4);
  const legalPages = LEGAL.filter((l) => (legalKeys ? legalKeys.includes(l.key) : data.legal && typeof data.legal[l.field] === 'string' && data.legal[l.field].trim()))
    .map((l) => ({ ...l, label: L.legal[l.key], title: l.meta[lang].title, description: l.meta[lang].description }));

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

  const hubUrl = (hub) => `${P}/${hub.path}/`;
  const artworkUrl = (hub, a) => `${P}/${hub.path}/${a.slug}/`;
  const sizeText = (a) => `${L.number(a.width_cm)} × ${L.number(a.height_cm)} cm`;
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
      `${a.title} - ${hub.medium_label}, ${a.year}${suffix}`,
      `${a.title} - ${hub.medium_label}${suffix}`,
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
    const first = lang === 'en' ? withoutTitleEcho(a.title, plainText(a.description[0])) : plainText(a.description[0]);
    const text = plainText(`${a.title}, ${L.medium_by(a.medium, site.name)} (${a.year}), ${sizeText(a)}. ${first}`);
    let d = fitText(text, DESCRIPTION_MIN, DESCRIPTION_MAX);
    if (cpLen(d) < DESCRIPTION_MIN) d = fitText(`${d}${STATUS[a.status].descriptionSuffix}`, DESCRIPTION_MIN, DESCRIPTION_MAX);
    return d;
  }

  // ---------------------------------------------------------------- JSON-LD objects
  const person = () => ({
    '@type': 'Person',
    '@id': PERSON_ID,
    name: site.name,
    jobTitle: L.job_title,
    url: `${SITE}/`, // one person, one @id and url in both languages
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
    { href: `${P}/about/`, label: T.about },
    { href: `${P}/contact/`, label: T.contact },
  ];
  const footerItems = [...navItems, ...legalPages.map((l) => ({ href: `${P}/${l.key}/`, label: l.label }))];
  const privacy = legalPages.find((l) => l.key === 'privacy');
  const imprint = legalPages.find((l) => l.key === 'imprint');
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
        return { key, name: s.name, label: L.social_label(site.name, s.name), url: s.url, icon: icon.trim() };
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
  /** The page of the other language: same path with or without /de (404 pages: the home of each language). */
  const pairOf = (href, code) => {
    const base = P && href.startsWith(`${P}/`) ? href.slice(P.length) : href;
    return code === 'en' ? base : `${DE_PREFIX}${base}`;
  };
  function layout({ type, href, title, description, og, noindex = false, jsonld = [], breadcrumb = null }) {
    const scripts = [...SCRIPTS_ALL, ...(SCRIPTS_BY_TYPE[type] || [])].map((name) => ({
      src: assets.scripts[name],
      ga_id: name === 'consent.js' ? site.ga_measurement_id : '',
    }));
    const current = (h) => !noindex && h === href;
    return {
      lang,
      t: T,
      page: {
        type,
        lang,
        href,
        locale: L.locale,
        locale_alt: LANGS.filter((c) => c !== lang).map((c) => ({ locale: I18N[c].locale })),
        // hreflang pairs and x-default (English) on every indexable page
        alternates: noindex ? [] : [...LANGS.map((c) => ({ hreflang: c, href: `${SITE}${pairOf(href, c)}` })), { hreflang: 'x-default', href: `${SITE}${pairOf(href, 'en')}` }],
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
        home: `${P}/`,
        // language switch: one flag per language, linking to the same page in that language
        langs: LANGS.map((c) => ({
          code: c,
          label: I18N[c].name,
          href: noindex ? (c === 'en' ? '/' : `${DE_PREFIX}/`) : pairOf(href, c),
          current: c === lang,
          flag: templates.partials[`icon-flag-${c}`].trim(),
        })),
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
      consent: {
        text: L.consent_text,
        privacy_href: privacy ? `${P}/${privacy.key}/` : '',
        privacy_label: privacy ? privacy.label : '',
        imprint_href: imprint ? `${P}/${imprint.key}/` : '',
        imprint_label: imprint ? imprint.label : '',
      },
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
      href: `${P}/`,
      title: site.seo_title,
      description: site.seo_description,
      og: ogFor(site.images.og_default, imageAlt(site.images.og_default, L.painting_by(site.name)), 'site.images.og_default'),
      jsonld: [
        { '@context': 'https://schema.org', '@type': 'WebSite', '@id': WEBSITE_ID, url: `${SITE}/`, name: site.name, inLanguage: LANGS, publisher: { '@id': PERSON_ID } },
        { '@context': 'https://schema.org', ...person() },
      ],
    });
    view.page.noscript_css += NOSCRIPT_HOME_CSS;
    view.hero = {
      play_label: T.play,
      pause_label: T.pause,
      video_title: T.video_title,
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
    add({ type: 'home', file: `${P.slice(1)}${P ? '/' : ''}index.html`, href: `${P}/`, template: 'home', view, indexable: true });
  }

  // ---------------------------------------------------------------- hubs and artworks
  for (const hub of data.hubs) {
    const url = `${SITE}${hubUrl(hub)}`;
    const trail = [{ label: T.home, href: `${P}/` }, { label: hub.label, href: hubUrl(hub) }];
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
          inLanguage: lang,
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
    add({ type: 'hub', file: `${P.slice(1)}${P ? '/' : ''}${hub.path}/index.html`, href: hubUrl(hub), template: 'hub', view, indexable: true });

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
        label: L.thumb_label(n + 1, a.images.length),
        image: picture(im.src, { alt: im.alt, sizes: coverSizesOf('thumb', im.src, `${a.slug} thumbnail ${n + 1}`), cls: 'artwork__thumb-img', low: true, where: `${a.slug} thumbnail ${n + 1}` }),
      })) : [];
      // every value is visible running text: a size in any of them ("Framed (wood and glass), 50 × 40 cm") keeps together
      const facts = [
        { key: 'medium', label: T.medium, value: a.medium },
        { key: 'size', label: T.size, value: sizeText(a) },
        ...(a.frame ? [{ key: 'frame', label: T.frame, value: a.frame }] : []),
        { key: 'year', label: T.year, value: String(a.year) },
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
            '@id': `${SITE}${pairOf(href, 'en')}#artwork`, // one artwork, two pages: the same @id in both languages
            inLanguage: lang,
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
      view2.hub = { key: hub.key, path: hub.path, label: hub.label, all_link: hub.all_link, pager_label: L.pager_label(hub.label), back_href: hubUrl(hub) };
      view2.artwork = {
        slug: a.slug,
        title: keepTogether(a.title), // h1 and the dialog label ("St. Albani ...")
        zoom_label: L.zoom_dialog(keepTogether(a.title)),
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
      add({ type: 'artwork', file: `${P.slice(1)}${P ? '/' : ''}${hub.path}/${a.slug}/index.html`, href, template: 'artwork', view: view2, indexable: true, artwork: a });
    });
  }

  /**
   * Story HTML (only rendered when story_confirmed): headings below the "Story" h2 (the highest one becomes h3),
   * <img> -> manifest <picture>, mailto: links to the artist tracked like the CTA, sizes and initials kept
   * together as in all other visible text.
   */
  function storyHtml(a) {
    let html = shiftHeadings(normalizeHtml(a.story_html), 3);
    html = html.replace(/<img\b[^>]*>/gi, (tag) => {
      const attr = (name) => {
        const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
        return m ? plainText(m[2] !== undefined ? m[2] : m[3]) : '';
      };
      const src = attr('src');
      if (!src) fail(`${a.slug}: <img> without src in story_html`);
      return renderPicture(picture(src, { alt: attr('alt'), sizes: SIZES.story, cls: 'artwork__story-image', where: `${a.slug} story_html` })).trim();
    });
    html = trackMailto(html, site.email, { 'data-track': 'contact', 'data-location': 'artwork', 'data-artwork-slug': a.slug });
    return keepTogetherHtml(html);
  }

  // ---------------------------------------------------------------- about, contact, legal, 404
  {
    const trail = [{ label: T.home, href: `${P}/` }, { label: T.about, href: `${P}/about/` }];
    const view = layout({
      type: 'about',
      href: `${P}/about/`,
      title: data.pages.about.seo_title,
      description: data.pages.about.seo_description,
      og: ogFor(site.images.photo, SITE_IMAGE_ALT.photo, 'site.images.photo'),
      breadcrumb: trail,
      jsonld: [
        {
          '@context': 'https://schema.org',
          '@type': 'AboutPage',
          url: `${SITE}${P}/about/`,
          name: L.about_name,
          description: data.pages.about.seo_description,
          inLanguage: lang,
          isPartOf: websiteRef(),
          mainEntity: person(),
        },
        breadcrumbLd(trail),
      ],
    });
    view.intro = intro({ lazy: false, moreLink: false });
    view.about_me = aboutMe({ heading: false });
    add({ type: 'about', file: `${P.slice(1)}${P ? '/' : ''}about/index.html`, href: `${P}/about/`, template: 'about', view, indexable: true });
  }
  {
    const trail = [{ label: T.home, href: `${P}/` }, { label: T.contact, href: `${P}/contact/` }];
    const view = layout({
      type: 'contact',
      href: `${P}/contact/`,
      title: data.pages.contact.seo_title,
      description: data.pages.contact.seo_description,
      og: ogFor(site.images.portrait, SITE_IMAGE_ALT.portrait, 'site.images.portrait'),
      breadcrumb: trail,
      jsonld: [
        {
          '@context': 'https://schema.org',
          '@type': 'ContactPage',
          url: `${SITE}${P}/contact/`,
          name: T.contact,
          description: data.pages.contact.seo_description,
          inLanguage: lang,
          isPartOf: websiteRef(),
          mainEntity: { '@id': PERSON_ID },
        },
        breadcrumbLd(trail),
      ],
    });
    view.contact = contact({ heading: false, lazy: false });
    add({ type: 'contact', file: `${P.slice(1)}${P ? '/' : ''}contact/index.html`, href: `${P}/contact/`, template: 'contact', view, indexable: true });
  }
  for (const l of legalPages) {
    const meta = (data.pages && data.pages[l.key]) || {};
    const href = `${P}/${l.key}/`;
    const trail = [{ label: T.home, href: `${P}/` }, { label: l.label, href }];
    const view = layout({
      type: l.key,
      href,
      title: meta.seo_title || l.title,
      description: meta.seo_description || l.description,
      og: ogFor(site.images.og_default, imageAlt(site.images.og_default, L.painting_by(site.name)), 'site.images.og_default'),
      breadcrumb: trail,
      jsonld: [
        { '@context': 'https://schema.org', '@type': 'WebPage', url: `${SITE}${href}`, name: l.label, inLanguage: lang, isPartOf: websiteRef() },
        breadcrumbLd(trail),
      ],
    });
    // the text as written (generator markup normalised), below the page h1, with the artist's mailto: links tracked
    // and sizes and initials kept together
    const legalHtml = trackMailto(shiftHeadings(normalizeHtml(data.legal[l.field]), 2), site.email, { 'data-track': 'contact', 'data-location': l.key });
    view.legal = { title: l.label, html: keepTogetherHtml(legalHtml) };
    add({ type: l.key, file: `${P.slice(1)}${P ? '/' : ''}${l.key}/index.html`, href, template: 'legal', view, indexable: true });
  }
  {
    const view = layout({ type: '404', href: `${P}/404.html`, title: `${T.not_found}${suffix}`, noindex: true });
    view.links = [{ href: `${P}/`, label: T.home }, ...navItems];
    add({ type: '404', file: `${P.slice(1)}${P ? '/' : ''}404.html`, href: `${P}/404.html`, template: '404', view, indexable: false });
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
  // every URL with its language alternates (the same pairs as the hreflang links of the page)
  const urls = pages.filter((p) => p.indexable).map((p) => {
    const lastmod = (p.artwork && p.artwork.updated) || data.site.lastmod;
    const links = p.view.page.alternates.map((a) => `\n    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${xmlEscape(a.href)}"/>`).join('');
    return `  <url>\n    <loc>${xmlEscape(`${data.site.url}${p.href}`)}</loc>${links}\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
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
  const dataDe = localizeData(data, readJson(path.join(rootDir, 'data.de.json'), 'data.de.json'));
  validateData(dataDe);
  const legalKeys = legalKeysOf(data, dataDe);
  const pages = [
    ...createContext(rootDir, data, manifest, assets, templates, 'en', legalKeys).pages,
    ...createContext(rootDir, dataDe, manifest, assets, templates, 'de', legalKeys).pages,
  ];
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
  build, localizeData, I18N, LANGS, cutAtWord, fitText, keepTogether, keepTogetherHtml, normalizeHtml, shiftHeadings, trackMailto, withoutTitleEcho, coverSizes, escapeHtml, plainText, serializeJsonLd, validateJsonLd,
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
