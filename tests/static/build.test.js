'use strict';
// The build scripts themselves: failures that must stop a build, the text helpers, the documented owner steps
// (confirm the story, add the legal texts), line endings, file ownership in the dev container, the safety of
// `gulp clean`, and `gulp watch` picking up an edited build script. Independent of APP_DIR: every build here
// goes into a temporary directory.
const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { expectNone, headingProblems, findForbidden, findCyrillic } = require('../lib/checks');
const { parseHtml, qs, qsa, attr, breakingSpaceProblems } = require('../lib/html');
const S = require('../lib/site');
const { build, withoutTitleEcho, keepTogether, keepTogetherHtml, normalizeHtml } = require('../../scripts/build-site.js');
const { matchOwner } = require('../../scripts/file-owner.js');

const GULP = path.join(S.ROOT, 'node_modules', 'gulp', 'bin', 'gulp.js');
const tmpDirs = [];
const tmp = (name) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `polina-${name}-`));
  tmpDirs.push(d);
  return d;
};

/** A copy of the build inputs (data.json, manifest, templates, CSS, fonts, JS) in a temporary root. */
function copyRoot() {
  const root = tmp('root');
  fs.copyFileSync(path.join(S.ROOT, 'data.json'), path.join(root, 'data.json'));
  fs.copyFileSync(S.DATA_DE_FILE, path.join(root, 'data.de.json'));
  for (const dir of ['src/templates', 'src/css', 'src/js']) fs.cpSync(path.join(S.ROOT, dir), path.join(root, dir), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'img'), { recursive: true });
  fs.copyFileSync(S.MANIFEST_FILE, path.join(root, 'src', 'img', 'manifest.json'));
  return root;
}

function listFiles(dir) {
  return S.walkFiles(dir).map((f) => path.relative(dir, f).split(path.sep).join('/'));
}

function gulp(task, appDir) {
  return spawnSync(process.execPath, [GULP, task, '--cwd', S.ROOT], { cwd: S.ROOT, env: { ...process.env, APP_DIR: appDir }, encoding: 'utf8', timeout: 120000 });
}

describe('build scripts', () => {
  after(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });

  test('a mistyped {{> partial}} stops the build with the template and partial name (Mustache would render it as nothing)', async () => {
    const root = copyRoot();
    const foot = path.join(root, 'src', 'templates', 'partials', 'foot.mustache');
    fs.writeFileSync(foot, fs.readFileSync(foot, 'utf8').replace('{{> footer}}', '{{> fotter}}'));
    await assert.rejects(build({ root, outDir: tmp('out') }), /unknown partial[\s\S]*partials\/foot\.mustache: \{\{> fotter\}\}/);
  });

  test('a partial referenced only inside a section that this data never renders is checked as well', async () => {
    const root = copyRoot();
    const page = path.join(root, 'src', 'templates', 'pages', 'artwork.mustache');
    fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('{{#artwork.story}}', '{{#artwork.story}}{{> stroy-heading}}'));
    await assert.rejects(build({ root, outDir: tmp('out') }), /unknown partial[\s\S]*stroy-heading/);
  });

  test('an artwork field the build does not read (a typo or a leftover) stops the build', async () => {
    const root = copyRoot();
    const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
    data.hubs[0].artworks[0].seo_titel = 'typo';
    fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify(data, null, 2));
    await assert.rejects(build({ root, outDir: tmp('out') }), /unknown field\(s\) seo_titel/);
  });

  test('the German pages need their texts: an artwork without its data.de.json entry, or a legal text in one language only, stops the build', async () => {
    const root = copyRoot();
    const file = path.join(root, 'data.de.json');
    const de = JSON.parse(fs.readFileSync(file, 'utf8'));
    const slug = Object.keys(de.artworks)[0];
    delete de.artworks[slug];
    fs.writeFileSync(file, JSON.stringify(de, null, 2));
    await assert.rejects(build({ root, outDir: tmp('out') }), new RegExp(`data\\.de\\.json artworks\\.${slug} is missing`));
    const root2 = copyRoot();
    const file2 = path.join(root2, 'data.de.json');
    const de2 = JSON.parse(fs.readFileSync(file2, 'utf8'));
    de2.legal.imprint_html = null;
    fs.writeFileSync(file2, JSON.stringify(de2, null, 2));
    await assert.rejects(build({ root: root2, outDir: tmp('out2') }), /legal\.imprint_html must be set in data\.json and data\.de\.json, or in neither/);
  });

  test('text helpers: a repeated title becomes "It" and its credit stays ("Inspired by P. Molina, it ..."); sizes and initials keep a no-break space', () => {
    assert.equal(withoutTitleEcho('Cala Secreta: A Costa Brava Hideaway', '"Cala Secreta: A Costa Brava Hideaway" (Inspired by P. Molina) reveals a cove.'), 'Inspired by P. Molina, it reveals a cove.');
    assert.equal(withoutTitleEcho('Evening Glow', '"Evening Glow (Inspired by P. Molina)" casts a pink hue.'), 'Inspired by P. Molina, it casts a pink hue.');
    assert.equal(withoutTitleEcho('Boats', 'Boats (after C. Monet) depicts boats.'), 'After C. Monet, it depicts boats.');
    assert.equal(withoutTitleEcho('Whispers of the Wind', '"Whispers of the Wind" captures a cove.'), 'It captures a cove.');
    assert.equal(withoutTitleEcho('Whispers', 'Whispers. A cove at dusk.'), 'Whispers. A cove at dusk.', 'no verb after the title: unchanged');
    assert.equal(withoutTitleEcho('Whispers', 'This painting is called Whispers.'), 'This painting is called Whispers.');
    assert.equal(keepTogether('Framed (wood and glass), 50 × 40 cm'), 'Framed (wood and glass), 50\u00a0×\u00a040\u00a0cm');
    assert.equal(keepTogether('St. Albani in the Afternoon, after P. Molina'), 'St.\u00a0Albani in the Afternoon, after P.\u00a0Molina');
    assert.equal(keepTogether('190 ×\n45\tcm'), '190\u00a0×\u00a045\u00a0cm', 'a line break in the source wraps like a space');
    // HTML (story_html, legal texts): only the text between tags changes; entities count as the characters they stand for
    assert.equal(keepTogetherHtml('<p title="50 × 40 cm">50 × 40 cm, <em>St. Albani</em></p>'), '<p title="50 × 40 cm">50\u00a0×\u00a040\u00a0cm, <em>St.\u00a0Albani</em></p>');
    assert.equal(keepTogetherHtml('<a href="/x" title="a > b, P. Molina">P. Molina</a><!-- 5 cm --><style>p::after{content:"5 cm"}</style>'), '<a href="/x" title="a > b, P. Molina">P.\u00a0Molina</a><!-- 5 cm --><style>p::after{content:"5 cm"}</style>');
    assert.equal(keepTogetherHtml('190&nbsp;&times; 45 cm, 29,7 &#215;&#xA0;42&#160;cm, the EU-U.S. Data Privacy Framework'), '190&nbsp;&times;\u00a045\u00a0cm, 29,7\u00a0&#215;&#xA0;42&#160;cm, the EU-U.S.\u00a0Data Privacy Framework');
  });

  test('normalizeHtml(): generator markup in pasted HTML (<br />, trailing blanks, inline style, <a name>, target=_blank) gets the site\'s markup style; text, comments and quoted values stay as written', () => {
    const cases = [
      ['<p>A<br />\nB<br/>   \nC<br\n/></p>', '<p>A<br>\nB<br>\nC<br></p>'],
      ['<hr />\n<img src="x.jpg" alt="a" />', '<hr>\n<img src="x.jpg" alt="a">'],
      ['<p style="margin:0" class="x">t</p>', '<p class="x">t</p>'],
      ['<a name="eu"></a><a id="k" name="k"></a>', '<a id="eu"></a><a id="k"></a>'],
      ['<a href="https://e.org" target="_blank">x</a>', '<a href="https://e.org" target="_blank" rel="noopener">x</a>'],
      ['<a href="https://e.org" target="_blank" rel="noreferrer">y</a>', '<a href="https://e.org" target="_blank" rel="noreferrer">y</a>'],
      ['<!-- <br /> style="x" -->', '<!-- <br /> style="x" -->'],
      ['<p title="a/>b, style=x">2 <br> 3</p>', '<p title="a/>b, style=x">2 <br> 3</p>'],
    ];
    for (const [input, want] of cases) assert.equal(normalizeHtml(input), want, `normalizeHtml(${JSON.stringify(input)})`);
  });

  test('the owner step "paste a generated legal text" (German imprint markup with <br />, <hr />, trailing blanks, inline styles, <a name>, target=_blank and words such as "shop") builds a legal page that passes html-validate and the content checks of every page', async () => {
    const root = copyRoot();
    const file = path.join(root, 'data.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    // a sample shaped like the output of common imprint generators (not legal advice)
    data.legal.imprint_html = [
      '<h1>Impressum</h1>',
      '<h2>Angaben gem&auml;&szlig; &sect; 5 DDG</h2>',
      '<p>Polina Shvedko<br />',
      'Musterstra&szlig;e 1<br />   ',
      '12345 Musterstadt</p>',
      `<p style="margin-top:10px">Telefon: +49 123 456789<br/>`,
      `E-Mail: <a href="mailto:${data.site.email}">${data.site.email}</a></p>`,
      '<h2><a name="streit"></a>Verbraucherstreitbeilegung</h2>',
      '<p>Plattform der EU-Kommission: <a href="https://ec.europa.eu/consumers/odr/" target="_blank">https://ec.europa.eu/consumers/odr/</a>. Our Etsy shop is run by Etsy.</p>',
      '<hr />',
      '<p>Quelle: <a href="https://www.e-recht24.de" target="_blank" rel="noopener noreferrer">eRecht24</a></p>',
    ].join('\n');
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    const out = tmp('out-generated-legal');
    await build({ root, outDir: out });
    const page = path.join(out, 'imprint', 'index.html');
    assert.ok(fs.existsSync(page), 'imprint/index.html was not built');
    const html = fs.readFileSync(page, 'utf8');
    const { HtmlValidate } = require('html-validate');
    const validator = new HtmlValidate(JSON.parse(fs.readFileSync(path.join(S.ROOT, '.htmlvalidate.json'), 'utf8')));
    const report = await validator.validateString(html, page);
    const problems = report.results.flatMap((r) => r.messages.map((m) => `${m.line}:${m.column} ${m.ruleId}: ${m.message}`));
    // the content checks of tests/static/content.test.js for legal pages: no Tilda, no Cyrillic (sales words are
    // allowed in a legal text, which must stay as the owner pasted it)
    problems.push(...findForbidden(html, { skipSalesWords: true }).map((h) => `[${h.label}] ${h.excerpt}`));
    problems.push(...findCyrillic(html).map((h) => `Cyrillic: ${JSON.stringify(h)}`));
    if (!html.includes('<a id="streit"></a>')) problems.push('<a name> was not turned into <a id>');
    if (!/href="https:\/\/ec\.europa\.eu\/consumers\/odr\/" target="_blank" rel="noopener"/.test(html)) problems.push('target=_blank link without rel="noopener"');
    expectNone(problems, 'generated legal text');
  });

  test('the owner steps "confirm the story" (story_confirmed: true) and "add the legal texts" (legal.imprint_html, legal.privacy_html) build pages that keep the rules of every page: sizes and initials with a no-break space, one h1 and no skipped heading level (also for a legal text with its own h1), the artist\'s mailto: links tracked; tags, attributes and comments stay as written', async () => {
    const root = copyRoot();
    const file = path.join(root, 'data.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const story = data.hubs.flatMap((hub) => hub.artworks.map((artwork) => ({ hub, artwork }))).find((x) => typeof x.artwork.story_html === 'string');
    assert.ok(story, 'no artwork in data.json has a story_html');
    story.artwork.story_confirmed = true;
    // sample texts (not legal advice), shaped like generated legal texts: an own <h1>, the artist's e-mail as a
    // mailto: link, another address, a size, initials, an attribute and a comment that must stay as written
    const LINK = '<a href="https://example.org/" title="St. Albani, 50 × 40 cm">P. Molina</a>';
    data.legal.imprint_html = `<h1>Imprint</h1>\n<h2>Contact</h2>\n<p>E-mail: <a href="mailto:${data.site.email}">${data.site.email}</a></p>\n<p>Works such as St. Albani in the Afternoon (42 × 29.7 cm) after ${LINK}.</p>`;
    data.legal.privacy_html = '<h2>Google Analytics</h2>\n<p>Google LLC is certified under the EU-U.S. Data Privacy Framework.</p>\n<h3>Your rights</h3>\n<p>Authority: <a href="mailto:office@authority.example">office@authority.example</a></p>\n<p>A size written with entities: 190&nbsp;&times; 45\ncm.</p><!-- 50 × 40 cm -->';
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    const out = tmp('out-story-legal');
    await build({ root, outDir: out });
    const pages = [`${story.hub.path}/${story.artwork.slug}/index.html`, 'imprint/index.html', 'privacy/index.html'];
    const problems = [];
    const html = {};
    for (const f of pages) {
      if (!fs.existsSync(path.join(out, f))) { problems.push(`${f}: not built`); continue; }
      html[f] = fs.readFileSync(path.join(out, f), 'utf8');
      const doc = parseHtml(html[f]);
      problems.push(...breakingSpaceProblems(qs(doc, 'body')).map((p) => `${f}: ${p}`));
      // the rules of every page (pages.test.js, markup-contract.test.js): one h1, no skipped level, tracked mailto: links
      const levels = qsa(doc, 'h1, h2, h3, h4, h5, h6').map((h) => Number(h.tag[1]));
      if (levels.filter((l) => l === 1).length !== 1) problems.push(`${f}: ${levels.filter((l) => l === 1).length} h1 elements`);
      problems.push(...headingProblems(levels).map((p) => `${f}: ${p} (outline ${levels.map((l) => `h${l}`).join(' ')})`));
      const where = f.startsWith('imprint/') ? 'imprint' : f.startsWith('privacy/') ? 'privacy' : 'artwork';
      for (const a of qsa(doc, `a[href^="mailto:${data.site.email}"]`)) {
        if (attr(a, 'data-track') !== 'contact' || attr(a, 'data-location') !== where) problems.push(`${f}: ${attr(a, 'href')} has data-track=${attr(a, 'data-track')}, data-location=${attr(a, 'data-location')} (expected contact, ${where})`);
      }
    }
    if (html[pages[0]] && !html[pages[0]].includes('<section class="artwork__story"')) problems.push(`${pages[0]}: no Story section`);
    if (html['imprint/index.html'] && !/<a href="mailto:[^"]+" data-track="contact" data-location="imprint">/.test(html['imprint/index.html'])) problems.push('imprint/index.html: the mailto: link to the artist is not tracked');
    const keep = {
      'imprint/index.html': [LINK.replace('>P. Molina<', '>P.\u00a0Molina<')],
      'privacy/index.html': ['<a href="mailto:office@authority.example">office@authority.example</a>', '<!-- 50 × 40 cm -->'],
    };
    for (const [f, list] of Object.entries(keep)) for (const want of list) if (html[f] && !html[f].includes(want)) problems.push(`${f}: ${JSON.stringify(want)} was changed`);
    expectNone(problems, 'story and legal pages');
  });

  test('a checkout with CRLF line endings (core.autocrlf=true) builds byte-identical pages and ?v= hashes', async () => {
    const root = copyRoot();
    for (const f of S.walkFiles(path.join(root, 'src')).filter((x) => /\.(mustache|css|js|json)$/.test(x))) {
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\r?\n/g, '\r\n'));
    }
    fs.writeFileSync(path.join(root, 'data.json'), fs.readFileSync(path.join(root, 'data.json'), 'utf8').replace(/\r?\n/g, '\r\n'));
    const lf = tmp('out-lf');
    const crlf = tmp('out-crlf');
    await build({ root: S.ROOT, outDir: lf });
    await build({ root, outDir: crlf });
    const problems = [];
    for (const f of listFiles(lf)) {
      const b = path.join(crlf, f);
      if (!fs.existsSync(b)) problems.push(`${f}: missing in the CRLF build`);
      else if (!fs.readFileSync(path.join(lf, f)).equals(fs.readFileSync(b))) problems.push(`${f}: differs`);
    }
    expectNone(problems, 'CRLF checkout builds different files');
  });

  test('as root (the dev container), generated files get the owner of the repository; symlinks are not followed; otherwise nothing changes', () => {
    const entries = {
      '/repo': { uid: 1000, gid: 1000, dir: ['app'] },
      '/repo/app': { uid: 0, gid: 0, dir: ['index.html', 'css', 'img'] },
      '/repo/app/index.html': { uid: 0, gid: 0 },
      '/repo/app/css': { uid: 1000, gid: 1000, dir: ['site.css'] },
      '/repo/app/css/site.css': { uid: 1000, gid: 1000 },
      '/repo/app/img': { uid: 0, gid: 0, link: true }, // a symlink: changed itself, never followed
    };
    const calls = [];
    const io = (uid) => ({
      getuid: () => uid,
      lstat: (p) => ({ uid: entries[p].uid, gid: entries[p].gid, isDirectory: () => Boolean(entries[p].dir) }),
      readdir: (p) => entries[p].dir,
      lchown: (p, u, g) => calls.push(`${p} ${u}:${g}`),
    });
    assert.equal(matchOwner('/repo', ['/repo/app'], io(0)), 3);
    assert.deepEqual(calls, ['/repo/app 1000:1000', '/repo/app/index.html 1000:1000', '/repo/app/img 1000:1000']);
    calls.length = 0;
    assert.equal(matchOwner('/repo', ['/repo/app'], io(1000)), 0, 'a normal user changes nothing');
    assert.deepEqual(calls, []);
    entries['/repo'].uid = 0;
    assert.equal(matchOwner('/repo', ['/repo/app'], io(0)), 0, 'a checkout owned by root stays as it is');
    if (!(process.getuid && process.getuid() === 0)) assert.equal(matchOwner(S.ROOT, [tmp('owner')]), 0, 'a real call as a normal user');
  });

  test('gulp clean refuses an APP_DIR that holds anything but a site build, and leaves it untouched', () => {
    const dir = tmp('foreign');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me');
    fs.mkdirSync(path.join(dir, 'my-project', 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'my-project', 'src', 'main.c'), 'int main(void) { return 0; }\n');
    const res = gulp('clean', dir);
    assert.notEqual(res.status, 0, `gulp clean succeeded on ${dir}:\n${res.stdout}`);
    assert.match(`${res.stdout}${res.stderr}`, /does not look like a site build/);
    assert.deepEqual(listFiles(dir).sort(), ['my-project/src/main.c', 'notes.txt']);
  });

  test('gulp clean empties an old site build except img/ (and a new private build folder with only img/ is accepted)', () => {
    const dir = tmp('oldbuild');
    for (const f of ['index.html', 'sitemap.xml', '404.html', '.htaccess', 'css/site.css', 'about/index.html', `${S.loadData().hubs[0].path}/index.html`, 'img/a.webp']) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), 'x');
    }
    const res = gulp('clean', dir);
    assert.equal(res.status, 0, `gulp clean failed:\n${res.stdout}${res.stderr}`);
    assert.deepEqual(listFiles(dir), ['img/a.webp']);
    const again = gulp('clean', dir);
    assert.equal(again.status, 0, `gulp clean on a folder with only img/ failed:\n${again.stdout}${again.stderr}`);
  });

  test('a private build can run again into the same APP_DIR after src/static gains or loses a top-level file; a foreign folder with a sitemap.xml of another site is still refused', () => {
    // A copy of the repository (gulpfile, scripts, sources; node_modules linked), so src/static can change.
    const root = tmp('repo');
    for (const f of ['gulpfile.js', 'data.json', 'data.de.json', 'package.json']) fs.copyFileSync(path.join(S.ROOT, f), path.join(root, f));
    for (const dir of ['scripts', 'src/templates', 'src/css', 'src/js', 'src/static']) fs.cpSync(path.join(S.ROOT, dir), path.join(root, dir), { recursive: true });
    fs.mkdirSync(path.join(root, 'src', 'img'), { recursive: true });
    fs.copyFileSync(S.MANIFEST_FILE, path.join(root, 'src', 'img', 'manifest.json'));
    fs.symlinkSync(path.join(S.ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    const run = (task, appDir) => spawnSync(process.execPath, [path.join(root, 'node_modules', 'gulp', 'bin', 'gulp.js'), task], { cwd: root, env: { ...process.env, APP_DIR: appDir }, encoding: 'utf8', timeout: 120000 });
    const out = tmp('private');
    const verification = path.join(root, 'src', 'static', 'google0123456789abcdef.html');
    fs.writeFileSync(verification, 'google-site-verification: google0123456789abcdef.html\n');
    for (const step of ['first build', 'second build (the new static file is part of a build)']) {
      const res = run('build:site', out);
      assert.equal(res.status, 0, `${step} failed:\n${res.stdout}${res.stderr}`);
    }
    assert.ok(fs.existsSync(path.join(out, 'google0123456789abcdef.html')), 'the static file was not copied');
    fs.rmSync(verification);
    const again = run('build:site', out);
    assert.equal(again.status, 0, `the build after removing the static file failed (its old copy is part of the previous build):\n${again.stdout}${again.stderr}`);
    assert.ok(!fs.existsSync(path.join(out, 'google0123456789abcdef.html')), 'the removed static file is still in the output');
    const other = tmp('other-site');
    fs.writeFileSync(path.join(other, 'sitemap.xml'), '<?xml version="1.0"?><urlset><url><loc>https://example.org/</loc></url></urlset>\n');
    fs.writeFileSync(path.join(other, 'notes.txt'), 'keep me');
    const refused = run('clean', other);
    assert.notEqual(refused.status, 0, `gulp clean emptied a folder with another site's sitemap:\n${refused.stdout}`);
    assert.deepEqual(listFiles(other).sort(), ['notes.txt', 'sitemap.xml']);
  });

  test('gulp pages (what gulp watch reruns) loads scripts/build-site.js again, so an edit takes effect without a restart', () => {
    const out = tmp('watch');
    const script = `
      const path = require('path');
      const ROOT = ${JSON.stringify(S.ROOT)};
      const file = require.resolve(path.join(ROOT, 'scripts', 'build-site.js'));
      // the version an earlier rebuild loaded (now edited on disk): a fresh require must replace it
      require.cache[file] = { id: file, filename: file, loaded: true, exports: { build: async () => { throw new Error('the cached (old) build-site.js ran'); } } };
      const gulp = require(path.join(ROOT, 'node_modules', 'gulp'));
      require(path.join(ROOT, 'gulpfile.js'));
      gulp.series('pages')((err) => { if (err) { console.error(err.message); process.exit(1); } console.log('pages ok'); });
    `;
    const res = spawnSync(process.execPath, ['-e', script], { cwd: S.ROOT, env: { ...process.env, APP_DIR: out }, encoding: 'utf8', timeout: 120000 });
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.ok(fs.existsSync(path.join(out, 'index.html')), 'the pages task wrote no index.html');
  });
});
