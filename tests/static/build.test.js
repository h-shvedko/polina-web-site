'use strict';
// The build scripts themselves: failures that must stop a build, line endings, file ownership in the dev
// container, the safety of `gulp clean`, and `gulp watch` picking up an edited build script. Independent of
// APP_DIR: every build here goes into a temporary directory.
const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');
const { build, withoutTitleEcho, keepTogether } = require('../../scripts/build-site.js');
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

  test('text helpers: a repeated title becomes "It" and its credit stays ("Inspired by P. Molina, it ..."); sizes and initials keep a no-break space', () => {
    assert.equal(withoutTitleEcho('Cala Secreta: A Costa Brava Hideaway', '"Cala Secreta: A Costa Brava Hideaway" (Inspired by P. Molina) reveals a cove.'), 'Inspired by P. Molina, it reveals a cove.');
    assert.equal(withoutTitleEcho('Evening Glow', '"Evening Glow (Inspired by P. Molina)" casts a pink hue.'), 'Inspired by P. Molina, it casts a pink hue.');
    assert.equal(withoutTitleEcho('Boats', 'Boats (after C. Monet) depicts boats.'), 'After C. Monet, it depicts boats.');
    assert.equal(withoutTitleEcho('Whispers of the Wind', '"Whispers of the Wind" captures a cove.'), 'It captures a cove.');
    assert.equal(withoutTitleEcho('Whispers', 'Whispers. A cove at dusk.'), 'Whispers. A cove at dusk.', 'no verb after the title: unchanged');
    assert.equal(withoutTitleEcho('Whispers', 'This painting is called Whispers.'), 'This painting is called Whispers.');
    assert.equal(keepTogether('Framed (wood and glass), 50 × 40 cm'), 'Framed (wood and glass), 50\u00a0×\u00a040\u00a0cm');
    assert.equal(keepTogether('St. Albani in the Afternoon, after P. Molina'), 'St.\u00a0Albani in the Afternoon, after P.\u00a0Molina');
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
    for (const f of ['gulpfile.js', 'data.json', 'package.json']) fs.copyFileSync(path.join(S.ROOT, f), path.join(root, f));
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
