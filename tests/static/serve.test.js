'use strict';
// Unit test of scripts/serve.js (SPEC section 6) on a temporary document root; independent of APP_DIR.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { startServer } = require('../../scripts/serve.js');

function request(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('scripts/serve.js', () => {
  let root;
  let server;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-test-'));
    const write = (rel, content) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
    write('index.html', '<h1>home</h1>');
    write('404.html', '<h1>Page not found</h1>');
    write('de/404.html', '<h1>Seite nicht gefunden</h1>');
    write('pastels/index.html', '<h1>pastels</h1>');
    write('css/site.css', 'body{}');
    write('js/nav.js', '1;');
    write('img/a-600.webp', 'RIFF');
    write('css/webfonts/f.woff2', 'wOF2');
    write('sitemap.xml', '<urlset/>');
    write('.htaccess', 'secret');
    server = await startServer({ root, port: 0 });
  });

  after(async () => {
    if (server) await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('startServer({ root, port: 0 }) listens on a random local port and returns { url, close }', () => {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(server.port, 0);
    assert.equal(typeof server.close, 'function');
  });

  test('directory -> index.html; directory without trailing slash -> 301 with slash (query kept)', async () => {
    const home = await request(`${server.url}/`);
    assert.equal(home.status, 200);
    assert.equal(home.body, '<h1>home</h1>');
    assert.match(home.headers['content-type'], /^text\/html/);
    const dir = await request(`${server.url}/pastels/`);
    assert.equal(dir.status, 200);
    assert.equal(dir.body, '<h1>pastels</h1>');
    const redirect = await request(`${server.url}/pastels?x=1`);
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.location, '/pastels/?x=1');
  });

  test('unknown path -> status 404 with the body of 404.html', async () => {
    const res = await request(`${server.url}/no/such/page/`);
    assert.equal(res.status, 404);
    assert.equal(res.body, '<h1>Page not found</h1>');
    const file = await request(`${server.url}/pastels/index.html/`);
    assert.equal(file.status, 404, 'a file path with a trailing slash is not a directory');
  });

  test('unknown path below /de/ -> status 404 with the body of de/404.html (the German page)', async () => {
    for (const p of ['/de/no/such/page/', '/de/x']) {
      const res = await request(`${server.url}${p}`);
      assert.equal(res.status, 404, p);
      assert.equal(res.body, '<h1>Seite nicht gefunden</h1>', p);
    }
    const other = await request(`${server.url}/dex/`);
    assert.equal(other.body, '<h1>Page not found</h1>', '/dex/ is not German');
  });

  test('MIME types for css, js, webp, woff2, xml; ?v= query ignored; HEAD has no body', async () => {
    const types = {
      '/css/site.css?v=1234abcd': /^text\/css/,
      '/js/nav.js?v=1234abcd': /^text\/javascript/,
      '/img/a-600.webp': /^image\/webp$/,
      '/css/webfonts/f.woff2': /^font\/woff2$/,
      '/sitemap.xml': /^application\/xml/,
    };
    for (const [url, re] of Object.entries(types)) {
      const res = await request(`${server.url}${url}`);
      assert.equal(res.status, 200, url);
      assert.match(res.headers['content-type'], re, url);
    }
    const head = await request(`${server.url}/css/site.css`, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(head.headers['content-length'], '6');
  });

  test('.htaccess is not served (403) and requests cannot leave the root', async () => {
    assert.equal((await request(`${server.url}/.htaccess`)).status, 403);
    assert.notEqual((await request(`${server.url}/%2e%2e/%2e%2e/etc/passwd`)).status, 200);
    const outside = await request(`${server.url}/..%2f..%2fetc%2fpasswd`);
    assert.ok([403, 404].includes(outside.status), `status ${outside.status}`);
  });

  test('port 7000 (the gulp dev server) is refused', async () => {
    await assert.rejects(startServer({ root, port: 7000 }), /7000/);
  });

  test('a missing root is reported', async () => {
    await assert.rejects(startServer({ root: path.join(root, 'nope'), port: 0 }), /does not exist/);
  });
});
