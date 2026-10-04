'use strict';
// SPEC 12 (Apache): app/.htaccess on a real Apache. Starts httpd:2.4 in Docker with mod_rewrite, mod_ssl and
// AllowOverride All (httpd.conf built from the image default), APP_DIR mounted read-only, on random local ports.
// Two ways an https request reaches Apache are tested, as both occur behind Plesk's nginx:
//   tls  a TLS listener (Apache sees HTTPS=on; a self-signed certificate made in the container for the test)
//   xfp  plain HTTP with X-Forwarded-Proto: https (a proxy that ends TLS and passes the scheme in a header)
// http requests go to the plain listener without the header. Host names are sent in the Host header (SNI for
// tls). Redirects are not followed: status and Location are checked, then each Location is requested once and
// must answer 200 (one hop, never through http://). Cache-Control of the page, asset and image responses is
// checked too. Skips with a message when Docker or the httpd:2.4 image is not available.
//
// Env: APP_DIR (directory under test), APACHE_IMAGE (default httpd:2.4).
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const S = require('../lib/site');

const IMAGE = process.env.APACHE_IMAGE || 'httpd:2.4';
const data = S.loadData();
const APEX = new URL(S.siteUrl(data)).host;
const HUB = `/${(data.hubs[0] && data.hubs[0].path) || 'oil-paintings'}/`;
const SECOND_HUB = `/${(data.hubs[1] && data.hubs[1].path) || 'pastels'}/`;
const ARTWORK = '/oil-paintings/affectionate-farewell-cap-dantibes/';
const HTDOCS = '/usr/local/apache2/htdocs';
const CONF_DIR = '/usr/local/apache2/conf';
const CONF = `${CONF_DIR}/httpd.conf`;

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

/** The image's default httpd.conf with mod_rewrite, AllowOverride All for the document root and a TLS listener. */
function patchedConf() {
  const res = docker(['run', '--rm', '--entrypoint', 'cat', IMAGE, CONF]);
  if (res.status !== 0) throw new Error(`cannot read ${CONF} from ${IMAGE}: ${res.stderr}`);
  let conf = res.stdout;
  for (const mod of ['rewrite_module', 'ssl_module', 'socache_shmcb_module']) conf = conf.replace(new RegExp(`^#\\s*(LoadModule\\s+${mod}\\s+\\S+)`, 'm'), '$1');
  conf = conf.replace(/(<Directory\s+"\/usr\/local\/apache2\/htdocs">[\s\S]*?)AllowOverride\s+None([\s\S]*?<\/Directory>)/, '$1AllowOverride All$2');
  conf += [
    '',
    'ServerName localhost',
    'Listen 443',
    'SSLSessionCache "shmcb:/usr/local/apache2/logs/ssl_scache(512000)"',
    '<VirtualHost *:443>',
    `  ServerName ${APEX}`,
    `  ServerAlias www.${APEX}`,
    `  DocumentRoot "${HTDOCS}"`,
    '  SSLEngine on',
    `  SSLCertificateFile "${CONF_DIR}/test.crt"`,
    `  SSLCertificateKeyFile "${CONF_DIR}/test.key"`,
    '</VirtualHost>',
    '',
  ].join('\n');
  for (const mod of ['rewrite_module', 'ssl_module', 'headers_module']) {
    if (!new RegExp(`^LoadModule\\s+${mod}`, 'm').test(conf)) throw new Error(`could not enable ${mod} in the default httpd.conf`);
  }
  if (!/<Directory\s+"\/usr\/local\/apache2\/htdocs">[\s\S]*?AllowOverride All[\s\S]*?<\/Directory>/.test(conf)) throw new Error('could not set AllowOverride All for the document root');
  return conf;
}

const reason = skipReason();

describe(`apache: .htaccess redirects and caching on ${IMAGE} (APP_DIR mounted read-only)`, { skip: reason || false }, () => {
  let name = null;
  let tmp = null;
  let httpPort = null;
  let tlsPort = null;

  const cleanup = () => {
    if (name) { docker(['rm', '-f', name], 60000); name = null; }
    if (tmp) { fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; }
  };

  /**
   * One request without following redirects. url: absolute http(s) URL whose host goes into the Host header.
   * mode: "tls" (https over the TLS listener) or "xfp" (https as plain HTTP + X-Forwarded-Proto). The path is
   * sent as written (double slashes kept).
   */
  function request(url, mode) {
    const u = new URL(url);
    const rawPath = url.replace(/^https?:\/\/[^/]+/, '') || '/';
    const secure = u.protocol === 'https:';
    const headers = { Host: u.host, Connection: 'close' };
    let mod = http;
    let port = httpPort;
    const extra = {};
    if (secure && mode === 'tls') {
      mod = https;
      port = tlsPort;
      extra.rejectUnauthorized = false; // the test certificate is self-signed
      extra.servername = u.hostname;
    } else if (secure) {
      headers['X-Forwarded-Proto'] = 'https';
    }
    return new Promise((resolve, reject) => {
      const req = mod.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET', headers, ...extra }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || null, cacheControl: res.headers['cache-control'] || null, body }));
      });
      req.setTimeout(15000, () => req.destroy(new Error(`timeout for ${url}`)));
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
    fs.chmodSync(tmp, 0o777); // the container writes the test certificate here
    const cert = docker(['run', '--rm', '-v', `${tmp}:/out`, '--entrypoint', 'openssl', IMAGE, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', '/out/test.key', '-out', '/out/test.crt', '-days', '2', '-subj', `/CN=${APEX}`, '-addext', `subjectAltName=DNS:${APEX},DNS:www.${APEX}`]);
    if (cert.status !== 0) throw new Error(`cannot create the test certificate: ${cert.stderr}`);
    const confFile = path.join(tmp, 'httpd.conf');
    fs.writeFileSync(confFile, patchedConf());
    fs.chmodSync(confFile, 0o644);
    name = `polina-apache-test-${process.pid}-${Date.now()}`;
    const run = docker(['run', '-d', '--rm', '--name', name, '--label', 'polina-apache-test=1', '-p', '127.0.0.1::80', '-p', '127.0.0.1::443',
      '-v', `${S.APP_DIR}:${HTDOCS}:ro`, '-v', `${confFile}:${CONF}:ro`,
      '-v', `${path.join(tmp, 'test.crt')}:${CONF_DIR}/test.crt:ro`, '-v', `${path.join(tmp, 'test.key')}:${CONF_DIR}/test.key:ro`, IMAGE]);
    if (run.status !== 0) { name = null; throw new Error(`docker run failed: ${run.stderr}`); }
    const port = (p) => {
      const mapped = docker(['port', name, `${p}/tcp`], 30000);
      const m = /:(\d+)\s*$/m.exec(mapped.stdout || '');
      if (!m) throw new Error(`cannot read the mapped port ${p}: ${mapped.stdout} ${mapped.stderr}`);
      return Number(m[1]);
    };
    httpPort = port(80);
    tlsPort = port(443);
    const started = Date.now();
    for (;;) {
      try {
        await request(`https://${APEX}/`, 'tls');
        await request(`https://${APEX}/`, 'xfp');
        break;
      } catch (e) {
        if (Date.now() - started > 30000) throw new Error(`Apache did not answer within 30 s: ${e.message}\n${errorLog()}`);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  });

  after(cleanup);

  /** Check one response; a redirect must point to the final https apex URL, which answers 200 (one hop). */
  async function check(url, mode, { status, location = null, body = null }) {
    const res = await request(url, mode);
    const where = `${url} (${mode})`;
    const hint = res.status >= 500 ? `\nApache error log:\n${errorLog()}` : '';
    assert.equal(res.status, status, `${where}: status ${res.status}${res.location ? ` -> ${res.location}` : ''}, expected ${status}${hint}`);
    if (location) {
      assert.ok(res.location, `${where}: no Location header`);
      const resolved = new URL(res.location, url).href;
      assert.equal(resolved, location, `${where}: Location ${res.location}, expected ${location} (one hop to the final https apex URL)`);
      const next = await request(resolved, mode);
      assert.equal(next.status, 200, `${where}: the redirect target ${resolved} answered ${next.status}${next.location ? ` -> ${next.location}` : ''} (must be 200 after one hop)`);
    }
    if (body) assert.match(res.body, body, `${where}: unexpected body (${res.body.slice(0, 120).replace(/\s+/g, ' ')})`);
    return res;
  }

  const A = `https://${APEX}`;
  const W = `https://www.${APEX}`;
  const HA = `http://${APEX}`;
  const HW = `http://www.${APEX}`;
  const NO_SLASH = ARTWORK.slice(0, -1);
  // [start URL, expected status, expected Location (final URL) or null, extra]
  const cases = [
    [`${A}/`, 200],
    [`${A}${HUB}`, 200],
    [`${A}${ARTWORK}`, 200],
    [`${A}${ARTWORK}?utm_source=x`, 200],
    [`${A}/index.html`, 301, `${A}/`],
    [`${A}/index.html?utm_source=x`, 301, `${A}/?utm_source=x`],
    [`${A}${HUB}index.html`, 301, `${A}${HUB}`],
    [`${A}${ARTWORK}index.html`, 301, `${A}${ARTWORK}`],
    [`${A}/blog/`, 301, `${A}/`],
    [`${A}/blog`, 301, `${A}/`],
    [`${A}/blog/cap-dantibes/`, 301, `${A}${ARTWORK}`],
    [`${A}/blog/cap-dantibes`, 301, `${A}${ARTWORK}`],
    [`${A}/blog/cap-dantibes/index.html`, 301, `${A}${ARTWORK}`],
    [`${A}/blog/anything/`, 301, `${A}/`],
    [`${A}/partials/head.html`, 410],
    [`${A}/nonexistent`, 404, null, { body: /Page not found/ }],
    // German pages below /de/: their own 404 page; the German pages redirect like the English ones
    [`${A}/de/nonexistent`, 404, null, { body: /Seite nicht gefunden/ }],
    [`${A}/de/x/y/`, 404, null, { body: /<html lang="de">/ }],
    [`${A}/dex`, 404, null, { body: /Page not found/ }],
    [`${A}/de/`, 200],
    [`${A}/de${ARTWORK}`, 200],
    [`${A}/de`, 301, `${A}/de/`],
    [`${A}/de/index.html`, 301, `${A}/de/`],
    [`${HW}/de${NO_SLASH}`, 301, `${A}/de${ARTWORK}`],
    // a folder without the trailing slash: one hop to the canonical URL, also from http and www
    [`${A}/about`, 301, `${A}/about/`],
    [`${A}${HUB.slice(0, -1)}?utm_source=x`, 301, `${A}${HUB}?utm_source=x`],
    [`${A}${NO_SLASH}`, 301, `${A}${ARTWORK}`],
    [`${HA}${NO_SLASH}`, 301, `${A}${ARTWORK}`],
    [`${HW}${NO_SLASH}`, 301, `${A}${ARTWORK}`],
    [`${W}${NO_SLASH}`, 301, `${A}${ARTWORK}`],
    [`${HA}/about`, 301, `${A}/about/`],
    // repeated slashes: one hop to the single-slash URL (no second URL that answers 200)
    [`${A}/${HUB}`, 301, `${A}${HUB}`],
    [`${A}${HUB}/affectionate-farewell-cap-dantibes/`, 301, `${A}${ARTWORK}`],
    [`${A}${ARTWORK}/`, 301, `${A}${ARTWORK}`],
    // http and www: one hop
    [`${HA}/`, 301, `${A}/`],
    [`${HA}/?utm_source=x`, 301, `${A}/?utm_source=x`],
    [`${HW}${SECOND_HUB}`, 301, `${A}${SECOND_HUB}`],
    [`${W}/`, 301, `${A}/`],
    [`${HW}/index.html`, 301, `${A}/`],
    [`${HW}/blog/cap-dantibes/`, 301, `${A}${ARTWORK}`],
  ];

  for (const mode of ['tls', 'xfp']) {
    for (const [url, status, location, extra = {}] of cases) {
      const what = status === 301 ? `-> 301 ${location}` : `answers ${status}`;
      test(`${mode}: ${url} ${what}`, { timeout: 60000 }, () => check(url, mode, { status, location, ...extra }));
    }
  }

  test('Cache-Control: hashed CSS/JS one year (immutable), the font one year, images 30 days, pages/sitemap/robots revalidated', { timeout: 60000 }, async () => {
    const html = fs.readFileSync(path.join(S.APP_DIR, 'index.html'), 'utf8');
    const css = /href="(\/css\/site\.css\?v=[0-9a-f]{8})"/.exec(html);
    const js = /src="(\/js\/nav\.js\?v=[0-9a-f]{8})"/.exec(html);
    const font = /href="(\/css\/webfonts\/[^"]+\.woff2)"/.exec(html);
    const webp = /srcset="(\/img\/[^" ]+\.webp)/.exec(html);
    const jpg = /src="(\/img\/[^"]+\.jpg)"/.exec(html);
    assert.ok(css && js && font && webp && jpg, 'home page lacks one of the asset URLs the check uses');
    const want = [
      [css[1], 'public, max-age=31536000, immutable'],
      [js[1], 'public, max-age=31536000, immutable'],
      [font[1], 'public, max-age=31536000'],
      [webp[1], 'public, max-age=2592000'],
      [jpg[1], 'public, max-age=2592000'],
      ['/img/favicon.ico', 'public, max-age=2592000'],
      ['/', 'no-cache'],
      [HUB, 'no-cache'],
      [ARTWORK, 'no-cache'],
      ['/sitemap.xml', 'no-cache'],
      ['/robots.txt', 'no-cache'],
    ];
    const problems = [];
    for (const [p, cc] of want) {
      const res = await request(`${A}${p}`, 'tls');
      if (res.status !== 200) problems.push(`${p}: status ${res.status}`);
      else if (res.cacheControl !== cc) problems.push(`${p}: Cache-Control ${JSON.stringify(res.cacheControl)}, expected "${cc}"`);
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  });
});

if (reason) {
  test('apache tests need Docker', { skip: reason }, () => {});
}
