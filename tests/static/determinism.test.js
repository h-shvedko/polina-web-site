'use strict';
// SPEC 12.14: build determinism. scripts/build-site.js is run twice into two empty temporary directories;
// the outputs must be byte-identical (no timestamps, stable ordering). build() must not depend on files
// already present in outDir (compute the ?v= hashes from src/).
const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');

const BUILD_SCRIPT = path.join(S.ROOT, 'scripts', 'build-site.js');
const tmpDirs = [];

function listFiles(dir) {
  return S.walkFiles(dir).map((f) => path.relative(dir, f).split(path.sep).join('/'));
}

describe('14. build determinism', () => {
  after(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });

  test('scripts/build-site.js run twice into two temp dirs gives byte-identical files', { timeout: 300000 }, async () => {
    assert.ok(fs.existsSync(BUILD_SCRIPT), `missing ${BUILD_SCRIPT}`);
    const mod = require(BUILD_SCRIPT);
    assert.equal(typeof mod.build, 'function', 'scripts/build-site.js must export build({ root, outDir })');
    const outs = [];
    for (let i = 0; i < 2; i++) {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `polina-build-${i + 1}-`));
      tmpDirs.push(outDir);
      await mod.build({ root: S.ROOT, outDir });
      outs.push(outDir);
    }
    const [a, b] = outs.map(listFiles);
    assert.ok(a.length > 0, 'build-site wrote no files');
    const problems = [];
    const setB = new Set(b);
    for (const f of a) if (!setB.has(f)) problems.push(`${f}: only in the first build`);
    for (const f of b) if (!a.includes(f)) problems.push(`${f}: only in the second build`);
    for (const f of a.filter((x) => setB.has(x))) {
      const x = fs.readFileSync(path.join(outs[0], f));
      const y = fs.readFileSync(path.join(outs[1], f));
      if (!x.equals(y)) {
        let k = 0;
        while (k < x.length && x[k] === y[k]) k++;
        problems.push(`${f}: differs at byte ${k}: "${x.slice(Math.max(0, k - 20), k + 30).toString('utf8').replace(/\s+/g, ' ')}" vs "${y.slice(Math.max(0, k - 20), k + 30).toString('utf8').replace(/\s+/g, ' ')}"`);
      }
    }
    expectNone(problems, 'build output is not deterministic');
  });

  test('build-site writes every expected page and sitemap.xml into outDir', { timeout: 300000 }, async () => {
    assert.ok(fs.existsSync(BUILD_SCRIPT), `missing ${BUILD_SCRIPT}`);
    const mod = require(BUILD_SCRIPT);
    assert.equal(typeof mod.build, 'function', 'scripts/build-site.js must export build({ root, outDir })');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polina-build-pages-'));
    tmpDirs.push(outDir);
    await mod.build({ root: S.ROOT, outDir });
    const files = new Set(listFiles(outDir));
    const missing = S.sitePages().map((p) => p.file).filter((f) => !files.has(f));
    if (!files.has('sitemap.xml')) missing.push('sitemap.xml');
    expectNone(missing, 'build-site did not write');
  });
});
