'use strict';
// Developer tools in the repository (not part of the site). /seo-report imports scripts/seo-report.py to reuse
// token() and call(), so the import must not run the report: no credentials read, no Google API calls (the URL
// Inspection quota is 2,000 a day), no output, no state file. `python3 scripts/seo-report.py <days>` runs it.
// Python runs with -B, so no bytecode cache is written into scripts/. Skips without python3.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const S = require('../lib/site');

const SCRIPT = path.join(S.ROOT, 'scripts', 'seo-report.py');
const IMPORT = [
  'import importlib.util, os',
  "spec = importlib.util.spec_from_file_location('seo_report', os.environ['SEO_REPORT_PY'])",
  'module = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(module)',
].join('\n');

/** Run Python code (no command-line arguments) with HOME in a fresh temporary folder and no credentials. */
function python(code) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'polina-seo-home-'));
  const res = spawnSync('python3', ['-B', '-c', code], {
    cwd: S.ROOT,
    env: { ...process.env, HOME: home, SEO_CREDENTIALS: path.join(home, 'no-credentials.json'), SEO_REPORT_PY: SCRIPT },
    encoding: 'utf8',
    timeout: 60000,
  });
  const files = S.walkFiles(home).map((f) => path.relative(home, f).split(path.sep).join('/'));
  fs.rmSync(home, { recursive: true, force: true });
  return { ...res, files };
}

describe('tools: scripts/seo-report.py', () => {
  test('importing it (as /seo-report does, to reuse token() and call()) runs nothing: no credentials are read, nothing is printed, no state file is written', (t) => {
    const res = python(`${IMPORT}\nassert callable(module.token) and callable(module.call) and callable(module.main)`);
    if (res.error && res.error.code === 'ENOENT') { t.skip('python3 is not installed'); return; }
    assert.equal(res.status, 0, `the import failed (it ran the report?):\n${res.stdout}${res.stderr}`);
    assert.equal(res.stdout, '', 'the import printed report output');
    assert.deepEqual(res.files, [], 'the import wrote files into HOME');
  });

  test('main() runs the whole report (here against stand-in API answers) and saves its summary in ~/.local/state', (t) => {
    // Stand-ins for the Google APIs and the live site: every report section runs, nothing leaves the machine.
    const code = `${IMPORT}
import datetime
calls = []
def call(url, body=None):
    calls.append(url)
    if 'searchAnalytics' in url:
        return {'rows': [{'keys': ['2026-10-01'] * len(body['dimensions']), 'clicks': 2, 'impressions': 40, 'ctr': 0.05, 'position': 8.5}]}
    if 'runReport' in url:
        return {'rows': [{'dimensionValues': [{'value': 'Germany'} for _ in body['dimensions']], 'metricValues': [{'value': '3'} for _ in body['metrics']]}]}
    if 'urlInspection' in url:
        return {'inspectionResult': {'indexStatusResult': {'coverageState': 'Submitted and indexed', 'googleCanonical': body['inspectionUrl']}}}
    raise AssertionError('unexpected API call ' + url)
module.call = call
module.fetch = lambda url: '<urlset><url><loc>https://polina-shvedko.art/</loc></url></urlset>'
module.first_hop = lambda url: (301, 'https://polina-shvedko.art/')
module.main(['7'])
assert any('urlInspection' in u for u in calls), 'no URL inspection without --no-index'
`;
    const res = python(code);
    if (res.error && res.error.code === 'ENOENT') { t.skip('python3 is not installed'); return; }
    assert.equal(res.status, 0, `main() failed:\n${res.stdout.slice(-2000)}${res.stderr}`);
    for (const heading of ['== Search Console, last 7 days ==', '== Index coverage ==', '== GA4, last 7 days, all countries ==', '== Site events, last 7 days ==']) {
      assert.ok(res.stdout.includes(heading), `the report has no "${heading}" section`);
    }
    const state = res.files.filter((f) => /^\.local\/state\/polina-shvedko\.art-seo\/\d{4}-\d{2}-\d{2}-7d\.json$/.test(f));
    assert.equal(state.length, 1, `expected one state file, found: ${JSON.stringify(res.files)}`);
  });
});
