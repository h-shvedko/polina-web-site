#!/usr/bin/env node
'use strict';
// Dependency-free static file server for the built site (app/).
//
//   npm run serve                                   # serves $APP_DIR (default: app) on http://127.0.0.1:7001
//   node scripts/serve.js --root <dir> --port 7351  # any directory, any port (0 = random)
//   PORT=7352 node scripts/serve.js --host 0.0.0.0  # listen on all interfaces (e.g. inside Docker)
//
// Behaviour (close to the production Apache):
//   - directory with trailing slash  -> its index.html
//   - directory without trailing slash -> 301 to the same path with a slash (query kept)
//   - unknown path -> status 404 with <root>/404.html, below /de/ with <root>/de/404.html (plain text when there is no 404.html)
//   - query strings (?v=1a2b3c4d) are ignored for the file lookup
//   - .ht* files (.htaccess) -> 403, like Apache; paths outside the root -> 403
//   - correct Content-Type for html, css, js, json, xml, txt, images, fonts, video
//   - no caching (Cache-Control: no-store), so a rebuild is visible on reload
//
// Programmatic use (the browser tests do this):
//   const { startServer } = require('./scripts/serve.js');
//   const server = await startServer({ root: 'app', port: 0 });  // -> { url, port, close }
//
// Port 7000 is reserved for the gulp dev server (npm run server-start); this script refuses it.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = 7001;
const RESERVED_PORT = 7000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};

/** Default document root: $APP_DIR (relative to the repository root, or absolute), else <repo>/app. */
function defaultRoot() {
  return path.resolve(REPO_ROOT, process.env.APP_DIR || 'app');
}

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function isInside(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Start the server.
 * @param {{ root?: string, port?: number, host?: string, quiet?: boolean, log?: (line: string) => void }} [options]
 * @returns {Promise<{ url: string, port: number, host: string, root: string, close: () => Promise<void> }>}
 */
function startServer(options = {}) {
  const root = path.resolve(options.root || defaultRoot());
  const host = options.host || '127.0.0.1';
  const port = options.port === undefined || options.port === null ? 0 : Number(options.port);
  const quiet = options.quiet !== undefined ? options.quiet : true;
  const log = options.log || ((line) => console.log(line));

  if (port === RESERVED_PORT) {
    return Promise.reject(new Error(`Port ${RESERVED_PORT} is reserved for the gulp dev server (npm run server-start). Use another port.`));
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return Promise.reject(new Error(`Document root does not exist or is not a directory: ${root}`));
  }

  const server = http.createServer((req, res) => {
    const done = (status) => { if (!quiet) log(`${status} ${req.method} ${req.url}`); };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('405 Method Not Allowed\n');
      done(405);
      return;
    }

    let rawPath;
    let urlPath;
    let query = '';
    try {
      const parsed = new URL(req.url, 'http://localhost');
      rawPath = parsed.pathname;
      query = parsed.search;
      urlPath = decodeURIComponent(rawPath);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('400 Bad Request\n');
      done(400);
      return;
    }

    const send404 = () => {
      // /de/... gets the German 404 page when the build has one (like the .htaccess <If> rule)
      const german = /^\/de(\/|$)/.test(rawPath || '') && fs.existsSync(path.join(root, 'de', '404.html'));
      const notFound = german ? path.join(root, 'de', '404.html') : path.join(root, '404.html');
      const head = req.method === 'HEAD';
      fs.readFile(notFound, (err, body) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(head ? undefined : '404 Not Found\n');
        } else {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
          res.end(head ? undefined : body);
        }
        done(404);
      });
    };

    if (urlPath.includes('\0')) { send404(); return; }
    const segments = urlPath.split('/');
    if (segments.some((s) => s.toLowerCase().startsWith('.ht'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden\n');
      done(403);
      return;
    }

    let file = path.join(root, urlPath);
    if (!isInside(root, file)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden\n');
      done(403);
      return;
    }

    fs.stat(file, (err, st) => {
      if (err) { send404(); return; }
      if (st.isDirectory()) {
        if (!urlPath.endsWith('/')) {
          res.writeHead(301, { Location: `${rawPath}/${query}`, 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`301 Moved Permanently: ${rawPath}/${query}\n`);
          done(301);
          return;
        }
        file = path.join(file, 'index.html');
      } else if (urlPath.endsWith('/')) {
        // A file requested with a trailing slash does not exist as a directory.
        send404();
        return;
      }
      fs.stat(file, (err2, st2) => {
        if (err2 || !st2.isFile()) { send404(); return; }
        res.writeHead(200, {
          'Content-Type': contentType(file),
          'Content-Length': st2.size,
          'Cache-Control': 'no-store',
        });
        if (req.method === 'HEAD') { res.end(); done(200); return; }
        const stream = fs.createReadStream(file);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
        done(200);
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const actualPort = server.address().port;
      const urlHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
      resolve({
        url: `http://${urlHost}:${actualPort}`,
        port: actualPort,
        host,
        root,
        close: () => new Promise((done) => {
          server.close(() => done());
          // Browsers keep connections alive; close them so the process can exit.
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        }),
      });
    });
  });
}

function parseCli(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [key, inline] = arg.startsWith('--') ? arg.slice(2).split(/=(.*)/s) : [null, null];
    const value = () => (inline !== undefined && inline !== null && inline !== '' ? inline : argv[++i]);
    switch (key) {
      case 'root': opts.root = value(); break;
      case 'port': opts.port = value(); break;
      case 'host': opts.host = value(); break;
      case 'quiet': opts.quiet = true; break;
      case 'help': opts.help = true; break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

if (require.main === module) {
  let opts;
  try {
    opts = parseCli(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    console.error('Usage: node scripts/serve.js [--root <dir>] [--port <n>] [--host <addr>] [--quiet]');
    process.exit(2);
  }
  if (opts.help) {
    console.log('Usage: node scripts/serve.js [--root <dir>] [--port <n>] [--host <addr>] [--quiet]');
    console.log(`Defaults: root = $APP_DIR or app, port = $PORT or ${DEFAULT_PORT}, host = $HOST or 127.0.0.1`);
    process.exit(0);
  }
  const root = opts.root ? path.resolve(opts.root) : defaultRoot();
  const port = Number(opts.port !== undefined ? opts.port : process.env.PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port: ${opts.port !== undefined ? opts.port : process.env.PORT}`);
    process.exit(2);
  }
  startServer({ root, port, host: opts.host || process.env.HOST || '127.0.0.1', quiet: !!opts.quiet })
    .then((s) => {
      console.log(`Serving ${s.root} at ${s.url}/ (Ctrl+C to stop)`);
      const stop = () => { s.close().then(() => process.exit(0)); };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}

module.exports = { startServer, MIME, defaultRoot };
