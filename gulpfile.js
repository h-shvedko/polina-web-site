'use strict';
/*
 * Gulp 4 tasks for polina-shvedko.art (ADR-0003; implementation spec section 6). Every task returns its
 * stream or promise.
 *
 *   gulp build:site   clean -> css, fonts, js, static (parallel) -> pages   (what CI runs; no sharp needed)
 *   gulp build        img -> build:site                                      (npm run build)
 *   gulp img          scripts/images.js: WebP/JPEG variants + src/img/manifest.json (npm run image; needs sharp)
 *   gulp pages        scripts/build-site.js: every HTML page + sitemap.xml (aliases: html, sitemap)
 *   gulp clean        delete everything in the output directory except img/ (refuses a directory that
 *                     does not look like a site build, see assertSafeAppDir)
 *   gulp css | fonts | js (alias babel) | static     copy src/ files into the output directory
 *   gulp watch        build:site, then rebuild on changes + livereload       (npm run server-watch)
 *   gulp server       dev web server for the output directory
 *   gulp              watch, then server                                     (npm run server-start)
 *
 * Environment:
 *   APP_DIR          output directory (default app; relative to this folder or absolute). clean keeps
 *                    <APP_DIR>/img, also when it is a symlink, and never follows it.
 *   GULP_PORT        dev server port (default 7000), GULP_HOST its address (default 0.0.0.0)
 *   GULP_OPEN        0 = do not open a browser when the dev server starts (default 1)
 *   LIVERELOAD_PORT  livereload server of `gulp watch` (default 35729, the port docker-compose maps)
 *
 * Run as root (the docker-compose dev container on a bind mount), build-site.js and images.js give what they
 * write, and the folders gulp.dest creates, the owner of this folder (scripts/file-owner.js), so the host user
 * can still rebuild, pull and check out.
 */

const fs = require('fs');
const path = require('path');
const gulp = require('gulp');

const ROOT = __dirname;
const APP_DIR = path.resolve(ROOT, process.env.APP_DIR || 'app');
const SERVER_PORT = Number(process.env.GULP_PORT || 7000);
const SERVER_HOST = process.env.GULP_HOST || '0.0.0.0';
const SERVER_OPEN = process.env.GULP_OPEN !== '0';
const LIVERELOAD_PORT = Number(process.env.LIVERELOAD_PORT || 35729);

const CSS_GLOBS = ['src/css/**/*.css', '!src/css/webfonts/**'];
const FONT_GLOBS = ['src/css/webfonts/**'];
const JS_GLOBS = ['src/js/**/*.js'];
const STATIC_GLOBS = ['src/static/**', 'src/static/**/.*'];
// scripts/*.js: an edited build script is loaded again on the next rebuild (see fresh())
const PAGE_INPUTS = ['src/templates/**/*.mustache', 'data.json', 'src/img/manifest.json', 'scripts/build-site.js', 'scripts/file-owner.js'];

/* Top-level names a site build contains (besides the hub folders from data.json and the files of src/static/). */
const BUILD_ENTRIES = ['img', 'css', 'js', '.htaccess', 'robots.txt', 'sitemap.xml', 'index.html', '404.html', 'about', 'contact', 'imprint', 'privacy'];

/**
 * Refuse output directories whose cleaning would delete anything but an old build: the repository, src/, a
 * parent, the file system root, and any existing directory (other than <repo>/app) that holds something a
 * site build does not contain (a mistyped APP_DIR such as $HOME or the scratch folder). A site build holds the
 * names above, the hub folders and whatever src/static/ holds today (a Search Console verification file, ...).
 * A folder with other names still counts as an old build of this site when its sitemap.xml lists this site's
 * URLs: a file since removed from src/static/, or a hub folder since renamed, stays in the old build.
 */
function assertSafeAppDir(dir) {
  const inside = (child, parent) => {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  const protectedDirs = ['src', 'scripts', 'tests', 'node_modules', '.git', '.github', 'ADR', '.claude'].map((d) => path.join(ROOT, d));
  if (inside(ROOT, dir)) throw new Error(`APP_DIR ${dir} is the repository or one of its parents; refusing to clean it`);
  if (dir === path.parse(dir).root) throw new Error('APP_DIR must not be the file system root');
  for (const p of protectedDirs) if (inside(dir, p)) throw new Error(`APP_DIR ${dir} is inside ${p}; refusing to clean it`);
  if (dir === path.join(ROOT, 'app') || !fs.existsSync(dir)) return;
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8')) || {};
  } catch {
    /* no readable data.json: only the fixed names and src/static count */
  }
  const hubPaths = (Array.isArray(data.hubs) ? data.hubs : []).map((h) => h && h.path).filter(Boolean);
  let staticNames = [];
  try {
    staticNames = fs.readdirSync(path.join(ROOT, 'src', 'static'));
  } catch {
    /* no src/static */
  }
  const known = new Set([...BUILD_ENTRIES, ...hubPaths, ...staticNames]);
  const foreign = fs.readdirSync(dir).filter((name) => !known.has(name));
  if (!foreign.length) return;
  const siteUrl = data.site && typeof data.site.url === 'string' ? data.site.url.replace(/\/+$/, '') : '';
  let sitemap = '';
  try {
    sitemap = fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8');
  } catch {
    /* no sitemap: not a build of this site */
  }
  if (siteUrl && sitemap.includes(`<loc>${siteUrl}/</loc>`)) return; // an earlier build of this site
  throw new Error(`APP_DIR ${dir} does not look like a site build (it holds ${foreign.slice(0, 5).join(', ')}${foreign.length > 5 ? ', ...' : ''}); refusing to clean it. Use an empty or new directory.`);
}

/** require() a build script anew, so `gulp watch` runs the current version after an edit (not the cached one). */
function fresh(rel) {
  for (const id of Object.keys(require.cache)) {
    if (id.startsWith(path.join(ROOT, 'scripts') + path.sep)) delete require.cache[id];
  }
  return require(path.join(ROOT, rel));
}

/* ---------------------------------------------------------------------------------------------- */

function clean() {
  assertSafeAppDir(APP_DIR);
  fs.mkdirSync(APP_DIR, { recursive: true });
  for (const entry of fs.readdirSync(APP_DIR, { withFileTypes: true })) {
    if (entry.name === 'img') continue; // generated by `gulp img`; a directory or a symlink, never followed
    fs.rmSync(path.join(APP_DIR, entry.name), { recursive: true, force: true });
  }
  return Promise.resolve();
}

function css() {
  return gulp.src(CSS_GLOBS, { cwd: ROOT, base: path.join(ROOT, 'src', 'css') }).pipe(gulp.dest(path.join(APP_DIR, 'css')));
}

function fonts() {
  return gulp.src(FONT_GLOBS, { cwd: ROOT, base: path.join(ROOT, 'src', 'css', 'webfonts') }).pipe(gulp.dest(path.join(APP_DIR, 'css', 'webfonts')));
}

function js() {
  return gulp.src(JS_GLOBS, { cwd: ROOT, base: path.join(ROOT, 'src', 'js') }).pipe(gulp.dest(path.join(APP_DIR, 'js')));
}

/* src/static/** incl. dotfiles (.htaccess, robots.txt) -> the output root */
function statics() {
  return gulp.src(STATIC_GLOBS, { cwd: ROOT, base: path.join(ROOT, 'src', 'static'), dot: true }).pipe(gulp.dest(APP_DIR));
}
statics.displayName = 'static';

function pages() {
  return fresh('scripts/build-site.js').build({ root: ROOT, outDir: APP_DIR, log: console.log });
}

function img() {
  return fresh('scripts/images.js').run({ root: ROOT, appDir: APP_DIR });
}

gulp.task('clean', clean);
gulp.task('css', css);
gulp.task('fonts', fonts);
gulp.task('js', js);
gulp.task('babel', js); // old name, kept for muscle memory: nothing is transpiled
gulp.task('static', statics);
gulp.task('pages', pages);
gulp.task('html', pages);
gulp.task('sitemap', pages);
gulp.task('img', img);
gulp.task('build:site', gulp.series(clean, gulp.parallel(css, fonts, js, statics), pages));
gulp.task('build', gulp.series(img, 'build:site'));

/* ---------------------------------------------------------------------------------------------- */

function watchFiles() {
  const livereload = require('gulp-livereload');
  livereload.listen({ port: LIVERELOAD_PORT, quiet: true });
  const reload = () => {
    livereload.reload();
    return Promise.resolve();
  };
  // Polling, as before: file events do not reach the Docker container through the bind mount.
  const opts = { cwd: ROOT, interval: 1000, usePolling: true };
  // CSS and JS URLs carry a content hash (?v=), so the pages are rebuilt after every CSS or JS change.
  gulp.watch(CSS_GLOBS, opts, gulp.series(css, pages, reload));
  gulp.watch(FONT_GLOBS, opts, gulp.series(fonts, pages, reload));
  gulp.watch(JS_GLOBS, opts, gulp.series(js, pages, reload));
  gulp.watch(STATIC_GLOBS, opts, gulp.series(statics, reload));
  gulp.watch(PAGE_INPUTS, opts, gulp.series(pages, reload));
  console.log(`watching src/ and data.json; livereload on port ${LIVERELOAD_PORT}; output ${APP_DIR}`);
  return Promise.resolve();
}

function server() {
  const webserver = require('gulp-webserver');
  if (!fs.existsSync(APP_DIR)) throw new Error(`${APP_DIR} does not exist; run "npm run build:site" first`);
  return gulp.src(APP_DIR, { read: false }).pipe(webserver({ host: SERVER_HOST, port: SERVER_PORT, open: SERVER_OPEN }));
}

gulp.task('watch', gulp.series('build:site', watchFiles));
gulp.task('server', server);
gulp.task('default', gulp.series('watch', 'server'));
