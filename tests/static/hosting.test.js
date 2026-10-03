'use strict';
// SPEC 12.13: hosting files. app/.htaccess must be the copy of src/static/.htaccess (the redirect behaviour
// itself is tested against a real Apache in tests/apache/redirects.test.js).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');

const STATIC_DIR = path.join(S.ROOT, 'src', 'static');
const SRC_HTACCESS = path.join(STATIC_DIR, '.htaccess');

describe('13. hosting files (.htaccess, robots.txt)', () => {
  test('app/.htaccess exists and equals src/static/.htaccess byte for byte', () => {
    assert.ok(fs.existsSync(SRC_HTACCESS), `missing ${SRC_HTACCESS} (the deployed .htaccess source, SPEC section 10)`);
    const appHtaccess = path.join(S.APP_DIR, '.htaccess');
    assert.ok(fs.existsSync(appHtaccess), `missing ${appHtaccess}: gulp "static" must copy dotfiles from src/static/ to app/`);
    assert.ok(fs.readFileSync(appHtaccess).equals(fs.readFileSync(SRC_HTACCESS)), `${appHtaccess} differs from ${SRC_HTACCESS}; never edit app/.htaccess`);
  });

  test('every file in src/static/ (incl. dotfiles) is copied unchanged to app/', () => {
    assert.ok(fs.existsSync(STATIC_DIR), `missing ${STATIC_DIR}`);
    const problems = [];
    for (const abs of S.walkFiles(STATIC_DIR)) {
      const rel = path.relative(STATIC_DIR, abs).split(path.sep).join('/');
      const out = S.appFile(rel);
      if (!fs.existsSync(out)) problems.push(`${rel}: missing in app/`);
      else if (!fs.readFileSync(out).equals(fs.readFileSync(abs))) problems.push(`${rel}: app/ copy differs from src/static/`);
    }
    expectNone(problems, 'static files not copied');
  });

  test('the repository root has no .htaccess (it never deployed; the source is src/static/.htaccess)', () => {
    assert.ok(!fs.existsSync(path.join(S.ROOT, '.htaccess')), `${path.join(S.ROOT, '.htaccess')} still exists; move it to src/static/.htaccess`);
  });

  test('src/static/.htaccess has the SPEC section 10 directives (404 page, no listings, blog/partials rules, https and apex)', () => {
    assert.ok(fs.existsSync(SRC_HTACCESS), `missing ${SRC_HTACCESS}`);
    const h = fs.readFileSync(SRC_HTACCESS, 'utf8');
    const want = [
      [/^\s*ErrorDocument\s+404\s+\/404\.html\s*$/m, 'ErrorDocument 404 /404.html'],
      [/^\s*Options\s+-Indexes\s*$/m, 'Options -Indexes'],
      [/^\s*DirectoryIndex\s+index\.html\s*$/m, 'DirectoryIndex index.html'],
      [/^\s*RewriteEngine\s+On\s*$/m, 'RewriteEngine On'],
      [/blog\/cap-dantibes.*https:\/\/polina-shvedko\.art\/oil-paintings\/affectionate-farewell-cap-dantibes\/.*R=301/, 'blog/cap-dantibes -> artwork page (301)'],
      [/\^blog.*https:\/\/polina-shvedko\.art\/\s.*R=301/, '/blog -> / (301)'],
      [/\^partials.*\[G/, '/partials -> 410 Gone'],
      [/index\\\.html/, '/index.html -> directory URL'],
      [/HTTP_HOST.*\^www\\\./i, 'www -> apex'],
      [/X-Forwarded-Proto/i, 'http -> https (X-Forwarded-Proto aware)'],
    ];
    expectNone(want.filter(([re]) => !re.test(h)).map(([, label]) => label), 'directives missing in src/static/.htaccess');
  });
});
