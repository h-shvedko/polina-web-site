'use strict';
// SPEC 12 (Apache): app/.htaccess on a real Apache. Starts httpd:2.4 in Docker with mod_rewrite and
// AllowOverride All (httpd.conf built from the image default), APP_DIR mounted read-only, on a random local port.
// Host names are sent in the Host header; "https" requests carry X-Forwarded-Proto: https (as nginx on Plesk does).
// Redirects are not followed: status and Location are checked, then each Location is requested once and must
// answer 200 (one hop). Skips with a message when Docker or the httpd:2.4 image is not available.
//
// Env: APP_DIR (directory under test), APACHE_IMAGE (default httpd:2.4).
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const S = require('../lib/site');

const IMAGE = process.env.APACHE_IMAGE || 'httpd:2.4';
const data = S.loadData();
const APEX = new URL(S.siteUrl(data)).host;
const HUB = `/${(data.hubs[0] && data.hubs[0].path) || 'oil-paintings'}/`;
const SECOND_HUB = `/${(data.hubs[1] && data.hubs[1].path) || 'pastels'}/`;
const ARTWORK = '/oil-paintings/affectionate-farewell-cap-dantibes/';
const HTDOCS = '/usr/local/apache2/htdocs';
const CONF = '/usr/local/apache2/conf/httpd.conf';

function docker(args, timeout = 120000) {
  return spawnSync('docker', args, { encoding: 'utf8', timeout });
}

function skipReason() {
  const v = docker(['version', '--format', '{{.Server.Version}}'], 30000);
  if (v.error || v.status !== 0) return `Docker is not available (${v.error ? v.error.code || v.error.message : (v.stderr || '').trim().split('\n')[0]}); Apache redirect tests skipped`;
  const img = docker(['image', 'inspect', '--format', '{{.Id}}', IMAGE], 30000);
  if (img.status !== 0) return `Docker image ${IMAGE} is not present (run: docker pull ${IMAGE}); Apache redirect tests skipped`;
  return null;
}

/** The image's default httpd.conf with mod_rewrite loaded and AllowOverride All for the document root. */
function patchedConf() {
  const res = docker(['run', '--rm', '--entrypoint', 'cat', IMAGE, CONF]);
  if (res.status !== 0) throw new Error(`cannot read ${CONF} from ${IMAGE}: ${res.stderr}`);
  let conf = res.stdout;
  conf = conf.replace(/^#\s*(LoadModule\s+rewrite_module\s+\S+)/m, '$1');
  conf = conf.replace(/(<Directory\s+"\/usr\/local\/apache2\/htdocs">[\s\S]*?)AllowOverride\s+None([\s\S]*?<\/Directory>)/, '$1AllowOverride All$2');
  conf += '\nServerName localhost\n';
  if (!/^LoadModule\s+rewrite_module/m.test(conf)) throw new Error('could not enable mod_rewrite in the default httpd.conf');
  if (!/<Directory\s+"\/usr\/local\/apache2\/htdocs">[\s\S]*?AllowOverride All[\s\S]*?<\/Directory>/.test(conf)) throw new Error('could not set AllowOverride All for the document root');
  return conf;
}

const reason = skipReason();

describe(`apache: .htaccess redirects on ${IMAGE} (APP_DIR mounted read-only)`, { skip: reason || false }, () => {
  let name = null;
  let tmp = null;
  let port = null;

  const cleanup = () => {
    if (name) { docker(['rm', '-f', name], 60000); name = null; }
    if (tmp) { fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; }
  };

  function request(urlPath, { host = APEX, https = true } = {}) {
    return new Promise((resolve, reject) => {
      const headers = { Host: host, Connection: 'close' };
      if (https) headers['X-Forwarded-Proto'] = 'https';
      const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || null, body }));
      });
      req.setTimeout(15000, () => req.destroy(new Error(`timeout for ${urlPath}`)));
      req.on('error', reject);
      req.end();
    });
  }

  function errorLog() {
    const logs = name ? docker(['logs', '--tail', '15', name], 30000) : null;
    return logs ? `${logs.stdout}${logs.stderr}`.trim() : '';
  }

  before(async () => {
    assert.ok(fs.existsSync(S.APP_DIR), `APP_DIR does not exist: ${S.APP_DIR}`);
    process.once('exit', cleanup);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polina-apache-'));
    const confFile = path.join(tmp, 'httpd.conf');
    fs.writeFileSync(confFile, patchedConf());
    fs.chmodSync(tmp, 0o755);
    fs.chmodSync(confFile, 0o644);
    name = `polina-apache-test-${process.pid}-${Date.now()}`;
    const run = docker(['run', '-d', '--rm', '--name', name, '--label', 'polina-apache-test=1', '-p', '127.0.0.1::80',
      '-v', `${S.APP_DIR}:${HTDOCS}:ro`, '-v', `${confFile}:${CONF}:ro`, IMAGE]);
    if (run.status !== 0) { name = null; throw new Error(`docker run failed: ${run.stderr}`); }
    const mapped = docker(['port', name, '80/tcp'], 30000);
    const m = /:(\d+)\s*$/m.exec(mapped.stdout || '');
    if (!m) throw new Error(`cannot read the mapped port: ${mapped.stdout} ${mapped.stderr}`);
    port = Number(m[1]);
    const started = Date.now();
    for (;;) {
      try {
        await request('/');
        break;
      } catch (e) {
        if (Date.now() - started > 30000) throw new Error(`Apache did not answer within 30 s: ${e.message}\n${errorLog()}`);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  });

  after(cleanup);

  /** Check one response; for redirects, also follow the Location once and expect 200. */
  async function check({ urlPath, host = APEX, https = true, status, location = null, body = null }) {
    const res = await request(urlPath, { host, https });
    const scheme = https ? 'https' : 'http';
    const where = `${scheme}://${host}${urlPath}`;
    const hint = res.status >= 500 ? `\nApache error log:\n${errorLog()}` : '';
    assert.equal(res.status, status, `${where}: status ${res.status}${res.location ? ` -> ${res.location}` : ''}, expected ${status}${hint}`);
    if (location) {
      assert.ok(res.location, `${where}: no Location header`);
      const resolved = new URL(res.location, where).href;
      assert.equal(resolved, location, `${where}: Location ${res.location}, expected ${location} (one hop to the final https apex URL)`);
      const target = new URL(resolved);
      const next = await request(target.pathname + target.search, { host: target.host, https: target.protocol === 'https:' });
      assert.equal(next.status, 200, `${where}: the redirect target ${resolved} answered ${next.status}${next.location ? ` -> ${next.location}` : ''} (must be 200 after one hop)`);
    }
    if (body) assert.match(res.body, body, `${where}: unexpected body (${res.body.slice(0, 120).replace(/\s+/g, ' ')})`);
  }

  const https = (urlPath, status, location, extra = {}) => ({ urlPath, status, location: location ? `https://${APEX}${location}` : null, ...extra });

  const cases = [
    ['https apex / answers 200', https('/', 200)],
    [`https apex ${HUB} answers 200`, https(HUB, 200)],
    [`https apex artwork ${ARTWORK} answers 200`, https(ARTWORK, 200)],
    ['/index.html -> 301 https://polina-shvedko.art/', https('/index.html', 301, '/')],
    [`${HUB}index.html -> 301 ${HUB}`, https(`${HUB}index.html`, 301, HUB)],
    ['/blog/ -> 301 /', https('/blog/', 301, '/')],
    ['/blog -> 301 /', https('/blog', 301, '/')],
    [`/blog/cap-dantibes/ -> 301 ${ARTWORK}`, https('/blog/cap-dantibes/', 301, ARTWORK)],
    ['/blog/anything/ -> 301 /', https('/blog/anything/', 301, '/')],
    ['/partials/head.html -> 410 Gone', https('/partials/head.html', 410)],
    ['/nonexistent -> 404 with the custom 404 page', https('/nonexistent', 404, null, { body: /Page not found/ })],
    ['http apex / -> one 301 to https://polina-shvedko.art/', { urlPath: '/', https: false, status: 301, location: `https://${APEX}/` }],
    [`http www ${SECOND_HUB} -> one 301 to https apex ${SECOND_HUB}`, { urlPath: SECOND_HUB, host: `www.${APEX}`, https: false, status: 301, location: `https://${APEX}${SECOND_HUB}` }],
    ['https www / -> one 301 to https apex /', { urlPath: '/', host: `www.${APEX}`, https: true, status: 301, location: `https://${APEX}/` }],
    [`http www /blog/cap-dantibes/ -> one 301 straight to https apex ${ARTWORK}`, { urlPath: '/blog/cap-dantibes/', host: `www.${APEX}`, https: false, status: 301, location: `https://${APEX}${ARTWORK}` }],
  ];

  for (const [title, spec] of cases) {
    test(title, { timeout: 60000 }, () => check(spec));
  }
});

if (reason) {
  test('apache tests need Docker', { skip: reason }, () => {});
}
